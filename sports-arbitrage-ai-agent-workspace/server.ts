import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
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

    const apiKey = process.env.GEMINI_API_KEY;
    const isKeyConfigured = apiKey && apiKey !== "MY_GEMINI_API_KEY" && apiKey !== "YOUR_GEMINI_API_KEY" && apiKey.trim() !== "";

    if (!isKeyConfigured) {
      // Return high-fidelity simulation mimicking Gemini 3.5 Flash analysis when credentials are raw template placeholders
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
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const prompt = `
You are the AI Brain of an automated sports arbitrage trading loop.
Analyzing match commentary and betting odds across various Polymarket option sheets and contracts to spot Alpha (market inefficiencies/discrepancies).

MATCH DETAILS:
- Offensive / Left Side: ${teamA}
- Defensive / Right Side: ${teamB}

LATEST RECV STREAM OF SPORT TRANSCRIPT:
${commentary}

POLYMARKET IMPLIED CONTRACT PRICES:
1. Match Outcome:
   - ${teamA} YES Win Contract Price: $${oddsA} (Implied Prob: ${Math.round(oddsA * 100)}%)
   - ${teamB} YES Win Contract Price: $${oddsB} (Implied Prob: ${Math.round(oddsB * 100)}%)
   - DRAW Win Contract Price: $${oddsDraw} (Implied Prob: ${Math.round(oddsDraw * 100)}%)

2. Over/Under (Over 2.5 Goals / High Volume Scoring Metric):
   - OVER 2.5 Goals YES Contract Price: $${over25Price} (Implied Prob: ${Math.round(over25Price * 100)}%)

3. Next Team to Score:
   - ${teamA} Next Goal YES Contract Price: $${nextScorerPriceA} (Implied Prob: ${Math.round(nextScorerPriceA * 100)}%)
   - ${teamB} Next Goal YES Contract Price: $${nextScorerPriceB} (Implied Prob: ${Math.round(nextScorerPriceB * 100)}%)

AGENT CONFIGURATION:
- Listen for Screaming Broadcasters (Omni Mode): ${config?.useAcousticListening ? "YES (Priority)" : "NO"}
- Alpha Discrepancy Alert Threshold: ${config?.alphaThreshold || 10}%

YOUR TASK:
1. Parse commentary. Calculate precise numerical Momentum scores (0 to 100) for both teams based on physical exertion, offensive patterns, and threat generation on pitch.
2. Estimate mathematical TRUE probabilities of each option (value between 0 and 100):
   - "trueProbA": True probability of ${teamA} winning (0 to 100).
   - "trueProbB": True probability of ${teamB} winning (0 to 100).
   - "trueProbDraw": True probability of match ending in a draw (0 to 100).
   - "trueProbOver25": True probability of Over 2.5 Goals (0 to 100).
   - "trueProbNextA": True probability that ${teamA} will score the next goal (0 to 100).
   - "trueProbNextB": True probability that ${teamB} will score the next goal (0 to 100).
3. Check for announcer voice screaming spikes (represented as UPPERCASE transcript lines or phrases ending with exclamation marks !!!). If found, describe in "dramaticTrigger".
4. Compare your calculated True Probability indices against Polymarket's implied prices to calculate discrepancy margins.
   - Form: TrueProbPct - (MarketPrice * 100)
   - Ex: If trueProbOver25 is 72% and OVER contract price is $0.40 (40%), discrepancy is +32%.
5. Find the contract option with the MAXIMUM discrepancy. If this supreme gap exceeds your alpha discrepancy alert threshold, set alphaIdentified to true, specify which contract won in "targetContract" (e.g. "Over 2.5 Goals" or "Next Scorer: ${teamA}"), and populate "alphaArbitragePct" and a strong "tradingRecommendation".

Return your response strictly in JSON format matching this schema:
{
  "momentumA": number (0 to 100),
  "momentumB": number (0 to 100),
  "possessionA": number,
  "possessionB": number,
  "shotsOnTargetA": number,
  "shotsOnTargetB": number,
  "tacticalAnalysis": "A succinct 2-sentence tactical report on the current state of play.",
  "alphaIdentified": boolean,
  "alphaArbitragePct": number,
  "tradingRecommendation": "Suggest specific contract option order, e.g. 'Buy Over 2.5 Goals contract @ $0.40'",
  "dramaticTrigger": "Short string of broadcaster peak vocals or null",
  "trueProbA": number,
  "trueProbB": number,
  "trueProbDraw": number,
  "trueProbOver25": number,
  "trueProbNextA": number,
  "trueProbNextB": number,
  "targetContract": "Name of the option contract with the alpha"
}
`;

      const response = await ai.models.generateContent({
        model: "gemini-3.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              momentumA: { type: Type.NUMBER, description: "Momentum score of Team A from 0 to 100" },
              momentumB: { type: Type.NUMBER, description: "Momentum score of Team B from 0 to 100" },
              possessionA: { type: Type.NUMBER, description: "Estimated possession % of Team A" },
              possessionB: { type: Type.NUMBER, description: "Estimated possession % of Team B" },
              shotsOnTargetA: { type: Type.NUMBER, description: "Shots on target for Team A" },
              shotsOnTargetB: { type: Type.NUMBER, description: "Shots on target for Team B" },
              tacticalAnalysis: { type: Type.STRING, description: "Short tactical summary" },
              alphaIdentified: { type: Type.BOOLEAN, description: "Whether discrepancy exceeds threshold" },
              alphaArbitragePct: { type: Type.NUMBER, description: "The mathematical percent gap" },
              tradingRecommendation: { type: Type.STRING, description: "Recommended buy contract action" },
              dramaticTrigger: { type: Type.STRING, description: "Screaming broadcaster detected or null" },
              trueProbA: { type: Type.NUMBER },
              trueProbB: { type: Type.NUMBER },
              trueProbDraw: { type: Type.NUMBER },
              trueProbOver25: { type: Type.NUMBER },
              trueProbNextA: { type: Type.NUMBER },
              trueProbNextB: { type: Type.NUMBER },
              targetContract: { type: Type.STRING, description: "Target contract like Over 2.5 Goals or Next Goal" }
            },
            required: [
              "momentumA", "momentumB", "possessionA", "possessionB", "shotsOnTargetA", "shotsOnTargetB", 
              "tacticalAnalysis", "alphaIdentified", "alphaArbitragePct", "tradingRecommendation",
              "trueProbA", "trueProbB", "trueProbDraw", "trueProbOver25", "trueProbNextA", "trueProbNextB", "targetContract"
            ]
          }
        }
      });

      const analysisRaw = response.text?.trim() || "{}";
      const analysis = JSON.parse(analysisRaw);
      return res.json({
        ...analysis,
        modelUsed: "gemini-3.5-flash",
        isMocked: false,
        timestamp: new Date().toISOString()
      });

    } catch (err: any) {
      console.error("Gemini analysis error:", err?.message || err);
      // Fallback gracefully on key limits or API glitches
      const simulatedAnalysis = simulateAnalysis(
        teamA, teamB, commentary, 
        oddsA, oddsB, oddsDraw, 
        over25Price, nextScorerPriceA, nextScorerPriceB, 
        config
      );
      return res.json({
        ...simulatedAnalysis,
        modelUsed: "gemini-3.5-flash (Fallback Engine)",
        isMocked: true,
        error: err?.message || "Execution exception",
        timestamp: new Date().toISOString()
      });
    }
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
