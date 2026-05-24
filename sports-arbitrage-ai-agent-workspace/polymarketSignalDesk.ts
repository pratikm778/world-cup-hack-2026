const POLYMARKET_GAMMA_URL =
  process.env.POLYMARKET_GAMMA_URL || "https://gamma-api.polymarket.com";

export type SignalDeskCandidate = {
  event_title: string;
  question: string;
  slug?: string;
  url?: string;
  yes_price: number;
  no_price: number;
  volume: number;
  liquidity: number;
  insight?: {
    summary: string;
    sources: Array<{ title: string; url: string }>;
  };
};

export type SignalDeskRanking = {
  rank: number;
  question: string;
  event_title: string;
  recommendation: string;
  side: string;
  price: number;
  score: number;
  reason: string;
  reason_bullets?: string[];
  risk?: string;
  risk_bullets?: string[];
};

function parseJsonish(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function marketYesPrice(outcomes: Array<{ name?: string; price?: number | null }>): number | null {
  const yes = outcomes.find((o) => String(o.name || "").toLowerCase() === "yes");
  if (yes?.price != null) return yes.price;
  return outcomes[0]?.price ?? null;
}

async function gammaGet(path: string, params: Record<string, string | number>): Promise<any> {
  const url = new URL(`${POLYMARKET_GAMMA_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const response = await fetch(url.toString(), {
    headers: { "User-Agent": "edgecast-signal-desk/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Polymarket Gamma ${response.status}`);
  }
  return response.json();
}

export async function discoverPolymarketMarkets(
  theme: string,
  limit = 10,
): Promise<SignalDeskCandidate[]> {
  const search = await gammaGet("/public-search", {
    q: theme,
    limit_per_type: Math.max(limit, 10),
    events_status: "active",
    keep_closed_markets: 0,
    search_profiles: "false",
    search_tags: "false",
  });

  let events: any[] = search?.events || [];
  if (!events.length) {
    const fallback = await gammaGet("/events", {
      limit: Math.max(limit, 10),
      active: "true",
      closed: "false",
      event_title: theme,
    });
    events = Array.isArray(fallback) ? fallback : fallback?.events || fallback?.data || [];
  }

  const candidates: SignalDeskCandidate[] = [];
  for (const event of events) {
    const eventTitle = event.title || event.question || event.slug || "Polymarket Event";
    const eventSlug = event.slug;
    const eventUrl = eventSlug
      ? `https://polymarket.com/event/${encodeURIComponent(eventSlug)}`
      : undefined;

    for (const market of event.markets || []) {
      if (market.active === false || market.closed === true) continue;

      const outcomesRaw = parseJsonish(market.outcomes) as string[] | null;
      const pricesRaw = parseJsonish(market.outcomePrices) as string[] | null;
      const outcomes = (outcomesRaw || []).map((name, index) => ({
        name,
        price: pricesRaw?.[index] != null ? Number(pricesRaw[index]) : null,
      }));

      const yesPrice = marketYesPrice(outcomes);
      if (yesPrice == null || Number.isNaN(yesPrice)) continue;

      candidates.push({
        event_title: eventTitle,
        question: market.question || eventTitle,
        slug: market.slug || eventSlug,
        url: eventUrl,
        yes_price: yesPrice,
        no_price: 1 - yesPrice,
        volume: numericValue(market.volume ?? market.volumeNum),
        liquidity: numericValue(market.liquidity ?? market.liquidityNum),
        insight: {
          summary: `Active Polymarket market for "${theme}" — ${eventTitle}.`,
          sources: eventUrl ? [{ title: "Polymarket", url: eventUrl }] : [],
        },
      });
    }
  }

  candidates.sort((a, b) => b.volume - a.volume || b.liquidity - a.liquidity);
  return candidates.slice(0, limit);
}

async function fetchExaInsight(question: string): Promise<{
  summary: string;
  sources: Array<{ title: string; url: string }>;
}> {
  const apiKey = process.env.EXA_API_KEY;
  const baseUrl = process.env.EXA_BASE_URL || "https://api.exa.ai/search";
  if (!apiKey) {
    return { summary: "", sources: [] };
  }

  const response = await fetch(baseUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: `latest real-time news and market context for: ${question}`,
      numResults: 5,
      type: "auto",
      contents: { text: { maxCharacters: 600 } },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Exa API ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const results: any[] = data.results || [];
  const sources = results
    .filter((r) => r.url)
    .slice(0, 5)
    .map((r) => ({
      title: r.title || r.url,
      url: r.url,
    }));

  const summary = results
    .slice(0, 3)
    .map((r) => (r.text || r.title || "").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 1200);

  return {
    summary: summary || (sources.length ? `Exa found ${sources.length} recent source(s).` : ""),
    sources,
  };
}

async function enrichCandidatesWithExa(candidates: SignalDeskCandidate[]): Promise<void> {
  await Promise.all(
    candidates.map(async (candidate) => {
      try {
        const insight = await fetchExaInsight(candidate.question);
        if (insight.summary) {
          candidate.insight = insight;
        }
      } catch {
        // Keep the default Polymarket-only insight if Exa fails for one market.
      }
    }),
  );
}

export function heuristicRankCandidates(
  candidates: SignalDeskCandidate[],
  reason?: string,
): SignalDeskRanking[] {
  const ranked = candidates.map((market) => {
    const yesPrice = market.yes_price;
    const priceEdgeBand = 1 - Math.abs(0.5 - yesPrice) * 2;
    const score = Math.round(
      Math.min(
        100,
        priceEdgeBand * 48 +
          Math.min(market.volume / 250000, 25) +
          Math.min(market.liquidity / 25000, 27),
      ),
    );

    return {
      rank: 0,
      question: market.question,
      event_title: market.event_title,
      recommendation: yesPrice <= 0.62 ? "buy_yes" : "watch",
      side: yesPrice <= 0.62 ? "Yes" : "No",
      price: yesPrice,
      score,
      reason:
        reason ||
        "Heuristic score from price band, volume, and liquidity. Verify market rules before trading.",
      reason_bullets: [
        `Yes price ${Math.round(yesPrice * 100)}c with $${Math.round(market.volume).toLocaleString()} volume.`,
        `Liquidity ~$${Math.round(market.liquidity).toLocaleString()}.`,
      ],
      risk: "Ranking did not use live news enrichment.",
      risk_bullets: ["Start oracle_app.py on :6060 for Exa news + GMI-ranked reasoning."],
    };
  });

  ranked.sort((a, b) => b.score - a.score);
  ranked.forEach((item, index) => {
    item.rank = index + 1;
  });
  return ranked;
}

async function callGmiRankCandidates(
  candidates: SignalDeskCandidate[],
): Promise<{ provider: string; model: string; rankings: SignalDeskRanking[] }> {
  const apiKey = process.env.GMI_API_KEY || process.env.ROCKETRIDE_GMI_API_KEY;
  if (!apiKey) {
    throw new Error("GMI_API_KEY is not configured");
  }

  const compact = candidates.map((c) => ({
    event_title: c.event_title,
    question: c.question,
    yes_price: c.yes_price,
    volume: c.volume,
    liquidity: c.liquidity,
    insight_summary: c.insight?.summary,
  }));

  const response = await fetch("https://api.gmi-serving.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.GMI_MODEL || "google/gemini-3.5-flash",
      messages: [
        {
          role: "system",
          content:
            "You rank active Polymarket bets. Return JSON: { rankings: [{ rank, question, event_title, recommendation, side, price, score, reason, reason_bullets, risk, risk_bullets }] }",
        },
        {
          role: "user",
          content: JSON.stringify({ candidates: compact }),
        },
      ],
      temperature: 0.2,
      max_tokens: 2500,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    throw new Error(`GMI ranking failed: ${response.status}`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  const rankings = Array.isArray(parsed.rankings) ? parsed.rankings : [];
  return {
    provider: "gmi-direct",
    model: payload?.model || process.env.GMI_MODEL || "google/gemini-3.5-flash",
    rankings,
  };
}

export async function runSignalDeskSearch(theme: string, limit = 10) {
  const started = Date.now();
  const candidates = await discoverPolymarketMarkets(theme, limit);
  await enrichCandidatesWithExa(candidates);

  if (!candidates.length) {
    return {
      status: "ok",
      theme,
      latency_seconds: (Date.now() - started) / 1000,
      reasoning: {
        provider: "polymarket-gamma",
        model: null,
        rankings: [],
        note: `No active Polymarket markets found for "${theme}".`,
      },
      candidates: [],
    };
  }

  let reasoning: any;
  try {
    reasoning = await callGmiRankCandidates(candidates);
    if (!Array.isArray(reasoning.rankings) || reasoning.rankings.length === 0) {
      throw new Error("GMI returned empty rankings");
    }
  } catch (err: any) {
    reasoning = {
      provider: "heuristic-polymarket",
      model: process.env.GMI_MODEL || "google/gemini-3.5-flash",
      rankings: heuristicRankCandidates(
        candidates,
        `Heuristic ranking because GMI failed: ${err?.message || err}`,
      ),
    };
  }

  return {
    status: "ok",
    theme,
    latency_seconds: Number(((Date.now() - started) / 1000).toFixed(2)),
    reasoning,
    candidates,
  };
}
