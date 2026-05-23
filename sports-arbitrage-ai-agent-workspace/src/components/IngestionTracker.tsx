import { ArrowUp, ArrowDown, Radio, Activity, Terminal, Sparkles, Volume2 } from "lucide-react";
import { CommentaryLine, MatchScenario } from "../types";

interface IngestionTrackerProps {
  activeScenario: MatchScenario;
  ingestedCommentary: CommentaryLine[];
  currentOdds: { yesA: number; yesB: number; draw: number };
  previousOdds?: { yesA: number; yesB: number; draw: number };
  isLooping: boolean;
  totalCommentsCount: number;
  useAcousticListening: boolean;
}

export default function IngestionTracker({
  activeScenario,
  ingestedCommentary,
  currentOdds,
  previousOdds,
  isLooping,
  totalCommentsCount,
  useAcousticListening
}: IngestionTrackerProps) {
  
  const getIntensityBadge = (intensity: "neutral" | "high" | "critical") => {
    switch (intensity) {
      case "neutral":
        return <span className="text-[10px] font-mono text-gray-500 bg-gray-900 px-1.5 py-0.5 rounded border border-gray-800">NORMAL</span>;
      case "high":
        return <span className="text-[10px] font-mono text-amber-400 bg-amber-950/20 px-1.5 py-0.5 rounded border border-amber-950/50">DANGER ZONE</span>;
      case "critical":
        return <span className="text-[10px] font-mono text-rose-400 bg-rose-950/30 px-1.5 py-0.5 rounded border border-rose-900/50 animate-pulse">CRITICAL TRANSITION</span>;
    }
  };

  const getOddsTrend = (curr: number, prev?: number) => {
    if (!prev || curr === prev) return null;
    return curr > prev ? (
      <span className="flex items-center text-xs text-emerald-400 font-bold bg-emerald-950/30 px-1 rounded">
        <ArrowUp className="w-3 h-3 text-emerald-400 mr-0.5" />
        +${(curr - prev).toFixed(2)}
      </span>
    ) : (
      <span className="flex items-center text-xs text-rose-400 font-bold bg-rose-950/30 px-1 rounded">
        <ArrowDown className="w-3 h-3 text-rose-400 mr-0.5" />
        -${(prev - curr).toFixed(2)}
      </span>
    );
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5" id="agent-ingestion-tracker">
      {/* Stream A: RocketRide Ingestion Feed */}
      <div className="bg-gray-950 border border-gray-800 rounded-xl p-5 flex flex-col h-[380px] shadow-md relative overflow-hidden">
        
        {/* Stream Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-cyan-400 animate-pulse" />
            <h3 className="text-xs uppercase font-mono tracking-wider font-semibold text-white">
              Ingestion Stream I: Match Commentary (RocketRide)
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded">
              PULLING LIVE FEED
            </span>
          </div>
        </div>

        {/* Streaming Data Feed Area */}
        <div className="flex-1 overflow-y-auto mt-4 space-y-3.5 pr-2 custom-scrollbar">
          {ingestedCommentary.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center space-y-2 py-10">
              <Terminal className="w-8 h-8 text-gray-700 font-light" />
              <p className="text-xs text-gray-400">
                {isLooping ? "Establishing Socket Bridge connection to RocketRide..." : "Simulation paused. Run Loop to trigger database ingest."}
              </p>
              <span className="text-[10px] text-gray-600 font-mono text-center">
                API-Football WebSocket Tunneling: SECURE
              </span>
            </div>
          ) : (
            [...ingestedCommentary].reverse().map((comment, idx) => (
              <div 
                key={idx} 
                className={`p-3 rounded-lg border text-xs space-y-2 transition-all duration-300 transform translate-y-0 ${
                  idx === 0 
                    ? "bg-slate-900/60 border-cyan-800/40 shadow-sm shadow-cyan-950/40 scale-[1.01]" 
                    : "bg-gray-900/40 border-gray-850 opacity-70"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-mono text-gray-400">
                    <span className="bg-cyan-950 text-cyan-400 px-1.5 py-0.5 rounded text-[10px] font-bold">
                      {comment.timeOffset}
                    </span>
                    <span className="text-[10px] text-gray-500">
                      Ingest @ {((totalCommentsCount - idx) * 10).toFixed(0)}s delta
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {comment.teamFocus && comment.teamFocus !== "neutral" && (
                      <span className="text-[9px] font-mono bg-gray-800 text-gray-300 px-1.5 py-0.5 rounded">
                        Focus: {comment.teamFocus === "A" ? activeScenario.teamA : activeScenario.teamB}
                      </span>
                    )}
                    {getIntensityBadge(comment.intensity)}
                  </div>
                </div>

                <p className="text-gray-200 leading-relaxed font-sans">{comment.text}</p>

                {/* Simulated Acoustic Audio waveform layer if Omni Listening is activated */}
                {useAcousticListening && comment.audioTranscription && (
                  <div className="flex items-center gap-2 mt-2 p-2 bg-pink-950/10 border border-pink-950/30 rounded text-pink-400 text-[11px] font-mono">
                    <Volume2 className="w-3.5 h-3.5 shrink-0 animated-beat animate-pulse" />
                    <div className="flex-1 truncate">
                      <span className="text-[9px] text-pink-500 uppercase block font-bold">Acoustic Audio Transcribe</span>
                      "{comment.audioTranscription}"
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Ambient bottom visual cue */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-gray-950 to-transparent pointer-events-none"></div>
      </div>

      {/* Stream B: Polymarket Live Odds Matrix */}
      <div className="bg-gray-950 border border-gray-800 rounded-xl p-5 flex flex-col h-[380px] shadow-md relative overflow-hidden">
        
        {/* Stream Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-500 animate-pulse" />
            <h3 className="text-xs uppercase font-mono tracking-wider font-semibold text-white">
              Ingestion Stream II: Polymarket Contract Odds
            </h3>
          </div>
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-900/30">
            POLY-WS CHANNEL LIVE
          </span>
        </div>

        {/* Live Odds Grid Cards */}
        <div className="flex-1 flex flex-col justify-between mt-4 space-y-3">
          
          {/* Team A Contract */}
          <div className="bg-gray-900/50 border border-gray-850 rounded-lg p-3.5 flex items-center justify-between hover:bg-gray-900 transition">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{activeScenario.teamAImage}</span>
              <div>
                <span className="text-xs font-semibold text-slate-200 block">{activeScenario.teamA} Win</span>
                <span className="text-[9px] uppercase font-mono text-gray-500">Contract Code: {activeScenario.id.substring(0, 5).toUpperCase()}-YES-A</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-right">
              {getOddsTrend(currentOdds.yesA, previousOdds?.yesA)}
              <div className="bg-gray-950 px-3.5 py-1.5 rounded-lg border border-gray-800">
                <span className="text-gray-400 text-[10px] font-mono uppercase block">Buy YES Choice</span>
                <span className="text-base text-white font-bold font-mono">${currentOdds.yesA.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Team B Contract */}
          <div className="bg-gray-900/50 border border-gray-850 rounded-lg p-3.5 flex items-center justify-between hover:bg-gray-900 transition">
            <div className="flex items-center gap-3">
              <span className="text-2xl">{activeScenario.teamBImage}</span>
              <div>
                <span className="text-xs font-semibold text-slate-200 block">{activeScenario.teamB} Win</span>
                <span className="text-[9px] uppercase font-mono text-gray-500">Contract Code: {activeScenario.id.substring(0, 5).toUpperCase()}-YES-B</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-right">
              {getOddsTrend(currentOdds.yesB, previousOdds?.yesB)}
              <div className="bg-gray-950 px-3.5 py-1.5 rounded-lg border border-gray-800">
                <span className="text-gray-400 text-[10px] font-mono uppercase block">Buy YES Choice</span>
                <span className="text-base text-white font-bold font-mono">${currentOdds.yesB.toFixed(2)}</span>
              </div>
            </div>
          </div>

          {/* Draw Contract (only for Sports where matches can tie/draw) */}
          <div className="bg-gray-900/50 border border-gray-850 rounded-lg p-3.5 flex items-center justify-between hover:bg-gray-900 transition">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🤝</span>
              <div>
                <span className="text-xs font-semibold text-slate-200 block">Match Draw</span>
                <span className="text-[9px] uppercase font-mono text-gray-500">Contract Code: {activeScenario.id.substring(0, 5).toUpperCase()}-DRAW</span>
              </div>
            </div>
            <div className="flex items-center gap-3 text-right">
              {getOddsTrend(currentOdds.draw, previousOdds?.draw)}
              <div className="bg-gray-950 px-3.5 py-1.5 rounded-lg border border-gray-800">
                <span className="text-gray-400 text-[10px] font-mono uppercase block">Buy YES Choice</span>
                <span className="text-base text-white font-bold font-mono">
                  {currentOdds.draw > 0 ? `$${currentOdds.draw.toFixed(2)}` : "NA"}
                </span>
              </div>
            </div>
          </div>

          {/* Mini Ingest Footer ticker */}
          <div className="bg-gray-900 p-2.5 rounded border border-gray-800 flex items-center justify-between text-[11px] font-mono text-gray-500">
            <div className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
              <span>Arbitrage Delta Trackers: ACTIVE</span>
            </div>
            <span>Polymarket Restful Latency: 22ms</span>
          </div>

        </div>

      </div>
    </div>
  );
}
