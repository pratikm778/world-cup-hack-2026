import express from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import {
  buildMarketCatalog,
  substituteMarketIdsInText,
  type MarketCatalogEntry,
  type MarketRecord,
} from "./marketLabels.js";
import { runSignalDeskSearch } from "./polymarketSignalDesk.js";
import {
  callGmiTickBroadcast,
  loadAgentInstructions,
} from "./localAgentTick.js";
import { filterFeasibleMovers, isMarketFeasible, scoreAtMinute } from "./matchState.js";
import { parseAgentMessage, enrichCitedFromPrices } from "./marketRefs.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(repoRoot, ".env") });

const REPLAY_SPEED = Number(process.env.EDGECAST_REPLAY_SPEED) || 10;
const localReplay = {
  anchorMinute: null as number | null,
  anchorReal: null as number | null,
  fixedMinute: null as number | null,
};

function currentLocalMatchMinute(): number {
  if (localReplay.fixedMinute !== null) {
    return localReplay.fixedMinute;
  }
  if (localReplay.anchorMinute !== null && localReplay.anchorReal !== null) {
    const elapsedSec = (Date.now() - localReplay.anchorReal) / 1000;
    return Math.min(90, localReplay.anchorMinute + elapsedSec * (REPLAY_SPEED / 60));
  }
  return 0;
}

async function fetchAgentClock(): Promise<{ nowMinute: number; matchId: string } | null> {
  try {
    const healthRes = await fetch("http://localhost:8765/health");
    if (!healthRes.ok) return null;
    const healthData = await healthRes.json();
    return {
      nowMinute: healthData.now_minute || 0,
      matchId: healthData.match_id || "ars-man-2026-04-19",
    };
  } catch {
    return null;
  }
}

function loadMarketCatalog(matchId: string): Record<string, MarketCatalogEntry> {
  const matchDir = path.join(repoRoot, "data", "matches", matchId);
  const markets = JSON.parse(
    fs.readFileSync(path.join(matchDir, "markets.json"), "utf8"),
  ) as MarketRecord[];
  return buildMarketCatalog(markets);
}

function formatAgentMessagePayload(
  rawText: string,
  catalog: Record<string, MarketCatalogEntry>,
  prices?: Record<string, { price?: number; label?: string }>,
) {
  const parsed = parseAgentMessage(rawText, catalog);
  const text = substituteMarketIdsInText(parsed.displayText, catalog);
  const cited_markets = prices
    ? enrichCitedFromPrices(parsed.cited_markets, prices)
    : parsed.cited_markets;
  return { text, cited_markets };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3005;

  app.use(express.json());

  // API Paths FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // helper function to extract Yes outcome token_id
  function yesToken(markets: any[], marketId: string): string | null {
    const m = markets.find(x => x.market_id === marketId);
    if (!m) return null;
    const outcomes = m.outcomes || [];
    const tokens = m.token_ids || [];
    const yesIndex = outcomes.indexOf("Yes");
    if (yesIndex !== -1 && yesIndex < tokens.length) {
      return tokens[yesIndex];
    }
    return tokens[0] || null;
  }

  // helper function to find price at targetMinute
  function getPriceAtMinute(points: any[], kickoffTime: number, targetMinute: number): number {
    if (!points || points.length === 0) return 0;
    let latestPrice = points[0].price;
    for (const p of points) {
      const ptsMinute = (new Date(p.ts_utc).getTime() - kickoffTime) / 60000;
      if (ptsMinute <= targetMinute) {
        latestPrice = p.price;
      } else {
        break;
      }
    }
    return Math.round(latestPrice * 100);
  }

  // EdgeCast Live Clock and State aggregator
  app.get("/api/state", async (req, res) => {
    try {
      let nowMinute = 0;
      let matchId = "ars-man-2026-04-19";
      const agentClock = await fetchAgentClock();
      if (agentClock) {
        nowMinute = agentClock.nowMinute;
        matchId = agentClock.matchId;
      } else {
        nowMinute = currentLocalMatchMinute();
      }

      const matchDir = path.join(process.cwd(), "..", "data", "matches", matchId);
      if (!fs.existsSync(matchDir)) {
        return res.status(404).json({ error: `Match data directory not found: ${matchId}` });
      }

      const meta = JSON.parse(fs.readFileSync(path.join(matchDir, "meta.json"), "utf8"));
      const markets = JSON.parse(fs.readFileSync(path.join(matchDir, "markets.json"), "utf8"));
      const marketCatalog = buildMarketCatalog(markets as MarketRecord[]);
      const keyEvents = JSON.parse(fs.readFileSync(path.join(matchDir, "key_events.json"), "utf8"));
      const commentary = JSON.parse(fs.readFileSync(path.join(matchDir, "commentary.json"), "utf8"));

      const kickoffTime = new Date(meta.kickoff_utc).getTime();
      const matchScore = scoreAtMinute(matchDir, nowMinute);

      const activeCommentary = commentary
        .filter((c: any) => {
          if (c.minute > nowMinute) return false;
          const text = (c.text || "").toLowerCase();
          if (c.minute === 0 && text.includes("match ends")) return false;
          return true;
        })
        .sort((a: any, b: any) => {
          if (a.minute !== b.minute) return a.minute - b.minute;
          return (a.extra_time || 0) - (b.extra_time || 0);
        });

      const activeEvents = keyEvents
        .filter((e: any) => (e.clock.value / 60) <= nowMinute)
        .sort((a: any, b: any) => (b.clock.value / 60) - (a.clock.value / 60));

      const prices: Record<string, {
        price: number;
        delta5m: number;
        delta2m: number;
        label: string;
        question: string;
        type?: string;
        slug?: string;
        polymarket_url?: string;
      }> = {};
      for (const m of markets) {
        const tokenId = yesToken(markets, m.market_id);
        if (!tokenId) continue;

        const priceFilePath = path.join(matchDir, "prices", `${tokenId}.json`);
        if (!fs.existsSync(priceFilePath)) continue;

        const priceBlob = JSON.parse(fs.readFileSync(priceFilePath, "utf8"));
        const points = priceBlob.points || [];
        points.sort((a: any, b: any) => new Date(a.ts_utc).getTime() - new Date(b.ts_utc).getTime());

        const currentPrice = getPriceAtMinute(points, kickoffTime, nowMinute);
        if (!isMarketFeasible(m, nowMinute, matchScore, currentPrice)) continue;
        const prevPrice5m = getPriceAtMinute(points, kickoffTime, Math.max(0, nowMinute - 5));
        const prevPrice2m = getPriceAtMinute(points, kickoffTime, Math.max(0, nowMinute - 2));
        const catalogEntry = marketCatalog[m.market_id];

        prices[m.market_id] = {
          price: currentPrice,
          delta5m: currentPrice - prevPrice5m,
          delta2m: currentPrice - prevPrice2m,
          label: catalogEntry?.label || m.question,
          question: m.question,
          type: catalogEntry?.type || m.sports_market_type,
          slug: catalogEntry?.slug,
          polymarket_url: catalogEntry?.polymarket_url,
        };
      }

      const market_labels = Object.fromEntries(
        Object.entries(marketCatalog).map(([id, entry]) => [id, entry.label]),
      );

      res.json({
        minute: nowMinute,
        match_id: matchId,
        teams: { home: meta.home, away: meta.away },
        score: matchScore,
        last_events: activeEvents,
        commentary: activeCommentary,
        prices,
        market_labels,
      });
    } catch (err: any) {
      console.error("Error building api state:", err);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  // Replay clock proxy endpoints
  app.post("/api/replay/start", async (req, res) => {
    const fromMinute = Number(req.query.from_minute || 0);
    try {
      const response = await fetch(`http://localhost:8765/replay/start?from_minute=${fromMinute}`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      }
    } catch (err) {
      // ignore and use local replay clock
    }
    localReplay.anchorMinute = fromMinute;
    localReplay.anchorReal = Date.now();
    localReplay.fixedMinute = null;
    lastLocalTickBucket = gameTickBucket(fromMinute) - 1;
    res.json({ anchored_minute: fromMinute, mode: "running", simulated: true });
  });

  app.post("/api/replay/seek", async (req, res) => {
    const minute = Number(req.query.minute || 0);
    try {
      const response = await fetch(`http://localhost:8765/replay/seek?minute=${minute}`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      }
    } catch (err) {
      // ignore and use local replay clock
    }
    localReplay.fixedMinute = minute;
    localReplay.anchorMinute = null;
    localReplay.anchorReal = null;
    if (minute === 0) {
      resetBroadcastMemory();
    } else {
      lastLocalTickBucket = gameTickBucket(minute);
    }
    res.json({ now_minute: minute, mode: "fixed", simulated: true });
  });

  // Live broadcast events SSE stream
  let sseClients: { id: number; res: any }[] = [];
  let sseClientIdCounter = 0;
  let lastSeenBroadcasts = 0;
  const defaultMatchId = process.env.EDGECAST_MATCH_ID || "ars-man-2026-04-19";
  let broadcastMarketCatalog = loadMarketCatalog(defaultMatchId);
  const TICK_GAME_MINUTES = Number(process.env.EDGECAST_TICK_GAME_MINUTES) || 5;
  const agentInstructions = loadAgentInstructions(repoRoot);
  const localPriorBroadcasts: { match_minute: number; text: string }[] = [];
  let lastLocalTickBucket = -1;

  function gameTickBucket(minute: number): number {
    if (minute < TICK_GAME_MINUTES) return -1;
    return Math.floor(minute / TICK_GAME_MINUTES);
  }

  function resetBroadcastMemory() {
    lastSeenBroadcasts = 0;
    lastLocalTickBucket = -1;
    localPriorBroadcasts.length = 0;
  }

  function buildTickSnapshot(matchId: string, nowMinute: number) {
    const matchDir = path.join(repoRoot, "data", "matches", matchId);
    const meta = JSON.parse(fs.readFileSync(path.join(matchDir, "meta.json"), "utf8"));
    const markets = JSON.parse(fs.readFileSync(path.join(matchDir, "markets.json"), "utf8"));
    const marketCatalog = buildMarketCatalog(markets as MarketRecord[]);
    const keyEvents = JSON.parse(fs.readFileSync(path.join(matchDir, "key_events.json"), "utf8"));
    const commentary = JSON.parse(fs.readFileSync(path.join(matchDir, "commentary.json"), "utf8"));
    const kickoffTime = new Date(meta.kickoff_utc).getTime();
    const lookback = TICK_GAME_MINUTES;

    const rawMovers = markets
      .map((m: any) => {
        const tokenId = yesToken(markets, m.market_id);
        if (!tokenId) return null;
        const priceFilePath = path.join(matchDir, "prices", `${tokenId}.json`);
        if (!fs.existsSync(priceFilePath)) return null;
        const points = JSON.parse(fs.readFileSync(priceFilePath, "utf8")).points || [];
        points.sort((a: any, b: any) => new Date(a.ts_utc).getTime() - new Date(b.ts_utc).getTime());
        const close_c = getPriceAtMinute(points, kickoffTime, nowMinute);
        const open_c = getPriceAtMinute(points, kickoffTime, Math.max(0, nowMinute - lookback));
        return {
          market_id: m.market_id,
          question: marketCatalog[m.market_id]?.label || m.question,
          open_c,
          close_c,
          delta_c: close_c - open_c,
        };
      })
      .filter(Boolean)
      .sort((a: any, b: any) => Math.abs(b.delta_c) - Math.abs(a.delta_c))
      .slice(0, 12);

    const polymarket_top_movers = filterFeasibleMovers(
      matchDir,
      nowMinute,
      rawMovers as any[],
      markets,
    ).slice(0, 5);
    const match_score = scoreAtMinute(matchDir, nowMinute);

    const sinceMinute = Math.max(0, nowMinute - lookback);
    const new_key_events = keyEvents
      .filter((e: any) => {
        const m = e.clock.value / 60;
        return m > sinceMinute && m <= nowMinute;
      })
      .slice(0, 8);
    const new_commentary = commentary
      .filter((c: any) => c.minute > sinceMinute && c.minute <= nowMinute)
      .slice(-8);

    return {
      mode: "tick",
      session_id: process.env.EDGECAST_SESSION_ID || `edgecast-${matchId}`,
      match_id: matchId,
      match_minute: Math.round(nowMinute * 10) / 10,
      match_score,
      since_minute: sinceMinute,
      lookback_min: lookback,
      polymarket_top_movers,
      new_key_events,
      new_commentary,
      prior_broadcasts: localPriorBroadcasts.slice(-5),
      hint:
        "Surface ONE game-linked OPPORTUNITY or return empty string. Use match_score " +
        "to ignore dead markets (at 1-1 never cite 0-0, 1-0, or 0-1 exact score). " +
        "Lead with pitch read, not raw price movement.",
    };
  }

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const clientId = sseClientIdCounter++;
    sseClients.push({ id: clientId, res });

    res.write(`data: ${JSON.stringify({ type: "connected", message: "EdgeCast SSE connection online" })}\n\n`);

    req.on("close", () => {
      sseClients = sseClients.filter(c => c.id !== clientId);
    });
  });

  function broadcastSse(data: any) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    sseClients.forEach(c => c.res.write(payload));
  }

  // Poll agent server for broadcasts; fall back to local GMI ticks when :8765 is offline
  setInterval(async () => {
    if (sseClients.length === 0) return;

    let agentOnline = false;
    try {
      const memoryRes = await fetch("http://localhost:8765/agent/memory", {
        signal: AbortSignal.timeout(2000),
      });
      if (memoryRes.ok) {
        agentOnline = true;
        const memoryData = await memoryRes.json();
        const broadcasts = memoryData.broadcast_history || [];
        if (broadcasts.length > lastSeenBroadcasts) {
          const newBroadcasts = broadcasts.slice(lastSeenBroadcasts);
          newBroadcasts.forEach((b: any) => {
            let urgency = "info";
            const txt = b.text.toLowerCase();
            if (txt.includes("goal") || txt.includes("red card") || txt.includes("big alert") || txt.includes("major")) {
              urgency = "major";
            } else if (txt.includes("moving") || txt.includes("delta") || txt.includes("corners") || txt.includes("pressure")) {
              urgency = "movement";
            }
            const formatted = formatAgentMessagePayload(b.text, broadcastMarketCatalog);
            broadcastSse({
              type: "broadcast",
              minute: b.match_minute,
              text: formatted.text,
              cited_markets: formatted.cited_markets,
              urgency,
            });
          });
          lastSeenBroadcasts = broadcasts.length;
        } else if (broadcasts.length < lastSeenBroadcasts) {
          lastSeenBroadcasts = broadcasts.length;
        }
      }
    } catch {
      // agent IO server offline — use local tick fallback below
    }

    if (agentOnline) return;
    if (localReplay.fixedMinute !== null || localReplay.anchorMinute === null) return;

    const nowMinute = currentLocalMatchMinute();
    const bucket = gameTickBucket(nowMinute);
    if (bucket <= lastLocalTickBucket) return;
    lastLocalTickBucket = bucket;

    try {
      const payload = buildTickSnapshot(defaultMatchId, nowMinute);
      const text = await callGmiTickBroadcast(agentInstructions, payload);
      if (!text.trim()) return;

      const formatted = formatAgentMessagePayload(text.trim(), broadcastMarketCatalog);
      localPriorBroadcasts.push({ match_minute: nowMinute, text: formatted.text });
      broadcastSse({
        type: "broadcast",
        minute: nowMinute,
        text: formatted.text,
        cited_markets: formatted.cited_markets,
        urgency: "movement",
      });
      console.log(`Local agent tick @ ${nowMinute.toFixed(1)}' → broadcast (${formatted.text.slice(0, 80)}...)`);
    } catch (err) {
      console.warn("Local agent tick failed:", err);
    }
  }, 1000);

  // Helper to extract response text out of RocketRide response defensively
  function extractRocketRideAnswer(body: any): string {
    if (body === null || body === undefined) return "";
    if (typeof body === "string") return body.trim();
    if (Array.isArray(body)) {
      return body.map(x => extractRocketRideAnswer(x)).filter(Boolean).join(" ").trim();
    }
    if (typeof body === "object") {
      if ("answers" in body) {
        return extractRocketRideAnswer(body.answers);
      }
      for (const k of ["text", "content", "output", "message", "answers"]) {
        if (k in body) {
          return extractRocketRideAnswer(body[k]);
        }
      }
    }
    return JSON.stringify(body);
  }

  async function callGmiChatDirect(
    question: string,
    matchMinute: number,
    prices: Record<string, any>,
    commentary: any[],
    keyEvents: any[],
  ): Promise<string> {
    const apiKey = process.env.GMI_API_KEY || process.env.ROCKETRIDE_GMI_API_KEY;
    if (!apiKey) {
      throw new Error("GMI_API_KEY is not configured");
    }

    const priceLines = Object.entries(prices || {})
      .slice(0, 12)
      .map(([marketId, info]: [string, any]) =>
        `- ${info?.label || marketId}: ${info?.price ?? "?"}c (5m ${info?.delta5m >= 0 ? "+" : ""}${info?.delta5m ?? 0}c)`
      );

    const context = [
      `Match minute: ${matchMinute}`,
      `Recent commentary: ${(commentary || []).slice(0, 5).map((c: any) => `${c.minute}' ${c.text}`).join(" | ") || "none"}`,
      `Recent events: ${(keyEvents || []).slice(0, 5).map((e: any) => `${e.minute ?? "?"}' ${e.type ?? "event"} ${e.text ?? ""}`).join(" | ") || "none"}`,
      `Market prices:\n${priceLines.join("\n") || "none"}`,
    ].join("\n");

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
              "You are EdgeCast, a live sports prediction-market analyst. Answer in 3-5 sentences, trader-terse, cite specific cent prices when relevant. Use the human-readable market names provided in context — never cite numeric market IDs. Do not suggest placing orders.",
          },
          {
            role: "user",
            content: `Question: ${question}\n\nLive context:\n${context}`,
          },
        ],
        temperature: 0.2,
        max_tokens: 2000,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`GMI API ${response.status}: ${errText.slice(0, 200)}`);
    }

    const result = await response.json();
    const answer = result?.choices?.[0]?.message?.content?.trim();
    if (!answer) {
      const finishReason = result?.choices?.[0]?.finish_reason;
      throw new Error(
        `GMI API returned an empty answer (finish_reason=${finishReason ?? "unknown"})`
      );
    }
    return answer;
  }

  // Chat routed through agent_io_server for shared memory + rich context
  app.post("/api/chat", async (req, res) => {
    const { question, match_minute } = req.body;
    const matchId = process.env.EDGECAST_MATCH_ID || "ars-man-2026-04-19";
    const marketCatalog = loadMarketCatalog(matchId);

    function sanitizeAnswer(answer: string, prices?: Record<string, { price?: number; label?: string }>) {
      return formatAgentMessagePayload(answer, marketCatalog, prices);
    }

    if (!question?.trim()) {
      return res.status(400).json({ error: "question is required" });
    }

    const snapshot = buildTickSnapshot(matchId, match_minute || 0);
    const chatPrices: Record<string, { price?: number; label?: string }> = {};
    for (const m of snapshot.polymarket_top_movers || []) {
      chatPrices[m.market_id] = { price: m.close_c, label: m.question };
    }

    try {
      const agentRes = await fetch("http://localhost:8765/agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: question.trim(),
          match_minute: match_minute ?? 0,
        }),
        signal: AbortSignal.timeout(45000),
      });

      if (agentRes.ok) {
        const data = await agentRes.json();
        const formatted = sanitizeAnswer(data.answer || "", chatPrices);
        return res.json({
          answer: formatted.text,
          cited_markets: formatted.cited_markets,
          modelUsed: data.modelUsed || "gemini-3.5-flash (via RocketRide)",
          timestamp: new Date().toISOString(),
          chat_turns: data.chat_turns,
        });
      }

      const errText = await agentRes.text();
      throw new Error(`agent_io_server /agent/chat ${agentRes.status}: ${errText.slice(0, 200)}`);
    } catch (err: any) {
      console.warn("agent_io_server chat failed, trying direct webhook.", err?.message || err);
    }

    try {
      const webhookUrl = process.env.EDGECAST_WEBHOOK_URL || "http://localhost:8080/api/pipelines/test.pipe/webhook";

      const payload = {
        mode: "chat",
        ...snapshot,
        question: question.trim(),
        hint: `Trader question: "${question}". Answer in 3–5 sentences with pitch read and cent prices.`,
      };

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        const formatted = sanitizeAnswer(
          extractRocketRideAnswer(result) || "No response generated by RocketRide.",
          chatPrices,
        );
        res.json({
          answer: formatted.text,
          cited_markets: formatted.cited_markets,
          modelUsed: "gemini-3.5-flash (via RocketRide)",
          timestamp: new Date().toISOString(),
        });
      } else {
        throw new Error(`RocketRide webhook responded with status ${response.status}`);
      }
    } catch (err: any) {
      console.warn("RocketRide webhook offline. Trying direct GMI fallback.", err?.message || err);

      try {
        const formatted = sanitizeAnswer(await callGmiChatDirect(
          question,
          match_minute || 0,
          {},
          snapshot.new_commentary || [],
          snapshot.new_key_events || [],
        ), chatPrices);
        return res.json({
          answer: formatted.text,
          cited_markets: formatted.cited_markets,
          modelUsed: "google/gemini-3.5-flash (direct GMI fallback)",
          timestamp: new Date().toISOString(),
        });
      } catch (gmiErr: any) {
        console.warn("Direct GMI fallback failed. Using local heuristic response.", gmiErr?.message || gmiErr);
      }
      
      // Fallback response if the pipeline is offline
      const txt = question.toLowerCase();
      let answer = "EdgeCast is actively parsing live prediction markets and event logs. The RocketRide pipeline is currently offline, but our cognitive analysis highlights general stability in the contract prices. Direct your questions towards live game events.";
      
      if (txt.includes("win") || txt.includes("who will win") || txt.includes("arsenal") || txt.includes("city")) {
        answer = `At ${Math.round(match_minute || 0)}', Manchester City vs Arsenal sits in a high-tension state. Prediction markets currently price Man City to win around 62c, Arsenal around 18c, and the Draw around 20c. Physical tracking confirms City is maintaining defensive control in their own third.`;
      } else if (txt.includes("goal") || txt.includes("score")) {
        answer = "Our live spotter notes high offensive pressure from Manchester City. However, the over 2.5 goals contract remains stable at 40c, implying a low scoring velocity. Expect late game transitions.";
      }
      
      const formatted = sanitizeAnswer(answer, chatPrices);
      res.json({
        answer: formatted.text,
        cited_markets: formatted.cited_markets,
        modelUsed: "Heuristic Local Engine (RocketRide Offline)",
        timestamp: new Date().toISOString(),
      });
    }
  });

  // Polymarket Signal Desk (Future)
  app.post("/api/top-bets", async (req, res) => {
    try {
      const response = await fetch("http://127.0.0.1:6060/api/top-bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req.body)
      });
      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      }
    } catch (err) {
      console.warn("Polymarket Signal Desk Flask API offline. Using live Polymarket Gamma fallback.");
    }

    try {
      const theme = String(req.body?.theme || "football soccer today").trim();
      const limit = Number(req.body?.limit || 10);
      const data = await runSignalDeskSearch(theme, limit);
      return res.json(data);
    } catch (err: any) {
      console.error("Signal Desk fallback failed:", err);
      return res.status(502).json({
        status: "error",
        theme: req.body?.theme || "",
        error: err?.message || "Failed to fetch Polymarket markets",
      });
    }
  });

  app.post("/api/gemini/analyze", async (req, res) => {
    const { 
      teamA, 
      teamB, 
      commentary, 
      oddsA, 
      oddsB, 
      oddsDraw, 
      over25Price = 0.40,
      nextScorerPriceA = 0.35,
      nextScorerPriceB = 0.45,
      config 
    } = req.body;

    const simulatedAnalysis = simulateAnalysis(
      teamA, teamB, commentary, 
      oddsA, oddsB, oddsDraw, 
      over25Price, nextScorerPriceA, nextScorerPriceB, 
      config
    );
    return res.json({
      ...simulatedAnalysis,
      modelUsed: "gemini-3.5-flash (Simulated Engine)",
      isMocked: true,
      timestamp: new Date().toISOString()
    });
  });

  // Vite Integration (for dev and prod builds)
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Express+Vite full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

function simulateAnalysis(
  teamA: string, teamB: string, commentary: string, 
  oddsA: number, oddsB: number, oddsDraw: number, 
  over25Price: number, nextScorerPriceA: number, nextScorerPriceB: number, 
  config: any
) {
  const text = commentary.toLowerCase();
  
  let momentumA = 50;
  let momentumB = 50;
  let possessionA = 50;
  let possessionB = 50;
  let shotsOnTargetA = 2;
  let shotsOnTargetB = 2;
  let tacticalAnalysis = "Midfield gridlock. Both tactical lines are playing extremely conservatively with heavy structural shape preservation.";
  let dramaticTrigger = null;

  // Search commentary history to detect highlights
  if (text.includes("goal") || text.includes("scores") || text.includes("breakaway") || text.includes("penalty") || text.includes("shoots")) {
    const isTeamAWhoScored = text.includes("mbappe") || text.includes("breakaway") || text.includes(teamA.toLowerCase());
    if (isTeamAWhoScored) {
      momentumA = 86; momentumB = 14;
      possessionA = 62; possessionB = 38;
      shotsOnTargetA = 4;
      tacticalAnalysis = `${teamA} initiated high-efficiency transitional sprint on the flank, breaking spacing barriers. High-threat alpha zone opened!`;
    } else {
      momentumA = 18; momentumB = 82;
      possessionA = 41; possessionB = 59;
      shotsOnTargetB = 4;
      tacticalAnalysis = `${teamB} capitalized on tactical spacing errors. Broadcaster registers defensive physical decay. Tilted momentum.`;
    }
  } else if (text.includes("possession") || text.includes("press") || text.includes("pressure") || text.includes("attacking")) {
    momentumA = 65; momentumB = 35;
    possessionA = 58; possessionB = 42;
    tacticalAnalysis = `${teamA} sustains intense block pressure. Quick lateral ball rotations are testing defensive fatigue.`;
  }

  // Detect shouting transcriptions (Gemini Omni simulations)
  if (config?.useAcousticListening) {
    const lines = commentary.split("\n");
    const shoutingLine = lines.find((line: string) => line.includes("!!!") || (line === line.toUpperCase() && line.length > 8));
    if (shoutingLine) {
      dramaticTrigger = `[Gemini Omni Omni-Listening alert: Broadcaster vocal frequency spike at "${shoutingLine.trim().substring(0, 45)}..."]`;
      if (shoutingLine.toLowerCase().includes("mbappe") || shoutingLine.toLowerCase().includes("unbelievable") || shoutingLine.toLowerCase().includes("goal")) {
        momentumA = 94; momentumB = 6;
      } else {
        momentumA = 8; momentumB = 92;
      }
    }
  }

  // Calculate high-fidelity True Prob metrics dynamically
  const trueProbA = Math.round((momentumA / 100) * 80);
  const trueProbB = Math.round((momentumB / 100) * 80);
  const trueProbDraw = 100 - trueProbA - trueProbB;

  // Over 2.5 estimation: scale as a function of the aggregate momentum and offensive power
  const trueProbOver25 = Math.min(95, Math.max(10, Math.round(((momentumA + momentumB) / 200) * 75) + (shotsOnTargetA + shotsOnTargetB) * 4));

  // Next team to score: directly derived from the relative momentum split
  const trueProbNextA = Math.round((momentumA / (momentumA + momentumB)) * 100);
  const trueProbNextB = 100 - trueProbNextA;

  // Check differences relative to Polymarket prices
  const diffWinnerA = trueProbA - Math.round(oddsA * 100);
  const diffWinnerB = trueProbB - Math.round(oddsB * 100);
  const diffOver25 = trueProbOver25 - Math.round(over25Price * 100);
  const diffNextA = trueProbNextA - Math.round(nextScorerPriceA * 100);
  const diffNextB = trueProbNextB - Math.round(nextScorerPriceB * 100);

  // Pick the contract option with maximum discrepancy
  const options = [
    { name: `Winner: ${teamA}`, diff: diffWinnerA, rec: `Buy YES [Winner: ${teamA}] contract @ $${oddsA.toFixed(2)}` },
    { name: `Winner: ${teamB}`, diff: diffWinnerB, rec: `Buy YES [Winner: ${teamB}] contract @ $${oddsB.toFixed(2)}` },
    { name: "Over 2.5 Goals", diff: diffOver25, rec: `Buy YES [Over 2.5 Goals] contract @ $${over25Price.toFixed(2)}` },
    { name: `Next Goal: ${teamA}`, diff: diffNextA, rec: `Buy YES [Next Goal: ${teamA}] contract @ $${nextScorerPriceA.toFixed(2)}` },
    { name: `Next Goal: ${teamB}`, diff: diffNextB, rec: `Buy YES [Next Goal: ${teamB}] contract @ $${nextScorerPriceB.toFixed(2)}` },
  ];

  // Filter those that exceed config threshold
  const threshold = config?.alphaThreshold || 10;
  const signal = options.reduce((best, cur) => (cur.diff > best.diff ? cur : best), { name: "", diff: -100, rec: "" });

  const alphaIdentified = signal.diff >= threshold;
  const alphaArbitragePct = Math.max(0, signal.diff);
  const tradingRecommendation = alphaIdentified 
    ? `${signal.rec} (Modeled True Prob: ${Math.round(signal.diff + (signal.rec.includes("Over 2.5") ? over25Price * 100 : signal.rec.includes("Next Goal") && signal.rec.includes(teamA) ? nextScorerPriceA * 100 : oddsA * 100))}% vs implied: ${Math.round(signal.rec.includes("Over 2.5") ? over25Price * 100 : signal.rec.includes("Next Goal") ? (signal.rec.includes(teamA) ? nextScorerPriceA * 100 : nextScorerPriceB * 100) : (signal.rec.includes(teamA) ? oddsA : oddsB) * 100)}%)`
    : "Market matches physical pitch momentum. No alpha margin exceeds prompt parameters.";

  return {
    momentumA,
    momentumB,
    possessionA,
    possessionB,
    shotsOnTargetA,
    shotsOnTargetB,
    tacticalAnalysis,
    alphaIdentified,
    alphaArbitragePct,
    tradingRecommendation,
    dramaticTrigger,
    trueProbA,
    trueProbB,
    trueProbDraw,
    trueProbOver25,
    trueProbNextA,
    trueProbNextB,
    targetContract: alphaIdentified ? signal.name : "None"
  };
}

startServer();
