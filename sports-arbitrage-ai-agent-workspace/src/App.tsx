import { useEffect, useState, useRef } from "react";
import { 
  Sparkles, Play, Pause, RotateCcw, Radio, Settings, 
  Sliders, Phone, MessageSquare, Terminal, RefreshCw, 
  Send, Check, AlertTriangle, ArrowUpRight, Volume2, 
  ShieldAlert, Layers, HelpCircle, Laptop, Activity, Plus, Trash
} from "lucide-react";

import { MATCH_SCENARIOS } from "./scenariosData";
import { MatchScenario, CommentaryLine, GeminiBrainAnalysis, ConnectedAppAlert, AgentConfiguration } from "./types";
import ConfigPanel from "./components/ConfigPanel";
import IngestionTracker from "./components/IngestionTracker";

export default function App() {
  // Config state
  const [config, setConfig] = useState<AgentConfiguration>({
    whatsappNumber: "+1 (555) 322-9011",
    ingestionSpeedMs: 4000,
    alphaThreshold: 8,
    selectedModel: "gemini-3.5-flash",
    useAcousticListening: true
  });

  // Scenario selections
  const [scenarios, setScenarios] = useState<MatchScenario[]>(MATCH_SCENARIOS);
  const [activeScenarioId, setActiveScenarioId] = useState<string>("euro-final-2026");
  const [customScenario, setCustomScenario] = useState<MatchScenario | null>(null);

  // Simulation state
  const [playbackIndex, setPlaybackIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [agentStatus, setAgentStatus] = useState<"idle" | "ingesting" | "thinking" | "spotting" | "notifying" | "paused">("idle");
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);

  // Real-time calculation variables
  const [analysisHistory, setAnalysisHistory] = useState<Record<string, GeminiBrainAnalysis[]>>({});
  const [currentAnalysis, setCurrentAnalysis] = useState<GeminiBrainAnalysis | null>(null);
  const [alertLogs, setAlertLogs] = useState<ConnectedAppAlert[]>([]);
  const [isRoutingTrade, setIsRoutingTrade] = useState<boolean>(false);
  const [executedTrades, setExecutedTrades] = useState<Array<{
    id: string;
    timestamp: string;
    contract: string;
    action: string;
    price: number;
    margin: number;
    status: "FILLED" | "ROUTING" | "REJECTED";
  }>>([
    {
      id: "TX-INIT5",
      timestamp: "00' (Pre)",
      contract: "Neural Arbitrage System",
      action: "MONITOR",
      price: 0.00,
      margin: 0,
      status: "FILLED"
    }
  ]);
  
  // Custom sandbox creators
  const [isSandboxCreatorOpen, setIsSandboxCreatorOpen] = useState<boolean>(false);
  const [customTeamA, setCustomTeamA] = useState<string>("France");
  const [customTeamB, setCustomTeamB] = useState<string>("Spain");
  const [customSport, setCustomSport] = useState<string>("Soccer");
  const [customCommentaryListStr, setCustomCommentaryListStr] = useState<string>(
    "80' - FRANCE SUSTAINS INTENSE POWER ATTRIBUTES.\n82' - MBAPPE BREACHES SPACING PARAMETERS WITH SENSATIONAL TRANSITIONAL FLANK SPEED.\n84' - SPAIN DEFENSE LOOKS TIRED."
  );

  // Local Time dynamic stamp
  const [currentTimeUTC, setCurrentTimeUTC] = useState<string>("");

  // Refs for tracking async odds updates
  const prevOddsRef = useRef<{ yesA: number; yesB: number; draw: number } | undefined>(undefined);

  // Get current active match
  const activeScenario = activeScenarioId === "custom" && customScenario 
    ? customScenario 
    : scenarios.find(s => s.id === activeScenarioId) || scenarios[0];

  // Derive current timeline status
  const totalSteps = activeScenario.commentsTimeline.length;
  const currentCommentaryIndex = Math.min(playbackIndex, activeScenario.commentsTimeline.length - 1);
  const activeCommentaryList = activeScenario.commentsTimeline.slice(0, playbackIndex + 1);

  // Current live odds mapping (interpolation based on index or manually adjusted)
  const currentOddsConfig = activeScenario.polymarketOddsTimeline[
    Math.min(playbackIndex, activeScenario.polymarketOddsTimeline.length - 1)
  ] || { yesA: 0.5, yesB: 0.4, draw: 0.1, over25: 0.40, nextScorerA: 0.35, nextScorerB: 0.45 };

  // Sync prev odds
  useEffect(() => {
    prevOddsRef.current = currentOddsConfig;
  }, [playbackIndex, activeScenarioId]);

  // Clock Synchronization
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      setCurrentTimeUTC(
        now.getUTCFullYear() + "-" +
        String(now.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(now.getUTCDate()).padStart(2, "0") + " " +
        String(now.getUTCHours()).padStart(2, "0") + ":" +
        String(now.getUTCMinutes()).padStart(2, "0") + ":" +
        String(now.getUTCSeconds()).padStart(2, "0") + " UTC"
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Check if real API key is ready
  const isApiConfigured = true; // Handled directly on express endpoint internally

  // Continuous ingestion loop handler
  useEffect(() => {
    let timer: NodeJS.Timeout | null = null;
    if (isPlaying) {
      setAgentStatus("ingesting");
      timer = setInterval(() => {
        setPlaybackIndex((prev) => {
          const nextVal = prev + 1;
          if (nextVal >= totalSteps) {
            setIsPlaying(false);
            setAgentStatus("paused");
            return prev;
          }
          return nextVal;
        });
      }, config.ingestionSpeedMs);
    } else {
      setAgentStatus("paused");
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, totalSteps, config.ingestionSpeedMs]);

  // React to playback Index change & trigger AI Brain
  useEffect(() => {
    if (activeCommentaryList.length === 0) {
      setCurrentAnalysis(null);
      return;
    }

    const fetchAnalysis = async () => {
      setIsAnalyzing(true);
      setAgentStatus("thinking");
      
      const latestCommentariesText = activeCommentaryList
        .map(c => `[Time: ${c.timeOffset}] [Intensity: ${c.intensity.toUpperCase()}] ${c.text} ${c.audioTranscription ? `(${c.audioTranscription})` : ''}`)
        .join("\n");

      try {
        const response = await fetch("/api/gemini/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teamA: activeScenario.teamA,
            teamB: activeScenario.teamB,
            commentary: latestCommentariesText,
            oddsA: currentOddsConfig.yesA,
            oddsB: currentOddsConfig.yesB,
            oddsDraw: currentOddsConfig.draw,
            over25Price: currentOddsConfig.over25 || 0.40,
            nextScorerPriceA: currentOddsConfig.nextScorerA || 0.35,
            nextScorerPriceB: currentOddsConfig.nextScorerB || 0.45,
            config: config
          })
        });

        if (!response.ok) throw new Error("Server error");
        
        const data: GeminiBrainAnalysis = await response.json();
        setCurrentAnalysis(data);

        // Spotting state toggle
        if (data.alphaIdentified) {
          setAgentStatus("spotting");
          
          // Trigger alert dispatch
          setTimeout(() => {
            setAgentStatus("notifying");
            
            const newAlert: ConnectedAppAlert = {
              id: Math.random().toString(36).substring(4, 9),
              timestamp: new Date().toLocaleTimeString(),
              matchTime: activeCommentaryList[activeCommentaryList.length - 1]?.timeOffset || "75'",
              message: `🚨 [NeuralStrike Alpha: ${data.targetContract}] Arbi Discrepancy of +${data.alphaArbitragePct}%! Play-by-play Pressure: ${activeScenario.teamA} ${data.momentumA}% - ${activeScenario.teamB} ${data.momentumB}%. Action: ${data.tradingRecommendation}`,
              recipient: config.whatsappNumber,
              status: "delivered",
              arbitragePct: data.alphaArbitragePct || 11,
              recommendation: data.tradingRecommendation || `Buy YES on ${activeScenario.teamA}`
            };

            // Prevent duplicate logs for the same timeoffset within the active scenario list
            setAlertLogs(prev => {
              const exists = prev.some(item => item.matchTime === newAlert.matchTime && item.recommendation === newAlert.recommendation);
              if (exists) return prev;
              return [newAlert, ...prev];
            });

            // ALSO automatically fill position in trade ledger for real-time visual synchronization
            let finalPrice = 0.40;
            const target = data.targetContract || "None";
            if (target.includes("Winner") && target.includes(activeScenario.teamA)) {
              finalPrice = currentOddsConfig.yesA;
            } else if (target.includes("Winner") && target.includes(activeScenario.teamB)) {
              finalPrice = currentOddsConfig.yesB;
            } else if (target.includes("Over 2.5 Goals")) {
              finalPrice = currentOddsConfig.over25 || 0.40;
            } else if (target.includes("Next Goal") && target.includes(activeScenario.teamA)) {
              finalPrice = currentOddsConfig.nextScorerA || 0.35;
            } else if (target.includes("Next Goal") && target.includes(activeScenario.teamB)) {
              finalPrice = currentOddsConfig.nextScorerB || 0.45;
            }

            const autoTrade = {
              id: "TX-" + Math.floor(10000 + Math.random() * 90000).toString(16).toUpperCase(),
              timestamp: activeCommentaryList[activeCommentaryList.length - 1]?.timeOffset || "75'",
              contract: target,
              action: "BUY YES",
              price: finalPrice,
              margin: data.alphaArbitragePct || 10,
              status: "FILLED" as const
            };

            setExecutedTrades(prev => {
              const exists = prev.some(t => t.timestamp === autoTrade.timestamp && t.contract === autoTrade.contract);
              if (exists) return prev;
              return [autoTrade, ...prev];
            });

            // Transition state back to spotting high-yielding opportunities
            setTimeout(() => {
              setAgentStatus(isPlaying ? "ingesting" : "paused");
            }, 1000);

          }, 800);
        } else {
          setAgentStatus(isPlaying ? "ingesting" : "paused");
        }

      } catch (err) {
        console.error("Failed to query analysis brain:", err);
      } finally {
        setIsAnalyzing(false);
      }
    };

    fetchAnalysis();

  }, [playbackIndex, activeScenarioId, config.useAcousticListening]);

  // Handler for custom sandbox generation
  const handleCreateCustomScenario = () => {
    const rawComments = customCommentaryListStr.split("\n").filter(l => l.trim() !== "");
    const comments: CommentaryLine[] = rawComments.map((line, idx) => {
      const matchTime = line.match(/^(\d+[':]?\d*)/);
      const timeOffset = matchTime ? matchTime[1] : `${80 + idx}'`;
      const cleanText = line.replace(/^(\d+[':]?\d*\s*-\s*)/, "");
      return {
        timeOffset,
        text: cleanText,
        intensity: cleanText.toUpperCase().includes("GOAL") || cleanText.toUpperCase().includes("MBAPPE") ? "critical" : "high",
        audioTranscription: cleanText.toUpperCase() + "!!!",
        teamFocus: idx % 2 === 0 ? "A" : "B"
      };
    });

    const mockScenario: MatchScenario = {
      id: "custom",
      sport: customSport,
      teamA: customTeamA,
      teamAImage: "⭐",
      teamB: customTeamB,
      teamBImage: "⚡",
      venue: "Custom Sandbox Arena",
      description: "User-generated sports physical scenario highlighting asymmetric market timing anomalies.",
      polymarketOddsTimeline: comments.map((_, i) => ({
        yesA: Math.max(0.1, 0.4 - (i * 0.04)), // Odds sleeping down
        yesB: Math.min(0.9, 0.5 + (i * 0.04)),
        draw: 0.1,
        over25: Math.max(0.1, 0.45 - (i * 0.03)),
        nextScorerA: Math.max(0.1, 0.35 - (i * 0.02)),
        nextScorerB: Math.min(0.9, 0.55 + (i * 0.02))
      })),
      commentsTimeline: comments
    };

    setCustomScenario(mockScenario);
    setActiveScenarioId("custom");
    setPlaybackIndex(0);
    setAlertLogs([]);
    setIsSandboxCreatorOpen(false);
  };

  // Adjust baseline odds dynamically (Sandbox helper)
  const handleBaselineOddsChange = (target: "A" | "B" | "draw" | "over25" | "nextScorerA" | "nextScorerB", val: number) => {
    if (!customScenario) return;
    const updatedTimeline = [...customScenario.polymarketOddsTimeline];
    const targetKey = 
      target === "A" ? "yesA" : 
      target === "B" ? "yesB" : 
      target === "draw" ? "draw" : 
      target === "over25" ? "over25" :
      target === "nextScorerA" ? "nextScorerA" : "nextScorerB";

    updatedTimeline[playbackIndex] = {
      ...updatedTimeline[playbackIndex],
      [targetKey]: val
    };

    setCustomScenario({
      ...customScenario,
      polymarketOddsTimeline: updatedTimeline
    });
  };

  const handleExecuteRecommendedTrade = () => {
    if (!currentAnalysis || !currentAnalysis.alphaIdentified || isRoutingTrade) return;

    setIsRoutingTrade(true);

    setTimeout(() => {
      let finalPrice = 0.40;
      const target = currentAnalysis.targetContract || "None";
      if (target.includes("Winner") && target.includes(activeScenario.teamA)) {
        finalPrice = currentOddsConfig.yesA;
      } else if (target.includes("Winner") && target.includes(activeScenario.teamB)) {
        finalPrice = currentOddsConfig.yesB;
      } else if (target.includes("Over 2.5 Goals")) {
        finalPrice = currentOddsConfig.over25 || 0.40;
      } else if (target.includes("Next Goal") && target.includes(activeScenario.teamA)) {
        finalPrice = currentOddsConfig.nextScorerA || 0.35;
      } else if (target.includes("Next Goal") && target.includes(activeScenario.teamB)) {
        finalPrice = currentOddsConfig.nextScorerB || 0.45;
      }

      const newTrade = {
        id: "TX-" + Math.floor(10000 + Math.random() * 90000).toString(16).toUpperCase(),
        timestamp: activeCommentaryList[activeCommentaryList.length - 1]?.timeOffset || "75'",
        contract: target,
        action: "BUY YES",
        price: finalPrice,
        margin: currentAnalysis.alphaArbitragePct || 10,
        status: "FILLED" as const
      };

      setExecutedTrades(prev => {
        const exists = prev.some(t => t.timestamp === newTrade.timestamp && t.contract === newTrade.contract);
        if (exists) return prev;
        return [newTrade, ...prev];
      });

      setIsRoutingTrade(false);
    }, 750);
  };

  // Reset progress handlers
  const handleReset = () => {
    setPlaybackIndex(0);
    setAlertLogs([]);
    setExecutedTrades([
      {
        id: "TX-INIT5",
        timestamp: "00' (Pre)",
        contract: "Neural Arbitrage System",
        action: "MONITOR",
        price: 0.00,
        margin: 0,
        status: "FILLED"
      }
    ]);
    setIsPlaying(false);
    setCurrentAnalysis(null);
    setAgentStatus("paused");
  };

  return (
    <div className="min-h-screen bg-[#050608] text-slate-200 font-sans overflow-x-hidden relative flex flex-col justify-between" id="immersive-hud-root">
      
      {/* Background Atmosphere Lights */}
      <div className="absolute inset-0 opacity-40 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-950/40 blur-[120px]"></div>
        <div className="absolute top-[20%] left-[30%] w-[40%] h-[40%] rounded-full bg-purple-950/20 blur-[100px]"></div>
      </div>

      {/* Header HUD Navigation */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-black/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-tr from-cyan-600 via-violet-600 to-emerald-500 flex items-center justify-center shadow-lg shadow-violet-955/40">
            <span className="text-xs font-black text-black">NR</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs md:text-sm font-bold tracking-[0.25em] uppercase text-white bg-gradient-to-r from-white via-slate-300 to-slate-500 bg-clip-text text-transparent">
              NeuralStrike // Core Agentic Flow
            </span>
            <span className="text-[9px] font-mono text-gray-400 tracking-wider">AUTOMATED ALPHA EXTRACTOR</span>
          </div>
        </div>

        <div className="flex gap-6 items-center">
          <div className="hidden md:flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">System Loop Active</span>
          </div>
          <div className="hidden md:block h-4 w-[1px] bg-white/10"></div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400">
            Polymarket Ping: <span className="text-cyan-400">14ms</span>
          </div>
        </div>
      </header>

      {/* Main Workflow Grid */}
      <main className="flex-1 p-6 md:p-8 xl:p-10 grid grid-cols-1 lg:grid-cols-12 gap-6 relative z-10 max-w-7xl mx-auto w-full">
        
        {/* Column 01: Continuous Data Ingestion Feed (01. Ingestion Desk) */}
        <section className="lg:col-span-4 flex flex-col gap-5">
          
          {/* Dual Ingest Feed Container */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-4 backdrop-blur-sm shadow-xl hover:border-white/20 transition-all duration-300 flex-1 justify-between">
            <div className="flex flex-col gap-3">
              <div className="flex justify-between items-center pb-2 border-b border-white/5">
                <div className="flex flex-col">
                  <h3 className="text-[11px] font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-1">
                    <Layers className="w-3.5 h-3.5" />
                    01. Dual-Data Ingestion
                  </h3>
                  <span className="text-[9px] text-gray-500 font-mono">Stream Synchronizer v2.5</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-[8px] border border-cyan-500/20 font-mono animate-pulse uppercase">
                  Sockets Active
                </span>
              </div>

              {/* Match Scenario Switcher */}
              <div className="bg-zinc-950/40 p-3 rounded-xl border border-white/5 space-y-1.5">
                <label className="text-[9px] font-mono uppercase text-gray-400 block tracking-wider">Target Match Case Study</label>
                <select
                  value={activeScenarioId}
                  onChange={(e) => {
                    setActiveScenarioId(e.target.value);
                    handleReset();
                  }}
                  className="w-full bg-black/85 border border-white/10 rounded-lg p-2 text-xs font-mono text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
                >
                  {scenarios.map(s => (
                    <option key={s.id} value={s.id}>{s.teamA} vs {s.teamB} ({s.sport})</option>
                  ))}
                  {customScenario && <option value="custom">Custom Sandbox: {customScenario.teamA} vs {customScenario.teamB}</option>}
                </select>
                <div className="text-[8px] font-mono text-gray-500 italic mt-1 block">
                  Clicking resets loop indexes to sync timelines. Venue: {activeScenario.venue}
                </div>
              </div>

              {/* Commentary Feed Display snippet */}
              <div className="bg-black/40 rounded-lg p-3 border border-white/5 space-y-2">
                <div className="flex justify-between text-[10px] pb-1 font-mono text-gray-500 border-b border-white/5">
                  <span>STREAM I: COMMENTARY FEED</span>
                  <span className="text-cyan-400">INDEX: #{playbackIndex + 1}/{totalSteps}</span>
                </div>
                <div className="text-xs font-mono leading-relaxed text-blue-100 italic min-h-[50px] flex items-center">
                  "{activeCommentaryList[activeCommentaryList.length - 1]?.text || "Awaiting physical block transition stream..."}"
                </div>
              </div>

              {/* Odds feed widget */}
              <div className="bg-black/40 rounded-lg p-3 border border-white/5 space-y-2.5">
                <div className="flex justify-between text-[10px] pb-1 font-mono text-gray-500 border-b border-white/5">
                  <span>STREAM II: POLYMARKET IMPLICIT</span>
                  <span className="text-emerald-400 font-semibold">${(currentOddsConfig.yesA + currentOddsConfig.yesB + currentOddsConfig.draw).toFixed(1)} Liquidity</span>
                </div>
                
                <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
                  <div className="bg-zinc-950/40 p-1.5 rounded border border-white/5">
                    <span className="text-[8px] text-gray-500 block truncate">YES {activeScenario.teamA}</span>
                    <span className="text-indigo-400 font-bold">${currentOddsConfig.yesA.toFixed(2)}</span>
                  </div>
                  <div className="bg-zinc-950/40 p-1.5 rounded border border-white/5">
                    <span className="text-[8px] text-gray-500 block truncate">YES {activeScenario.teamB}</span>
                    <span className="text-rose-400 font-bold">${currentOddsConfig.yesB.toFixed(2)}</span>
                  </div>
                  <div className="bg-zinc-950/40 p-1.5 rounded border border-white/5">
                    <span className="text-[8px] text-gray-500 block">DRAW</span>
                    <span className="text-gray-400">${currentOddsConfig.draw.toFixed(2)}</span>
                  </div>
                </div>

                {/* Secondary contract options displaying over/under and next scorer */}
                <div className="pt-2 border-t border-white/5 space-y-1.5">
                  <div className="text-[8px] font-mono uppercase tracking-wider text-gray-500 flex items-center justify-between">
                    <span>Active Side-Sheet Contracts</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-[9px] font-mono">
                    <div className="bg-zinc-950/20 p-1.5 rounded border border-white/5">
                      <span className="text-[8px] text-cyan-400 block truncate">O/U 2.5 Goals</span>
                      <span className="text-slate-300 font-bold">${(currentOddsConfig.over25 ?? 0.40).toFixed(2)}</span>
                    </div>
                    <div className="bg-zinc-950/20 p-1.5 rounded border border-white/5">
                      <span className="text-[8px] text-cyan-400 block truncate">Next: {activeScenario.teamA}</span>
                      <span className="text-slate-300 font-bold">${(currentOddsConfig.nextScorerA ?? 0.35).toFixed(2)}</span>
                    </div>
                    <div className="bg-zinc-950/20 p-1.5 rounded border border-white/5">
                      <span className="text-[8px] text-cyan-400 block truncate">Next: {activeScenario.teamB}</span>
                      <span className="text-slate-300 font-bold">${(currentOddsConfig.nextScorerB ?? 0.45).toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Ingress manual steppers */}
            <div className="space-y-3 pt-3 border-t border-white/5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-mono text-gray-400">Ingestion progress stepper:</span>
                <div className="flex gap-1">
                  <button 
                    onClick={() => setPlaybackIndex(prev => Math.max(0, prev - 1))}
                    className="px-2 py-1 bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 rounded text-[9px] font-mono text-slate-300 transition-all cursor-pointer"
                    disabled={playbackIndex === 0}
                  >
                    PREV
                  </button>
                  <div className="px-2 py-1 bg-zinc-900 border border-white/5 rounded text-[9px] font-mono font-bold text-white">
                    Step {playbackIndex + 1}/{totalSteps}
                  </div>
                  <button 
                    onClick={() => setPlaybackIndex(prev => Math.min(totalSteps - 1, prev + 1))}
                    className="px-2 py-1 bg-white/5 hover:bg-white/10 active:bg-white/20 border border-white/10 rounded text-[9px] font-mono text-slate-300 transition-all cursor-pointer"
                    disabled={playbackIndex === totalSteps - 1}
                  >
                    NEXT
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Column 02: AI Brain Cognitive Center (02. Cognitive Desk) */}
        <section className="lg:col-span-4 flex flex-col">

          {/* AI Brain Card container */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col gap-3.5 backdrop-blur-sm flex-1 shadow-xl hover:border-white/20 transition-all duration-300">
            <div className="flex justify-between items-center pb-2 border-b border-white/5">
              <div className="flex flex-col">
                <h3 className="text-[11px] font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  02. The AI Brain
                </h3>
                <span className="text-[9px] text-gray-500 font-mono">Cognitive Speed reasoning</span>
              </div>
              <span className="text-[9px] opacity-60 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded text-amber-400 font-mono uppercase">
                {currentAnalysis?.modelUsed || "Initializing..."}
              </span>
            </div>

            <div className="relative flex-1 bg-black/40 rounded-xl border border-white/5 p-4 overflow-hidden flex flex-col justify-between">
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping"></div>
                    <span className="text-[10px] text-amber-200/80 font-mono uppercase tracking-wider">
                      {isAnalyzing ? "Processing Play-By-Play Context..." : "Momentum State Analysed"}
                    </span>
                  </div>
                  {isAnalyzing && <RefreshCw className="w-3 h-3 text-amber-400 animate-spin" />}
                </div>

                {currentAnalysis ? (
                  <div className="text-xs font-light text-slate-300 space-y-3">
                    <div className="pl-3 border-l-2 border-amber-500/40 text-[11px] text-gray-300 leading-normal">
                      {currentAnalysis.tacticalAnalysis}
                    </div>

                    {/* Momentum and metrics visual representation */}
                    <div className="space-y-2 pt-1 font-mono text-[10px]">
                      <div className="space-y-1">
                        <div className="flex justify-between text-gray-400">
                          <span>{activeScenario.teamA} PHYSICAL PRESSURE</span>
                          <span className="text-indigo-400 font-bold">{currentAnalysis.momentumA}%</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500" style={{ width: `${currentAnalysis.momentumA}%` }}></div>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="flex justify-between text-gray-400">
                          <span>{activeScenario.teamB} PHYSICAL PRESSURE</span>
                          <span className="text-rose-400 font-bold">{currentAnalysis.momentumB}%</span>
                        </div>
                        <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-orange-500 to-rose-500" style={{ width: `${currentAnalysis.momentumB}%` }}></div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-white/5">
                        <div>
                          <span className="text-[9px] text-gray-500 uppercase block">Est-Possession</span>
                          <span className="text-[11px] text-slate-300 font-bold">{currentAnalysis.possessionA}% vs {currentAnalysis.possessionB}%</span>
                        </div>
                        <div>
                          <span className="text-[9px] text-gray-500 uppercase block">Shots-On-Target</span>
                          <span className="text-[11px] text-slate-300 font-bold">{currentAnalysis.shotsOnTargetA} vs {currentAnalysis.shotsOnTargetB}</span>
                        </div>
                      </div>

                      {/* True Probabilities vs Real-Time Polymarket Implied Price Comparisons */}
                      <div className="pt-2 border-t border-white/10 space-y-1.5 bg-white/[0.01] p-1.5 rounded-lg border border-white/5">
                        <span className="text-[9px] text-amber-400 font-mono uppercase block tracking-wider font-bold">
                          🧠 Neural Model True Prob vs Implied Price
                        </span>
                        <div className="space-y-1 text-[9px] font-mono leading-relaxed">
                          {/* Outcome Comparison */}
                          <div className="flex justify-between items-center text-gray-400">
                            <span>Winner ({activeScenario.teamA})</span>
                            <span className="text-slate-300 text-right">
                              AI: <span className="text-amber-400 font-bold">{(currentAnalysis.trueProbA ?? 50)}%</span> vs Poly: <span className="text-indigo-400 font-bold">{Math.round(currentOddsConfig.yesA * 100)}%</span>
                            </span>
                          </div>
                          
                          {/* Over 2.5 Comparison */}
                          <div className="flex justify-between items-center text-gray-400">
                            <span>Over 2.5 goals</span>
                            <span className="text-slate-300 text-right">
                              AI: <span className="text-amber-400 font-bold">{(currentAnalysis.trueProbOver25 ?? 40)}%</span> vs Poly: <span className="text-indigo-400 font-bold">{Math.round((currentOddsConfig.over25 ?? 0.40) * 100)}%</span>
                            </span>
                          </div>

                          {/* Next Goal Comparison A */}
                          <div className="flex justify-between items-center text-gray-400">
                            <span>Next Scorer ({activeScenario.teamA})</span>
                            <span className="text-slate-300 text-right">
                              AI: <span className="text-amber-400 font-bold">{(currentAnalysis.trueProbNextA ?? 35)}%</span> vs Poly: <span className="text-indigo-400 font-bold">{Math.round((currentOddsConfig.nextScorerA ?? 0.35) * 100)}%</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 leading-relaxed font-mono italic">
                    Push loop play or skip step forward to dispatch physical play text to Gemini 3.5 Flash...
                  </p>
                )}
              </div>

              {/* Shouting announcer / acoustic native wave simulation */}
              {config.useAcousticListening && currentAnalysis?.dramaticTrigger && (
                <div className="mt-3 p-2 bg-pink-950/10 border border-pink-900/40 rounded flex items-center gap-2">
                  <div className="flex gap-0.5 items-end h-5">
                    <span className="w-0.5 bg-pink-500 h-2 voice-bar"></span>
                    <span className="w-0.5 bg-pink-400 h-4 voice-bar" style={{ animationDelay: "0.2s" }}></span>
                    <span className="w-0.5 bg-pink-500 h-3 voice-bar" style={{ animationDelay: "0.4s" }}></span>
                    <span className="w-0.5 bg-pink-400 h-5 voice-bar" style={{ animationDelay: "0.1s" }}></span>
                  </div>
                  <div className="text-[9px] font-mono text-pink-400 truncate flex-1">
                    <span className="font-bold text-[8px] uppercase block text-pink-500">Omni High-Frequency Peak</span>
                    {currentAnalysis.dramaticTrigger}
                  </div>
                </div>
              )}

              {/* Decorative circle dashed vector matching design mock */}
              <div className="absolute bottom-1 right-1 pointer-events-none opacity-10">
                <svg width="45" height="45" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#fbbf24" strokeWidth="1" strokeDasharray="4 4" />
                </svg>
              </div>

            </div>
          </div>

        </section>

        {/* Step 3: Neural Alpha Spotting & Recommended Bet Execution */}
        <section className="lg:col-span-4 flex flex-col">
          <div className="bg-gradient-to-b from-emerald-500/10 via-[#070e0a]/40 to-transparent border border-emerald-500/15 rounded-3xl p-5 flex flex-col items-center justify-between text-center backdrop-blur-md shadow-2xl relative overflow-hidden flex-1 group gap-4">
            
            <div className="absolute top-0 right-0 p-3 text-[8px] font-mono text-emerald-400/60 uppercase">
              Asymmetric Engine Active
            </div>

            <div className="w-full flex justify-between items-center text-[9px] uppercase font-mono text-gray-500 pb-2 border-b border-white/5">
              <span>03. Spotting the Alpha</span>
              <span className="text-emerald-400 font-bold px-1.5 py-0.5 bg-emerald-950/40 border border-emerald-900/40 rounded">
                Mismatch Monitor
              </span>
            </div>

            {/* Micro Alpha Sphere Indicator */}
            <div className="relative flex flex-col items-center my-1 shrink-0">
              <div className={`w-16 h-16 rounded-full border-2 flex items-center justify-center transition-all duration-500 ${
                currentAnalysis?.alphaIdentified 
                  ? "bg-emerald-500/20 border-emerald-400 shadow-[0_0_35px_rgba(16,185,129,0.35)] scale-[1.03]" 
                  : "bg-white/5 border-white/10 opacity-60"
              }`}>
                {currentAnalysis?.alphaIdentified ? (
                  <span className="text-2xl font-black text-emerald-400 animate-pulse">α</span>
                ) : (
                  <span className="text-xl font-light text-slate-500">α</span>
                )}
              </div>
              <div className="absolute inset-0 border border-emerald-500/5 rounded-full animate-spin pointer-events-none" style={{ animationDuration: "14s" }}></div>
            </div>

            {/* Mismatch Arbitrage Matrix */}
            <div className="w-full space-y-2 bg-black/50 p-3 rounded-xl border border-white/5 text-left font-mono">
              <span className="text-[8px] tracking-wider text-gray-400 block uppercase font-bold text-[8px]">Active Contract Mispricing Sheets ({activeScenario.teamA})</span>
              <div className="space-y-1.5 text-[9px]">
                
                {[
                  { name: `Winner: ${activeScenario.teamA}`, prob: currentAnalysis?.trueProbA ?? 50, price: Math.round(currentOddsConfig.yesA * 100) },
                  { name: `Winner: ${activeScenario.teamB}`, prob: currentAnalysis?.trueProbB ?? 40, price: Math.round(currentOddsConfig.yesB * 100) },
                  { name: "Over 2.5 Soccer goals", prob: currentAnalysis?.trueProbOver25 ?? 40, price: Math.round((currentOddsConfig.over25 ?? 0.40) * 100) },
                  { name: `Next Scorer: ${activeScenario.teamA}`, prob: currentAnalysis?.trueProbNextA ?? 35, price: Math.round((currentOddsConfig.nextScorerA ?? 0.35) * 100) },
                  { name: `Next Scorer: ${activeScenario.teamB}`, prob: currentAnalysis?.trueProbNextB ?? 45, price: Math.round((currentOddsConfig.nextScorerB ?? 0.45) * 100) },
                ].map((item, idx) => {
                  const edge = item.prob - item.price;
                  const hasAlpha = edge >= config.alphaThreshold;
                  return (
                    <div key={idx} className="flex flex-col gap-0.5 border-b border-white/[0.03] pb-1 last:border-0 last:pb-0">
                      <div className="flex justify-between items-center text-gray-300">
                        <span className="truncate max-w-[140px] text-gray-400">{item.name}</span>
                        <div className="flex gap-2 items-center">
                          <span>Model {item.prob}% / Poly {item.price}%</span>
                          {hasAlpha ? (
                            <span className="text-[8px] bg-emerald-950/80 border border-emerald-800 text-emerald-400 px-1 py-px rounded font-black">
                              +{edge}% EDGE
                            </span>
                          ) : (
                            <span className="text-[8px] bg-zinc-900/60 text-gray-400 px-1 py-px rounded">
                              {edge > 0 ? `+${edge}%` : `${edge}%`}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Gemini Recommended order decisions */}
            <div className="w-full">
              {currentAnalysis?.alphaIdentified ? (
                <div className="bg-amber-500/10 border border-amber-500/25 rounded-xl p-3 text-left space-y-1.5 shadow-[0_0_15px_rgba(245,158,11,0.05)]">
                  <span className="text-[8px] text-amber-400 font-mono uppercase tracking-widest block font-black">
                    🎯 GEMINI SUPREME AL ALPHA SELECTION
                  </span>
                  <div className="text-xs font-bold text-white tracking-tight">
                    TARGET: <span className="text-amber-400 font-mono">{currentAnalysis.targetContract}</span>
                  </div>
                  <div className="text-[10px] text-slate-300 font-mono leading-normal font-sans">
                    {currentAnalysis.tradingRecommendation || "Pending model buy target code sequence..."}
                  </div>
                  <div className="text-[9px] font-mono text-emerald-400 font-semibold bg-emerald-950/20 px-1.5 py-0.5 rounded border border-emerald-950/60 inline-block">
                    Arbitrage Discrepancy Spread: +{currentAnalysis.alphaArbitragePct}%
                  </div>
                </div>
              ) : (
                <div className="bg-zinc-950/40 border border-white/5 rounded-xl p-3 text-center space-y-1">
                  <span className="text-[8px] text-gray-500 font-mono uppercase block tracking-wider font-bold">RECOMMENDED ORDER</span>
                  <div className="text-[10px] text-gray-400 font-mono italic">
                    Awaiting anomaly detection gap &gt;= +{config.alphaThreshold}% to lock Gemini's trade target...
                  </div>
                </div>
              )}
            </div>

            {/* Large primary Execute Trade button */}
            <button
              onClick={handleExecuteRecommendedTrade}
              disabled={!currentAnalysis?.alphaIdentified || isRoutingTrade}
              className={`w-full h-12 rounded-xl font-bold font-mono tracking-wider text-[11px] uppercase transition-all flex items-center justify-center gap-2 ${
                isRoutingTrade 
                  ? "bg-violet-900 border border-violet-800/40 text-violet-300 cursor-wait animate-pulse"
                  : currentAnalysis?.alphaIdentified
                    ? "bg-gradient-to-r from-emerald-500 to-emerald-400 text-black hover:scale-[1.01] hover:shadow-[0_0_20px_rgba(52,211,153,0.3)] shadow-md cursor-pointer"
                    : "bg-zinc-900 text-zinc-500 border border-zinc-800 cursor-not-allowed"
              }`}
            >
              {isRoutingTrade ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
                  Routing Swap Via Oracle...
                </>
              ) : currentAnalysis?.alphaIdentified ? (
                <>
                  <ArrowUpRight className="w-4 h-4 text-black shrink-0" />
                  Execute Trade: YES Contract
                </>
              ) : (
                "Alpha Not Spotted Yet"
              )}
            </button>

            {/* Simulated Live Confirmed Transaction Ledger */}
            <div className="w-full bg-black/70 border border-white/5 rounded-xl p-3 flex flex-col gap-1.5 font-mono text-left">
              <span className="text-[8px] text-gray-500 uppercase block tracking-widest font-bold">Algorithmic Order-Book Filled Ledger</span>
              <div className="h-[95px] overflow-y-auto space-y-1.5 pr-1.5 custom-scrollbar text-[9px]">
                {executedTrades.length === 0 ? (
                  <div className="text-[8px] text-gray-600 italic text-center pt-8">
                    No confirmed swaps filled yet on the smart ledger...
                  </div>
                ) : (
                  [...executedTrades].map((trade, idx) => (
                    <div key={idx} className="bg-zinc-950/65 p-1.5 rounded border border-white/[0.03] flex items-center justify-between text-[8px] leading-relaxed">
                      <div className="space-y-0.5 max-w-[130px]">
                        <div className="flex items-center gap-1.5 text-white">
                          <span className="text-indigo-400 font-bold">{trade.id}</span>
                          <span className="truncate block font-semibold text-slate-300">{trade.contract}</span>
                        </div>
                        <div className="text-[8px] text-gray-400 block font-mono">Conf Time: {trade.timestamp}</div>
                      </div>
                      <div className="text-right font-mono">
                        <div className="text-emerald-400 font-black">FILLED</div>
                        <div className="text-gray-400 block">${trade.price.toFixed(2)} / <span className="text-amber-400 font-bold">+{trade.margin}% Ed</span></div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

          </div>
        </section>



      </main>

      {/* Threshold Panels & Sandbox controls */}
      <section className="bg-black/40 border-t border-b border-white/10 py-6 px-6 md:px-12 relative z-10">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          
          <div className="col-span-1 md:col-span-4 text-left space-y-1.5">
            <h4 className="text-xs uppercase font-mono text-white tracking-widest flex items-center gap-1.5">
              <Sliders className="w-4 h-4 text-violet-400" />
              Adjust Alpha Margin Rules
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed font-light">
              Customize local simulated properties to witness simulated push routing execution metrics when momentum discrepancy triggers.
            </p>
          </div>

          <div className="col-span-1 md:col-span-8">
            <ConfigPanel 
              config={config} 
              onChange={setConfig} 
              isCustomScenario={activeScenarioId === "custom"}
              currentOdds={currentOddsConfig}
              onBaselineOddsChange={handleBaselineOddsChange}
            />
          </div>

        </div>
      </section>

      {/* Detailed Live Feeds Trackers (Ingestion tracker stream component) */}
      <section className="p-6 md:p-8 xl:p-10 max-w-7xl mx-auto w-full relative z-10 border-t border-white/5">
        <h4 className="text-xs font-mono text-cyan-400 uppercase tracking-widest mb-4 flex items-center gap-2">
          <span>📊</span> Live Dual Ingestion Streams v2
        </h4>
        <IngestionTracker 
          activeScenario={activeScenario}
          ingestedCommentary={activeCommentaryList}
          currentOdds={currentOddsConfig}
          previousOdds={prevOddsRef.current}
          isLooping={isPlaying}
          totalCommentsCount={activeCommentaryList.length}
          useAcousticListening={config.useAcousticListening}
        />
      </section>

      {/* Sandbox Creator Slideover/Modal component if open */}
      {isSandboxCreatorOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4">
          <div className="bg-zinc-950 border border-white/15 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl relative">
            <h3 className="text-sm font-bold uppercase tracking-wider text-violet-400 font-mono">
              Configure Live Sandbox Run
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Define match parameter, write simulated physical key events, and observe the AI Spotting module calculate momentum shifts.
            </p>

            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-gray-500 uppercase">Team A (Offensive)</span>
                  <input 
                    type="text" 
                    value={customTeamA} 
                    onChange={e => setCustomTeamA(e.target.value)} 
                    className="w-full bg-black border border-white/10 text-xs px-2.5 py-1.5 rounded-lg text-white"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-gray-500 uppercase">Team B (Defensive)</span>
                  <input 
                    type="text" 
                    value={customTeamB} 
                    onChange={e => setCustomTeamB(e.target.value)} 
                    className="w-full bg-black border border-white/10 text-xs px-2.5 py-1.5 rounded-lg text-white"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] font-mono text-gray-500 uppercase">Commentary Stream (Separate by Line)</span>
                <textarea 
                  rows={4}
                  value={customCommentaryListStr}
                  onChange={e => setCustomCommentaryListStr(e.target.value)}
                  className="w-full bg-black border border-white/10 text-xs p-2.5 rounded-lg font-mono text-gray-300 focus:outline-none focus:ring-1 focus:ring-violet-500"
                  placeholder="e.g. 80' - France scores a goal..."
                />
              </div>
            </div>

            <div className="flex gap-2">
              <button 
                onClick={handleCreateCustomScenario}
                className="flex-1 bg-violet-600 hover:bg-violet-500 text-white font-bold py-2 rounded-xl text-xs uppercase"
              >
                Inject Custom Stream
              </button>
              <button 
                onClick={() => setIsSandboxCreatorOpen(false)}
                className="bg-white/5 border border-white/10 text-slate-300 px-4 rounded-xl text-xs hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer Navigation Bar */}
      <footer className="h-10 bg-black/40 border-t border-white/10 px-6 flex items-center justify-between z-10 text-[9px] uppercase tracking-widest text-slate-500">
        <div className="font-mono">
          Engine: <span className="text-white">Gemini-3.5-Flash (Sports Arbitrage Brain)</span>
        </div>
        
        <div className="flex gap-4 font-mono select-none">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_5px_#10b981]"></div>
            <span>Football Feed Sync</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full shadow-[0_0_5px_#10b981]"></div>
            <span>Poly Link Sync</span>
          </div>
          <button 
            onClick={() => setIsSandboxCreatorOpen(true)}
            className="text-violet-400 hover:text-violet-300 cursor-pointer flex items-center gap-1 uppercase"
          >
            <span>🔧</span> Sandbox Config
          </button>
        </div>
      </footer>

    </div>
  );
}
