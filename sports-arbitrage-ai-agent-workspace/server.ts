import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

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
      try {
        const healthRes = await fetch("http://localhost:8765/health");
        if (healthRes.ok) {
          const healthData = await healthRes.json();
          nowMinute = healthData.now_minute || 0;
          matchId = healthData.match_id || "ars-man-2026-04-19";
        }
      } catch (err) {
        // Fallback to fake or 0 if Python agent server is not running
        console.warn("Could not fetch from agent_io_server health, using local simulation time:", err);
      }

      const matchDir = path.join(process.cwd(), "..", "data", "matches", matchId);
      if (!fs.existsSync(matchDir)) {
        return res.status(404).json({ error: `Match data directory not found: ${matchId}` });
      }

      const meta = JSON.parse(fs.readFileSync(path.join(matchDir, "meta.json"), "utf8"));
      const markets = JSON.parse(fs.readFileSync(path.join(matchDir, "markets.json"), "utf8"));
      const keyEvents = JSON.parse(fs.readFileSync(path.join(matchDir, "key_events.json"), "utf8"));
      const commentary = JSON.parse(fs.readFileSync(path.join(matchDir, "commentary.json"), "utf8"));

      const kickoffTime = new Date(meta.kickoff_utc).getTime();

      const activeCommentary = commentary
        .filter((c: any) => c.minute <= nowMinute)
        .sort((a: any, b: any) => b.minute - a.minute);

      const activeEvents = keyEvents
        .filter((e: any) => (e.clock.value / 60) <= nowMinute)
        .sort((a: any, b: any) => (b.clock.value / 60) - (a.clock.value / 60));

      const prices: Record<string, { price: number; delta5m: number; delta2m: number }> = {};
      for (const m of markets) {
        const tokenId = yesToken(markets, m.market_id);
        if (!tokenId) continue;

        const priceFilePath = path.join(matchDir, "prices", `${tokenId}.json`);
        if (!fs.existsSync(priceFilePath)) continue;

        const priceBlob = JSON.parse(fs.readFileSync(priceFilePath, "utf8"));
        const points = priceBlob.points || [];
        points.sort((a: any, b: any) => new Date(a.ts_utc).getTime() - new Date(b.ts_utc).getTime());

        const currentPrice = getPriceAtMinute(points, kickoffTime, nowMinute);
        const prevPrice5m = getPriceAtMinute(points, kickoffTime, Math.max(0, nowMinute - 5));
        const prevPrice2m = getPriceAtMinute(points, kickoffTime, Math.max(0, nowMinute - 2));

        prices[m.market_id] = {
          price: currentPrice,
          delta5m: currentPrice - prevPrice5m,
          delta2m: currentPrice - prevPrice2m
        };
      }

      res.json({
        minute: nowMinute,
        match_id: matchId,
        teams: { home: meta.home, away: meta.away },
        last_events: activeEvents,
        commentary: activeCommentary,
        prices
      });
    } catch (err: any) {
      console.error("Error building api state:", err);
      res.status(500).json({ error: err.message || "Internal server error" });
    }
  });

  // Replay clock proxy endpoints
  app.post("/api/replay/start", async (req, res) => {
    const fromMinute = req.query.from_minute || 0;
    try {
      const response = await fetch(`http://localhost:8765/replay/start?from_minute=${fromMinute}`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      }
    } catch (err) {
      // ignore and return simulated
    }
    res.json({ anchored_minute: Number(fromMinute), mode: "running", simulated: true });
  });

  app.post("/api/replay/seek", async (req, res) => {
    const minute = req.query.minute || 0;
    try {
      const response = await fetch(`http://localhost:8765/replay/seek?minute=${minute}`, { method: "POST" });
      if (response.ok) {
        const data = await response.json();
        return res.json(data);
      }
    } catch (err) {
      // ignore and return simulated
    }
    res.json({ now_minute: Number(minute), mode: "fixed", simulated: true });
  });

  // Live broadcast events SSE stream
  let sseClients: { id: number; res: any }[] = [];
  let sseClientIdCounter = 0;
  let lastSeenBroadcasts = 0;

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

  // Poll python agent server for broadcasts
  setInterval(async () => {
    if (sseClients.length === 0) return;
    try {
      const memoryRes = await fetch("http://localhost:8765/agent/memory");
      if (memoryRes.ok) {
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
            broadcastSse({
              type: "broadcast",
              minute: b.match_minute,
              text: b.text,
              urgency
            });
          });
          lastSeenBroadcasts = broadcasts.length;
        } else if (broadcasts.length < lastSeenBroadcasts) {
          // clock reset happened
          lastSeenBroadcasts = broadcasts.length;
        }
      }
    } catch (err) {
      // Quietly ignore
    }
  }, 1000);

  // Free-form Gemini Chat
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

  // Free-form Gemini Chat routed via RocketRide
  app.post("/api/chat", async (req, res) => {
    const { question, match_minute, prices, commentary, key_events } = req.body;

    try {
      const webhookUrl = process.env.EDGECAST_WEBHOOK_URL || "http://localhost:8080/api/pipelines/test.pipe/webhook";

      const payload = {
        match_id: "ars-man-2026-04-19",
        match_minute: match_minute || 0,
        since_minute: Math.max(0, (match_minute || 0) - 5),
        lookback_min: 5,
        new_key_events: key_events || [],
        new_commentary: commentary || [],
        polymarket_top_movers: Object.keys(prices || {}).map(mId => ({
          market_id: mId,
          question: prices[mId]?.question || mId,
          open_c: Math.round(prices[mId]?.price - prices[mId]?.delta5m) || 50,
          close_c: Math.round(prices[mId]?.price) || 50,
          delta_c: Math.round(prices[mId]?.delta5m) || 0
        })).slice(0, 5),
        // Send the user query to the agent pipeline
        question: question,
        hint: `The trader asked a live question: "${question}". Please answer this specific question in 3-5 sentences max, trader-terse, citing specific prices when relevant. Do not suggest orders.`
      };

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        const result = await response.json();
        const answer = extractRocketRideAnswer(result) || "No response generated by RocketRide.";
        res.json({
          answer,
          modelUsed: "gemini-3.5-flash (via RocketRide)",
          timestamp: new Date().toISOString()
        });
      } else {
        throw new Error(`RocketRide webhook responded with status ${response.status}`);
      }
    } catch (err: any) {
      console.warn("RocketRide webhook offline. Falling back to local heuristic response.");
      
      // Fallback response if the pipeline is offline
      const txt = question.toLowerCase();
      let answer = "EdgeCast is actively parsing live prediction markets and event logs. The RocketRide pipeline is currently offline, but our cognitive analysis highlights general stability in the contract prices. Direct your questions towards live game events.";
      
      if (txt.includes("win") || txt.includes("who will win") || txt.includes("arsenal") || txt.includes("city")) {
        answer = `At ${Math.round(match_minute || 0)}', Manchester City vs Arsenal sits in a high-tension state. Prediction markets currently price Man City to win around 62c, Arsenal around 18c, and the Draw around 20c. Physical tracking confirms City is maintaining defensive control in their own third.`;
      } else if (txt.includes("goal") || txt.includes("score")) {
        answer = "Our live spotter notes high offensive pressure from Manchester City. However, the over 2.5 goals contract remains stable at 40c, implying a low scoring velocity. Expect late game transitions.";
      }
      
      res.json({
        answer,
        modelUsed: "Heuristic Local Engine (RocketRide Offline)",
        timestamp: new Date().toISOString()
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
      console.warn("Polymarket Signal Desk Flask API offline. Falling back to heuristic model.");
    }

    const theme = req.body.theme || "football soccer today";
    const candidates = [
      {
        event_title: "Premier League Matchday",
        question: "Will Manchester City win the league?",
        yes_price: 0.62,
        volume: 4500000,
        liquidity: 350000,
        url: "https://polymarket.com",
        insight: {
          summary: "Manchester City sits at the top of the table. Erling Haaland leads scoring charts. Team shows massive momentum in recent matches.",
          sources: [
            { title: "ESPN League Table", url: "https://espn.com" },
            { title: "Sky Sports Analysis", url: "https://skysports.com" }
          ]
        }
      },
      {
        event_title: "Champions League Finals",
        question: "Will Real Madrid qualify for the Finals?",
        yes_price: 0.58,
        volume: 3800000,
        liquidity: 280000,
        url: "https://polymarket.com",
        insight: {
          summary: "Real Madrid is preparing for a crucial second leg match. Pre-match analysis shows tactical advantages in home conditions.",
          sources: [
            { title: "UEFA Champions League News", url: "https://uefa.com" }
          ]
        }
      },
      {
        event_title: "EPL Golden Boot 2026",
        question: "Will Erling Haaland win Golden Boot?",
        yes_price: 0.72,
        volume: 1200000,
        liquidity: 95000,
        url: "https://polymarket.com",
        insight: {
          summary: "Haaland has a 4-goal lead with 3 fixtures remaining. Implied market probability is high, backed by historical scoring averages.",
          sources: [
            { title: "Premier League Stats", url: "https://premierleague.com" }
          ]
        }
      }
    ];

    const rankings = [
      {
        rank: 1,
        question: "Will Erling Haaland win Golden Boot?",
        event_title: "EPL Golden Boot 2026",
        recommendation: "buy_yes",
        side: "Yes",
        price: 0.72,
        score: 91,
        reason: "Haaland holds a dominant scoring lead. Exa search evidence confirms opponent defenses are highly fatigued.",
        reason_bullets: [
          "Haaland has 4 goals lead with only 3 matches remaining.",
          "Target opponent physical records show weak defensive shapes."
        ],
        risk: "Injury risk represents the only significant downside threat.",
        risk_bullets: [
          "Severe physical exertion may lead to late-season rest rotation."
        ]
      },
      {
        rank: 2,
        question: "Will Manchester City win the league?",
        event_title: "Premier League Matchday",
        recommendation: "watch",
        side: "Yes",
        price: 0.62,
        score: 75,
        reason: "Manchester City has an edge, but upcoming fixtures against high-pressing teams suggest caution.",
        reason_bullets: [
          "City possesses deep squad rotational capability.",
          "Polymarket price already reflects general public confidence."
        ],
        risk: "Fixture congestion may impact squad quality splits.",
        risk_bullets: [
          "Champions League schedule runs concurrently with domestic title sprint."
        ]
      },
      {
        rank: 3,
        question: "Will Real Madrid qualify for the Finals?",
        event_title: "Champions League Finals",
        recommendation: "buy_yes",
        side: "Yes",
        price: 0.58,
        score: 83,
        reason: "Real Madrid exhibits high Champions League heritage and crucial home-advantage factors.",
        reason_bullets: [
          "Real Madrid has an undefeated home streak in European fixtures.",
          "Injured key player is confirmed to return for the second leg."
        ],
        risk: "Opponent counter-attacks remain highly threatening.",
        risk_bullets: [
          "Opponent flank transitional speed has caused problems in the first leg."
        ]
      }
    ];

    res.json({
      status: "ok",
      theme,
      latency_seconds: 1.42,
      reasoning: {
        provider: "heuristic-fallback",
        model: "google/gemini-3.5-flash (Fallback simulation)",
        rankings
      },
      candidates
    });
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
