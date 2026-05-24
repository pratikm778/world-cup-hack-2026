import React, { useEffect, useState, useRef } from "react";
import { 
  Sparkles, Play, Pause, RotateCcw, Radio, Settings, 
  Sliders, MessageSquare, Terminal, RefreshCw, 
  Send, Check, AlertTriangle, ArrowUpRight, Volume2, 
  Layers, Search, ChevronDown, ChevronUp, TrendingUp, Clock, Database, Activity
} from "lucide-react";

export default function App() {
  // Tab control: "edgecast" or "signaldesk"
  const [activeTab, setActiveTab] = useState<"edgecast" | "signaldesk">("edgecast");

  // Local Time UTC
  const [currentTimeUTC, setCurrentTimeUTC] = useState<string>("");

  // Sync clock time
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

  // ==========================================
  // EDGECAST (LIVE CO-WATCHER) STATES
  // ==========================================
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentMinute, setCurrentMinute] = useState<number>(0);
  const [matchId, setMatchId] = useState<string>("ars-man-2026-04-19");
  const [teams, setTeams] = useState<{ home: string; away: string }>({ home: "Manchester City", away: "Arsenal" });
  const [commentary, setCommentary] = useState<any[]>([]);
  const [keyEvents, setKeyEvents] = useState<any[]>([]);
  const [prices, setPrices] = useState<Record<string, { price: number; delta5m: number; delta2m: number }>>({});
  const [recentGlows, setRecentGlows] = useState<Record<string, boolean>>({});
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const [chatHistory, setChatHistory] = useState<Array<{ sender: "user" | "gemini"; text: string; time: string; model?: string }>>([]);
  const [isChatBusy, setIsChatBusy] = useState<boolean>(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const commentaryBottomRef = useRef<HTMLDivElement>(null);

  // Poll state API
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    const fetchState = async () => {
      try {
        const res = await fetch("/api/state");
        if (res.ok) {
          const data = await res.json();
          setCurrentMinute(data.minute);
          setMatchId(data.match_id);
          setTeams(data.teams);
          setCommentary(data.commentary || []);
          setKeyEvents(data.last_events || []);
          
          if (data.prices) {
            setPrices((prevPrices: any) => {
              const newGlows: Record<string, boolean> = {};
              Object.keys(data.prices).forEach((mId) => {
                const oldP = prevPrices[mId]?.price;
                const newP = data.prices[mId]?.price;
                if (oldP !== undefined && oldP !== newP) {
                  newGlows[mId] = true;
                }
              });
              
              if (Object.keys(newGlows).length > 0) {
                setRecentGlows((prev) => ({ ...prev, ...newGlows }));
                setTimeout(() => {
                  setRecentGlows((prev) => {
                    const cleared = { ...prev };
                    Object.keys(newGlows).forEach((mId) => {
                      delete cleared[mId];
                    });
                    return cleared;
                  });
                }, 3000);
              }
              
              return data.prices;
            });
          }
        }
      } catch (err) {
        console.error("Failed to fetch state:", err);
      }
    };

    fetchState();
    interval = setInterval(fetchState, 1000);
    return () => {
      if (interval) clearInterval(interval);
    };
  }, []);

  // SSE Stream
  useEffect(() => {
    const sse = new EventSource("/api/events");
    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "broadcast") {
          setBroadcasts((prev) => {
            if (prev.some((b) => b.text === data.text && b.minute === data.minute)) {
              return prev;
            }
            return [...prev, data];
          });
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };
    return () => sse.close();
  }, []);

  // Scroll to bottom helper
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [broadcasts, chatHistory]);

  useEffect(() => {
    commentaryBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [commentary]);

  // Controls
  const handlePlay = async () => {
    setIsPlaying(true);
    try {
      await fetch(`/api/replay/start?from_minute=${currentMinute}`, { method: "POST" });
    } catch (err) {
      console.error(err);
    }
  };

  const handlePause = async () => {
    setIsPlaying(false);
    try {
      await fetch(`/api/replay/seek?minute=${currentMinute}`, { method: "POST" });
    } catch (err) {
      console.error(err);
    }
  };

  const handleReset = async () => {
    setIsPlaying(false);
    setCurrentMinute(0);
    setBroadcasts([]);
    setChatHistory([]);
    try {
      await fetch("/api/replay/seek?minute=0", { method: "POST" });
    } catch (err) {
      console.error(err);
    }
  };

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || isChatBusy) return;

    const userText = chatInput.trim();
    setChatInput("");
    setChatHistory((prev) => [...prev, { sender: "user", text: userText, time: `${Math.round(currentMinute)}'` }]);
    setIsChatBusy(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: userText,
          match_minute: currentMinute,
          prices: prices,
          commentary: commentary.slice(0, 10),
          key_events: keyEvents.slice(0, 5)
        })
      });

      if (response.ok) {
        const data = await response.json();
        setChatHistory((prev) => [...prev, {
          sender: "gemini",
          text: data.answer,
          time: `${Math.round(currentMinute)}'`,
          model: data.modelUsed
        }]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsChatBusy(false);
    }
  };


  // ==========================================
  // SIGNAL DESK (FUTURE) STATES
  // ==========================================
  const [themeInput, setThemeInput] = useState<string>("football soccer today");
  const [isRanking, setIsRanking] = useState<boolean>(false);
  const [rankings, setRankings] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [traceLog, setTraceLog] = useState<any>(null);
  const [expandedRankIndex, setExpandedRankIndex] = useState<number | null>(null);

  const handleRankBets = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRanking) return;

    setIsRanking(true);
    setRankings([]);
    setTraceLog("Fetching live Polymarket active markets, enriching with Exa real-time news evidence, then ranking with Gemini...");

    try {
      const response = await fetch("/api/top-bets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme: themeInput, limit: 10 })
      });

      if (response.ok) {
        const data = await response.json();
        setRankings(data.reasoning?.rankings || []);
        setCandidates(data.candidates || []);
        setTraceLog({
          theme: data.theme,
          latency_seconds: data.latency_seconds,
          reasoning_provider: data.reasoning?.provider,
          model: data.reasoning?.model,
          candidates_loaded: data.candidates?.length || 0,
          timestamp: new Date().toISOString()
        });
      } else {
        setTraceLog("Failed to rank bets from server.");
      }
    } catch (err: any) {
      console.error(err);
      setTraceLog(`Error: ${err.message || "Failed to fetch top bets."}`);
    } finally {
      setIsRanking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050608] text-slate-200 font-sans overflow-x-hidden relative flex flex-col justify-between" id="immersive-hud-root">
      
      {/* Background Neon Atmosphere Lights */}
      <div className="absolute inset-0 opacity-40 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] rounded-full bg-blue-900/10 blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-950/20 blur-[120px]"></div>
        <div className="absolute top-[20%] left-[30%] w-[40%] h-[40%] rounded-full bg-purple-950/10 blur-[100px]"></div>
      </div>

      {/* Header HUD Navigation */}
      <header className="h-16 border-b border-white/10 flex items-center justify-between px-6 bg-black/50 backdrop-blur-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-gradient-to-tr from-cyan-500 via-indigo-500 to-emerald-500 flex items-center justify-center shadow-lg shadow-indigo-950/40">
            <span className="text-[10px] font-black text-black">EC</span>
          </div>
          <div className="flex flex-col">
            <span className="text-xs md:text-sm font-bold tracking-[0.25em] uppercase text-white bg-gradient-to-r from-white via-slate-300 to-slate-500 bg-clip-text text-transparent">
              NeuralStrike // EdgeCast Console
            </span>
            <span className="text-[8px] font-mono text-gray-400 tracking-wider">COGNITIVE MATCH OBSERVER v4.0</span>
          </div>
        </div>

        <div className="flex gap-6 items-center">
          <div className="hidden md:flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            <span className="text-[9px] font-mono uppercase tracking-wider text-emerald-400">SSE Tunnel Active</span>
          </div>
          <div className="hidden md:block h-4 w-[1px] bg-white/10"></div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400">
            Polymarket Ping: <span className="text-cyan-400">14ms</span>
          </div>
        </div>
      </header>

      {/* Tab Selectors */}
      <div className="border-b border-white/5 bg-black/20 z-10 px-6 py-2 flex items-center gap-4">
        <button
          onClick={() => setActiveTab("edgecast")}
          className={`px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 border ${
            activeTab === "edgecast"
              ? "bg-cyan-500/10 border-cyan-500/30 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)]"
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          Live Co-Watcher (EdgeCast)
        </button>

        <button
          onClick={() => setActiveTab("signaldesk")}
          className={`px-4 py-2 rounded-xl text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center gap-2 border ${
            activeTab === "signaldesk"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.15)]"
              : "border-transparent text-slate-400 hover:text-slate-200 hover:bg-white/5"
          }`}
        >
          <Database className="w-3.5 h-3.5" />
          Polymarket Signal Desk (Future)
        </button>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 w-full relative z-10 flex flex-col overflow-hidden">
        
        {/* ==========================================
            TAB 1: EDGECAST LIVE CO-WATCHER (3 PANES)
            ========================================== */}
        {activeTab === "edgecast" && (
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 h-full overflow-hidden max-w-[1600px] mx-auto w-full">
            
            {/* PANE 1: Chat Feed & SSE logs (40% - lg:col-span-5) */}
            <section className="lg:col-span-5 flex flex-col h-[calc(100vh-12rem)] bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="px-5 py-4 border-b border-white/5 bg-black/40 flex items-center justify-between">
                <div className="flex flex-col">
                  <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                    <MessageSquare className="w-4 h-4" />
                    01. Agent Broadcasts & Chat
                  </h3>
                  <span className="text-[9px] text-gray-500 font-mono">Real-time Gemini Stream</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-cyan-500/15 border border-cyan-500/20">
                  <Radio className="w-3 h-3 text-cyan-400 animate-pulse" />
                  <span className="text-[8px] font-mono text-cyan-400 font-bold uppercase tracking-wider">Listening</span>
                </div>
              </div>

              {/* Chat Feed Messages */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar bg-black/10">
                {broadcasts.length === 0 && chatHistory.length === 0 && (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 font-mono italic text-xs">
                    <Terminal className="w-8 h-8 mb-2 opacity-35 text-slate-400" />
                    Awaiting prediction market broadcast signals... <br/>
                    Start the replay clock in the center pane to begin.
                  </div>
                )}

                {/* Combined broadcasts and user questions */}
                {/* Render Broadcast Alerts */}
                {broadcasts.map((b, idx) => (
                  <div 
                    key={`b-${idx}`} 
                    className={`p-3.5 rounded-xl border transition-all duration-300 font-mono text-xs ${
                      b.urgency === "major" 
                        ? "bg-red-500/10 border-red-500/30 text-red-200 shadow-[0_0_15px_rgba(239,68,68,0.15)] animate-pulse"
                        : b.urgency === "movement"
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-200"
                          : "bg-cyan-500/5 border-cyan-500/10 text-cyan-100"
                    }`}
                  >
                    <div className="flex justify-between items-center text-[9px] uppercase tracking-wider mb-1.5 text-slate-400">
                      <span className="font-bold flex items-center gap-1 text-cyan-400">
                        <Sparkles className="w-3 h-3" />
                        EdgeCast Alert
                      </span>
                      <span>{b.minute.toFixed(1)}'</span>
                    </div>
                    <div className="leading-relaxed font-sans">{b.text}</div>
                  </div>
                ))}

                {/* Render User Chat History */}
                {chatHistory.map((ch, idx) => (
                  <div 
                    key={`c-${idx}`} 
                    className={`flex flex-col space-y-1 ${ch.sender === "user" ? "items-end" : "items-start"}`}
                  >
                    <div className="text-[9px] font-mono text-slate-500">
                      {ch.sender === "user" ? `Trader (${ch.time})` : `EdgeCast Brain (${ch.time})`}
                    </div>
                    <div 
                      className={`p-3 rounded-2xl max-w-[85%] text-xs font-sans leading-relaxed ${
                        ch.sender === "user"
                          ? "bg-indigo-600/30 border border-indigo-500/30 text-indigo-100 rounded-tr-none"
                          : "bg-zinc-900 border border-white/5 text-slate-200 rounded-tl-none"
                      }`}
                    >
                      {ch.text}
                      {ch.model && (
                        <span className="block mt-1 text-[8px] font-mono text-slate-500 text-right">
                          model: {ch.model}
                        </span>
                      )}
                    </div>
                  </div>
                ))}

                {isChatBusy && (
                  <div className="flex items-center gap-2 text-xs font-mono text-slate-400 italic">
                    <RefreshCw className="w-3 h-3 animate-spin text-cyan-400" />
                    EdgeCast is analyzing current market spreads...
                  </div>
                )}
                <div ref={chatBottomRef} />
              </div>

              {/* Chat Input */}
              <form onSubmit={handleSendChat} className="p-4 border-t border-white/5 bg-black/60 flex gap-3">
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Ask EdgeCast (e.g. 'Why are corner prices changing?')"
                  disabled={isChatBusy}
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder-slate-500 disabled:opacity-50"
                />
                <button
                  type="submit"
                  disabled={isChatBusy || !chatInput.trim()}
                  className="h-9 w-9 bg-cyan-600 hover:bg-cyan-500 active:bg-cyan-700 text-black font-bold rounded-xl flex items-center justify-center transition-all disabled:opacity-50 disabled:hover:bg-cyan-600 cursor-pointer shrink-0"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </section>

            {/* PANE 2: Clock & Commentary (35% - lg:col-span-4) */}
            <section className="lg:col-span-4 flex flex-col h-[calc(100vh-12rem)] bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="px-5 py-4 border-b border-white/5 bg-black/40 flex items-center justify-between">
                <div className="flex flex-col">
                  <h3 className="text-xs font-bold text-amber-400 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                    <Clock className="w-4 h-4" />
                    02. Playback Clock & commentary
                  </h3>
                  <span className="text-[9px] text-gray-500 font-mono">ESPN Play-By-Play Timeline</span>
                </div>
                <div className="text-[10px] font-mono text-slate-400 bg-zinc-900 border border-white/5 px-2 py-0.5 rounded">
                  Match: <span className="text-amber-400 font-bold">{matchId}</span>
                </div>
              </div>

              {/* Glowing Clock and Controls */}
              <div className="p-6 border-b border-white/5 bg-black/20 flex flex-col items-center gap-4 text-center">
                <div className="text-[9px] font-mono uppercase tracking-[0.2em] text-slate-500">Match Minute</div>
                <div className="relative">
                  <div className="text-5xl font-black font-mono tracking-wider bg-gradient-to-r from-amber-400 via-orange-500 to-pink-500 bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(245,158,11,0.2)]">
                    {currentMinute.toFixed(1)}'
                  </div>
                  {isPlaying && (
                    <div className="absolute top-0 right-[-15px] w-2 h-2 rounded-full bg-emerald-500 animate-ping"></div>
                  )}
                </div>

                <div className="text-xs font-bold text-slate-400 flex items-center gap-2 mb-2">
                  <span className="text-indigo-400">{teams.home}</span>
                  <span className="text-slate-600">vs</span>
                  <span className="text-rose-400">{teams.away}</span>
                </div>

                {/* Clock Controls */}
                <div className="flex items-center gap-3 bg-white/5 p-1.5 rounded-2xl border border-white/5">
                  <button
                    onClick={handleReset}
                    className="p-2 hover:bg-white/5 rounded-xl text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
                    title="Reset Replay"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    onClick={isPlaying ? handlePause : handlePlay}
                    className={`p-3 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                      isPlaying 
                        ? "bg-amber-500 text-black hover:bg-amber-400" 
                        : "bg-cyan-600 text-black hover:bg-cyan-500"
                    }`}
                  >
                    {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-black" />}
                  </button>

                  <div className="px-3 font-mono text-[9px] text-slate-500 uppercase tracking-widest">
                    {isPlaying ? "Simulating" : "Paused"}
                  </div>
                </div>
              </div>

              {/* Scrolling Commentary Scroll */}
              <div className="flex-1 overflow-y-auto p-5 space-y-3 custom-scrollbar bg-black/10">
                {commentary.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-slate-500 font-mono italic text-xs">
                    Timeline empty. Click play to start simulation.
                  </div>
                ) : (
                  commentary.map((c, idx) => (
                    <div 
                      key={`com-${idx}`}
                      className="p-3 bg-white/[0.02] border border-white/5 rounded-xl flex gap-3 items-start transition-all hover:bg-white/[0.04]"
                    >
                      <span className="font-mono text-xs font-bold text-amber-500 bg-amber-500/10 px-1.5 py-0.5 rounded shrink-0">
                        {c.minute}'
                      </span>
                      <div className="flex flex-col gap-1 text-xs">
                        {c.team && (
                          <span className="font-bold text-[9px] uppercase tracking-wider text-slate-400">
                            {c.team}
                          </span>
                        )}
                        <p className="text-slate-300 font-sans leading-relaxed">{c.text}</p>
                      </div>
                    </div>
                  ))
                )}
                <div ref={commentaryBottomRef} />
              </div>
            </section>

            {/* PANE 3: Hot Markets Sidebar (25% - lg:col-span-3) */}
            <section className="lg:col-span-3 flex flex-col h-[calc(100vh-12rem)] bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="px-5 py-4 border-b border-white/5 bg-black/40 flex items-center justify-between">
                <div className="flex flex-col">
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                    <TrendingUp className="w-4 h-4" />
                    03. Hot markets board
                  </h3>
                  <span className="text-[9px] text-gray-500 font-mono">Sorted by Absolute 5m Change</span>
                </div>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[8px] border border-emerald-500/20 font-mono font-bold">
                  37 Active
                </span>
              </div>

              {/* Markets List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-black/10">
                {Object.keys(prices).length === 0 ? (
                  <div className="h-full flex items-center justify-center text-center text-slate-500 font-mono italic text-xs">
                    Loading prediction sheets...
                  </div>
                ) : (
                  (Object.entries(prices) as [string, any][])
                    .map(([mId, pInfo]) => ({
                      market_id: mId,
                      price: pInfo.price,
                      delta5m: pInfo.delta5m,
                      delta2m: pInfo.delta2m,
                      // Quick mock questions to display nicely on sidebar
                      question: mId === "1886051" ? `Winner: ${teams.home}` :
                                mId === "1886054" ? "Match ends in Draw" :
                                mId === "1886056" ? `Winner: ${teams.away}` :
                                mId === "1887253" ? "Totals: Over 2.5 Goals" :
                                mId === "1887262" ? "Both Teams to Score" :
                                mId === "1886868" ? `${teams.away} HT Leader` :
                                mId === "1886866" ? `${teams.home} HT Leader` :
                                mId === "1886869" ? "Exact Score: 1-1" :
                                mId === "1886871" ? "Exact Score: 2-1" :
                                mId === "1886870" ? "Exact Score: 1-0" : `Market #${mId.substring(0,5)}...`
                    }))
                    // Sort by absolute delta5m descending
                    .sort((a, b) => Math.abs(b.delta5m) - Math.abs(a.delta5m))
                    .map((item) => {
                      const isGlowing = recentGlows[item.market_id];
                      return (
                        <div 
                          key={item.market_id}
                          className={`p-3 border rounded-xl flex flex-col gap-2 transition-all duration-500 ${
                            isGlowing 
                              ? "bg-yellow-500/10 border-yellow-500/40 shadow-[0_0_20px_rgba(234,179,8,0.2)] scale-[1.01]" 
                              : "bg-white/[0.02] border-white/5 hover:border-white/10"
                          }`}
                        >
                          <div className="flex justify-between items-start gap-2">
                            <span className="text-[11px] font-sans font-medium text-slate-300 leading-normal line-clamp-2">
                              {item.question}
                            </span>
                            <span className="text-xs font-mono font-bold text-cyan-400 shrink-0">
                              {item.price}c
                            </span>
                          </div>

                          <div className="flex justify-between items-center text-[9px] font-mono">
                            <span className="text-slate-500">ID: {item.market_id}</span>
                            <div className="flex gap-2">
                              <span className={item.delta2m >= 0 ? "text-emerald-400" : "text-rose-400"}>
                                2m: {item.delta2m >= 0 ? "+" : ""}{item.delta2m}c
                              </span>
                              <span className={`font-bold ${item.delta5m >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                5m: {item.delta5m >= 0 ? "+" : ""}{item.delta5m}c
                              </span>
                            </div>
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            </section>

          </div>
        )}

        {/* ==========================================
            TAB 2: POLYMARKET SIGNAL DESK (FUTURE)
            ========================================== */}
        {activeTab === "signaldesk" && (
          <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-6 p-6 h-[calc(100vh-12rem)] overflow-hidden max-w-[1600px] mx-auto w-full">
            
            {/* Main workspace section (lg:col-span-8) */}
            <div className="lg:col-span-8 flex flex-col h-full bg-white/[0.02] border border-white/5 rounded-2xl overflow-hidden backdrop-blur-md">
              <div className="px-5 py-4 border-b border-white/5 bg-black/40 flex items-center justify-between">
                <div className="flex flex-col">
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                    <Sparkles className="w-4 h-4 text-emerald-400" />
                    Polymarket Analyst Desk
                  </h3>
                  <span className="text-[9px] text-gray-500 font-mono">Enriched with Real-Time Exa news and GMI model rankings</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  <span className="text-[8px] font-mono text-emerald-400 font-bold uppercase tracking-wider">Desk Online</span>
                </div>
              </div>

              {/* Live Polymarket search bar */}
              <div className="p-5 border-b border-white/5 bg-black/20">
                <form onSubmit={handleRankBets} className="flex gap-4 items-end">
                  <div className="flex-1 space-y-1.5">
                    <label className="text-[9px] font-mono text-gray-400 block uppercase tracking-widest font-semibold">
                      Live Polymarket Topic Search
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        name="theme"
                        value={themeInput}
                        onChange={(e) => setThemeInput(e.target.value)}
                        placeholder="Search markets (e.g. football soccer today)"
                        className="w-full bg-black border border-white/10 rounded-xl px-10 py-2.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-emerald-500 placeholder-slate-500"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={isRanking}
                    className="h-10 bg-gradient-to-r from-emerald-500 to-emerald-400 text-black hover:scale-[1.01] hover:shadow-[0_0_20px_rgba(52,211,153,0.3)] shadow-md font-bold text-xs uppercase font-mono px-5 rounded-xl flex items-center gap-2 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isRanking ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Ranking...
                      </>
                    ) : (
                      <>
                        <TrendingUp className="w-4 h-4" />
                        Rank active bets
                      </>
                    )}
                  </button>
                </form>
              </div>

              {/* Ranked Bets Body */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar bg-black/10">
                {rankings.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-6 text-slate-500 font-mono italic text-xs">
                    <Database className="w-8 h-8 mb-2 opacity-35 text-slate-400" />
                    {isRanking 
                      ? "Fetching active markets, downloading Exa news context, and generating GMI scores..."
                      : "Search active prediction markets to see ranked betting alpha insights."
                    }
                  </div>
                ) : (
                  <div className="space-y-4">
                    {rankings.map((item, idx) => {
                      const candidate = candidates.find(c => c.question === item.question) || {};
                      const sources = candidate.insight?.sources || [];
                      const isExpanded = expandedRankIndex === idx;
                      const edgeScore = item.score;

                      return (
                        <div 
                          key={`rank-${idx}`}
                          className="bg-white/[0.02] border border-white/5 rounded-xl hover:border-emerald-500/25 transition-all overflow-hidden"
                        >
                          {/* Row Header */}
                          <div 
                            onClick={() => setExpandedRankIndex(isExpanded ? null : idx)}
                            className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/[0.02] gap-4"
                          >
                            <div className="flex items-center gap-4">
                              <span className="text-xl font-bold font-mono text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded">
                                #{item.rank}
                              </span>
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                                  {item.event_title}
                                </span>
                                <h4 className="text-xs font-bold text-slate-200">
                                  {item.question}
                                </h4>
                              </div>
                            </div>

                            <div className="flex items-center gap-4 shrink-0">
                              <div className="flex flex-col items-end gap-1 font-mono">
                                <span className={`px-2 py-0.5 rounded text-[8px] font-bold uppercase ${
                                  item.recommendation.startsWith("buy") 
                                    ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                                    : "bg-slate-800 text-slate-400"
                                }`}>
                                  {item.recommendation.replace("_", " ")} {item.side ? `(${item.side})` : ""}
                                </span>
                                <span className="text-[10px] text-slate-400">
                                  Price: {Math.round((item.price || candidate.yes_price || 0) * 100)}c
                                </span>
                              </div>

                              <div className="flex items-center gap-2">
                                <div className="flex flex-col items-center justify-center w-10 h-10 rounded-full border border-emerald-500/25 bg-emerald-950/15">
                                  <span className="text-[8px] font-mono text-emerald-500 uppercase tracking-wider block leading-none">Score</span>
                                  <span className="text-xs font-mono font-black text-emerald-400 leading-none">{edgeScore}</span>
                                </div>
                                {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                              </div>
                            </div>
                          </div>

                          {/* Expanded Detail Panel */}
                          {isExpanded && (
                            <div className="px-6 py-4 border-t border-white/5 bg-black/20 space-y-4 text-xs">
                              {/* News Insights summary */}
                              {candidate.insight?.summary && (
                                <div className="space-y-1.5">
                                  <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-widest font-semibold block">
                                    Exa Real-time News Evidence
                                  </span>
                                  <p className="text-slate-300 font-sans leading-relaxed p-3 bg-zinc-950/30 rounded border border-white/5">
                                    {candidate.insight.summary}
                                  </p>
                                </div>
                              )}

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {/* Reasoning Bullets */}
                                <div className="space-y-1.5">
                                  <span className="text-[9px] font-mono text-emerald-400 uppercase tracking-widest font-semibold block">
                                    Model Reasoning Bullets
                                  </span>
                                  <ul className="list-disc pl-4 space-y-1 text-slate-300 font-sans">
                                    {item.reason_bullets?.map((bullet: string, bIdx: number) => (
                                      <li key={bIdx}>{bullet}</li>
                                    )) || <li>{item.reason}</li>}
                                  </ul>
                                </div>

                                {/* Risk Bullets */}
                                <div className="space-y-1.5">
                                  <span className="text-[9px] font-mono text-rose-400 uppercase tracking-widest font-semibold block">
                                    Model Risk Bullets
                                  </span>
                                  <ul className="list-disc pl-4 space-y-1 text-slate-300 font-sans">
                                    {item.risk_bullets?.map((bullet: string, rIdx: number) => (
                                      <li key={rIdx}>{bullet}</li>
                                    )) || <li>{item.risk}</li>}
                                  </ul>
                                </div>
                              </div>

                              {/* Source Links */}
                              {sources.length > 0 && (
                                <div className="pt-2 border-t border-white/5 space-y-1.5">
                                  <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest font-semibold block">
                                    Verified News Citations
                                  </span>
                                  <div className="flex flex-wrap gap-2">
                                    {sources.map((src: any, sIdx: number) => (
                                      <a 
                                        key={sIdx}
                                        href={src.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-[10px] font-mono text-cyan-400 bg-cyan-950/20 border border-cyan-800/40 px-2.5 py-1 rounded hover:bg-cyan-950/40 transition-all flex items-center gap-1"
                                      >
                                        {src.title || "News Source"}
                                        <ArrowUpRight className="w-2.5 h-2.5" />
                                      </a>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Sidebar Trace Terminal Panel (lg:col-span-4) */}
            <aside className="lg:col-span-4 flex flex-col h-full bg-[#0a0a0f] border border-cyan-500/20 rounded-2xl overflow-hidden shadow-[0_0_25px_rgba(6,182,212,0.05)]">
              <div className="px-5 py-4 border-b border-cyan-500/10 bg-black/60 flex items-center justify-between">
                <div className="flex items-center gap-2 font-mono">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_#ef4444]"></span>
                    <span className="w-2 h-2 rounded-full bg-amber-500 shadow-[0_0_8px_#f59e0b]"></span>
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]"></span>
                  </div>
                  <span className="text-xs font-bold text-cyan-400 uppercase tracking-widest pl-2">
                    Trace Console
                  </span>
                </div>
                <Terminal className="w-4 h-4 text-cyan-400" />
              </div>

              <div className="flex-grow p-5 bg-black/40 overflow-y-auto font-mono text-[10px] leading-relaxed text-cyan-500 custom-scrollbar">
                {typeof traceLog === "string" ? (
                  <div className="text-slate-400 whitespace-pre-wrap">{traceLog}</div>
                ) : traceLog ? (
                  <pre className="whitespace-pre-wrap">{JSON.stringify(traceLog, null, 2)}</pre>
                ) : (
                  <div className="text-slate-600 italic">Console initialized. Awaiting API telemetry...</div>
                )}
              </div>
            </aside>

          </div>
        )}

      </main>

      {/* Footer bar */}
      <footer className="h-8 border-t border-white/5 flex items-center justify-between px-6 bg-black/30 backdrop-blur-sm z-10 text-[9px] font-mono text-slate-500">
        <div>SYSTEM STATUS: COGNITIVE ANALYSIS OPTIMIZED</div>
        <div>CURRENT TIME: {currentTimeUTC}</div>
      </footer>

    </div>
  );
}
