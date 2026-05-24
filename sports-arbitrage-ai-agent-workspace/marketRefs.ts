import type { MarketCatalogEntry } from "./marketLabels.js";

export const EDGECAST_FOOTER = "---edgecast---";

export type MarketRole = "primary" | "secondary";

export type CitedMarketRef = {
  market_id: string;
  price_c?: number;
  role: MarketRole;
  label: string;
  slug?: string;
  polymarket_url?: string;
};

export type ParsedAgentMessage = {
  displayText: string;
  cited_markets: CitedMarketRef[];
};

type RawCited = {
  market_id?: string;
  id?: string;
  price_c?: number;
  role?: string;
};

function buildPolymarketUrl(slug?: string, eventSlug?: string): string | undefined {
  const path = slug || eventSlug;
  if (!path) return undefined;
  return `https://polymarket.com/event/${encodeURIComponent(path)}`;
}

function normalizeRole(role?: string): MarketRole {
  return role === "primary" ? "primary" : "secondary";
}

function resolveCited(
  raw: RawCited,
  catalog: Record<string, MarketCatalogEntry>,
): CitedMarketRef | null {
  const marketId = raw.market_id || raw.id;
  if (!marketId) return null;
  const entry = catalog[marketId];
  if (!entry) return null;
  return {
    market_id: marketId,
    price_c: typeof raw.price_c === "number" ? raw.price_c : undefined,
    role: normalizeRole(raw.role),
    label: entry.label,
    slug: entry.slug,
    polymarket_url: entry.polymarket_url,
  };
}

function parseFooterJson(raw: string): RawCited[] {
  const footerIdx = raw.lastIndexOf(EDGECAST_FOOTER);
  if (footerIdx === -1) return [];
  const jsonPart = raw.slice(footerIdx + EDGECAST_FOOTER.length).trim();
  try {
    const parsed = JSON.parse(jsonPart);
    if (Array.isArray(parsed?.cited_markets)) {
      return parsed.cited_markets;
    }
  } catch {
    // ignore malformed footer
  }
  return [];
}

function parseInlineMarketTokens(text: string): string[] {
  const ids: string[] = [];
  const re = /\(market:([0-9]+)\)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    ids.push(match[1]);
  }
  return ids;
}

function fuzzyMatchFromText(
  text: string,
  catalog: Record<string, MarketCatalogEntry>,
): RawCited[] {
  const lower = text.toLowerCase();
  const matches: RawCited[] = [];

  const entries = Object.entries(catalog).sort(
    (a, b) => b[1].label.length - a[1].label.length,
  );

  for (const [marketId, entry] of entries) {
    const label = entry.label.toLowerCase();
    if (label.length < 6) continue;
    if (lower.includes(label)) {
      matches.push({ market_id: marketId, role: "secondary" });
    }
  }

  return matches.slice(0, 3);
}

export function parseAgentMessage(
  raw: string,
  catalog: Record<string, MarketCatalogEntry>,
): ParsedAgentMessage {
  if (!raw?.trim()) {
    return { displayText: "", cited_markets: [] };
  }

  const footerIdx = raw.lastIndexOf(EDGECAST_FOOTER);
  const prose = footerIdx === -1 ? raw.trim() : raw.slice(0, footerIdx).trim();

  const seen = new Set<string>();
  const cited: CitedMarketRef[] = [];

  const addRaw = (item: RawCited, fallbackRole?: MarketRole) => {
    const resolved = resolveCited(
      { ...item, role: item.role || fallbackRole },
      catalog,
    );
    if (!resolved || seen.has(resolved.market_id)) return;
    seen.add(resolved.market_id);
    cited.push(resolved);
  };

  for (const item of parseFooterJson(raw)) {
    addRaw(item);
  }

  if (cited.length === 0) {
    for (const id of parseInlineMarketTokens(prose)) {
      addRaw({ market_id: id, role: "secondary" });
    }
  }

  if (cited.length === 0) {
    for (const item of fuzzyMatchFromText(prose, catalog)) {
      addRaw(item);
    }
  }

  if (cited.length > 0 && !cited.some((c) => c.role === "primary")) {
    cited[0].role = "primary";
  }

  const displayText = prose
    .replace(/\(market:[0-9]+\)/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return { displayText, cited_markets: cited.slice(0, 3) };
}

export function enrichCitedFromPrices(
  cited: CitedMarketRef[],
  prices: Record<string, { price?: number; label?: string }>,
): CitedMarketRef[] {
  return cited.map((c) => ({
    ...c,
    price_c: c.price_c ?? prices[c.market_id]?.price,
    label: c.label || prices[c.market_id]?.label || c.market_id,
  }));
}
