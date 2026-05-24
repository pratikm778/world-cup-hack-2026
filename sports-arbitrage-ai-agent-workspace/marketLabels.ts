export type MarketRecord = {
  market_id: string;
  question: string;
  sports_market_type?: string;
  metadata?: {
    group_item_title?: string;
    event_group?: string;
  };
};

export type MarketCatalogEntry = {
  label: string;
  question: string;
  type?: string;
};

/** Human-readable label for a Polymarket contract. */
export function formatMarketLabel(market: MarketRecord): string {
  const title = market.metadata?.group_item_title?.trim();
  const group = market.metadata?.event_group;
  const type = market.sports_market_type;
  const question = market.question || "";

  if (type === "moneyline" && title) {
    if (/^draw/i.test(title)) return "Match ends in Draw";
    if (title.includes("(")) return `Spread: ${title}`;
    return `Winner: ${title}`;
  }

  if (type === "soccer_halftime_result" && title) {
    if (/^draw$/i.test(title)) return "Halftime Draw";
    return `Halftime Leader: ${title}`;
  }

  if (type === "soccer_exact_score" && title) {
    return title.startsWith("Exact Score") ? title : `Exact Score: ${title}`;
  }

  if (title) {
    if (/^both teams to score$/i.test(title)) return "Both Teams to Score";
    if (/^o\/u/i.test(title)) {
      const line = title.replace(/^o\/u\s*/i, "");
      return `Totals: Over/Under ${line} Goals`;
    }
    if (/^exact score:/i.test(title)) return title;
    if (group === "halftime-result") {
      if (/^draw$/i.test(title)) return "Halftime Draw";
      return `Halftime Leader: ${title}`;
    }
    return title;
  }

  if (/end in a draw/i.test(question)) return "Match ends in Draw";
  if (/exact score/i.test(question)) {
    const match = question.match(/(\d+\s*-\s*\d+)/);
    return match ? `Exact Score: ${match[1].replace(/\s/g, "")}` : question.replace(/\?$/, "");
  }
  if (/leading at halftime/i.test(question)) {
    const team = question.split(" leading at halftime")[0];
    return `Halftime Leader: ${team}`;
  }
  if (/draw at halftime/i.test(question)) return "Halftime Draw";
  if (/both teams to score/i.test(question)) return "Both Teams to Score";
  if (/over\/under|o\/u/i.test(question)) {
    const match = question.match(/(\d+(?:\.\d+)?)/);
    return match ? `Totals: Over/Under ${match[1]} Goals` : question.replace(/\?$/, "");
  }

  return question.replace(/\?$/, "").slice(0, 80);
}

export function buildMarketCatalog(
  markets: MarketRecord[],
): Record<string, MarketCatalogEntry> {
  const catalog: Record<string, MarketCatalogEntry> = {};
  for (const market of markets) {
    catalog[market.market_id] = {
      label: formatMarketLabel(market),
      question: market.question,
      type: market.sports_market_type,
    };
  }
  return catalog;
}

/** Replace raw market IDs in agent/chat text with friendly labels. */
export function substituteMarketIdsInText(
  text: string,
  catalog: Record<string, MarketCatalogEntry | string>,
): string {
  if (!text) return text;

  let out = text;
  const ids = Object.keys(catalog).sort((a, b) => b.length - a.length);

  for (const id of ids) {
    const entry = catalog[id];
    const label = typeof entry === "string" ? entry : entry.label;
    out = out.replace(new RegExp(`\\(${id}\\)`, "g"), label);
    out = out.replace(new RegExp(`(?<![0-9])${id}(?![0-9])`, "g"), label);
  }

  return out;
}
