import fs from "fs";
import path from "path";

export type MatchScore = {
  home: number;
  away: number;
  display: string;
  home_team: string;
  away_team: string;
};

export type MarketRecord = {
  market_id: string;
  question: string;
  sports_market_type?: string;
  metadata?: {
    group_item_title?: string;
  };
};

export type TopMover = {
  market_id: string;
  question: string;
  open_c: number;
  close_c: number;
  delta_c: number;
};

function teamSide(teamName: string, home: string, away: string): "home" | "away" | null {
  const name = (teamName || "").toLowerCase();
  if (!name) return null;
  if (name.includes(home.toLowerCase().split(" ")[0]) || home.toLowerCase().includes(name)) return "home";
  if (name.includes(away.toLowerCase().split(" ")[0]) || away.toLowerCase().includes(name)) return "away";
  return null;
}

export function scoreAtMinute(matchDir: string, minute: number): MatchScore {
  const meta = JSON.parse(fs.readFileSync(path.join(matchDir, "meta.json"), "utf8"));
  const keyEvents = JSON.parse(fs.readFileSync(path.join(matchDir, "key_events.json"), "utf8"));
  let home = 0;
  let away = 0;

  for (const event of keyEvents) {
    const eventMinute = (event.clock?.value || 0) / 60;
    if (eventMinute > minute) continue;
    if (event.type?.type !== "goal") continue;
    const side = teamSide(event.team?.displayName || "", meta.home, meta.away);
    if (side === "home") home += 1;
    if (side === "away") away += 1;
  }

  return {
    home,
    away,
    display: `${home}-${away}`,
    home_team: meta.home,
    away_team: meta.away,
  };
}

export function parseExactScore(market: MarketRecord): [number, number] | null {
  const title = market.metadata?.group_item_title || market.question || "";
  const match = title.match(/(\d+)\s*[-–]\s*(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2])];
}

export function isMarketFeasible(
  market: MarketRecord,
  minute: number,
  score: MatchScore,
  closeC?: number,
): boolean {
  const type = market.sports_market_type || "";

  if (type === "soccer_halftime_result" && minute > 46) {
    return false;
  }

  if (type === "soccer_exact_score") {
    const parsed = parseExactScore(market);
    if (parsed) {
      const [needHome, needAway] = parsed;
      if (score.home > needHome || score.away > needAway) return false;
      if (closeC !== undefined && closeC <= 2) return false;
    }
  }

  if (type === "totals") {
    const title = (market.metadata?.group_item_title || market.question || "").toLowerCase();
    const lineMatch = title.match(/(\d+(?:\.\d+)?)/);
    if (lineMatch) {
      const line = Number(lineMatch[1]);
      const totalGoals = score.home + score.away;
      if (totalGoals > line && /under|\bu\b/.test(title)) return false;
      if (totalGoals >= line && closeC !== undefined && closeC >= 98) return false;
    }
  }

  return true;
}

export function filterFeasibleMovers(
  matchDir: string,
  minute: number,
  movers: TopMover[],
  markets: MarketRecord[],
): TopMover[] {
  const score = scoreAtMinute(matchDir, minute);
  const index = Object.fromEntries(markets.map((m) => [m.market_id, m]));
  return movers.filter((row) => {
    const market = index[row.market_id];
    if (!market) return false;
    return isMarketFeasible(market, minute, score, row.close_c);
  });
}
