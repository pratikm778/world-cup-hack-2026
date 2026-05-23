import { useEffect, useState } from "react";
import { Play, Pause, RotateCcw, AlertCircle, Sparkles, Radio } from "lucide-react";
import { MatchScenario } from "../types";

interface AgentHeaderProps {
  isPlaying: boolean;
  onPlayToggle: () => void;
  onReset: () => void;
  activeScenario: MatchScenario;
  onScenarioChange: (id: string) => void;
  scenarios: MatchScenario[];
  isGeminiConfigured: boolean;
  isCustomScenario: boolean;
  onCreateCustomScenario: () => void;
  agentStatus: "idle" | "ingesting" | "thinking" | "spotting" | "notifying" | "paused";
}

export default function AgentHeader({
  isPlaying,
  onPlayToggle,
  onReset,
  activeScenario,
  onScenarioChange,
  scenarios,
  isGeminiConfigured,
  isCustomScenario,
  onCreateCustomScenario,
  agentStatus
}: AgentHeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>("");

  useEffect(() => {
    // Keep a dynamic clock synchronized in UTC
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(now.getUTCFullYear() + "-" + 
        String(now.getUTCMonth() + 1).padStart(2, "0") + "-" +
        String(now.getUTCDate()).padStart(2, "0") + " " +
        String(now.getUTCHours()).padStart(2, "0") + ":" +
        String(now.getUTCMinutes()).padStart(2, "0") + ":" +
        String(now.getUTCSeconds()).padStart(2, "0") + " UTC");
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const getStatusBadge = () => {
    switch (agentStatus) {
      case "idle":
        return <span className="inline-flex items-center gap-1 text-xs text-gray-400 bg-gray-800 px-2.5 py-1 rounded-full"><span className="w-1.5 h-1.5 rounded-full bg-gray-500 animate-pulse"></span>STANDBY</span>;
      case "ingesting":
        return <span className="inline-flex items-center gap-1 text-xs text-cyan-400 bg-cyan-950/40 px-2.5 py-1 rounded-full border border-cyan-800/50"><span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping"></span>INGESTING STREAM</span>;
      case "thinking":
        return <span className="inline-flex items-center gap-1 text-xs text-violet-400 bg-violet-950/40 px-2.5 py-1 rounded-full border border-violet-800/50"><span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse"></span>GEMINI AI BRAIN</span>;
      case "spotting":
        return <span className="inline-flex items-center gap-1 text-xs text-amber-400 bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-800/50"><span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-bounce"></span>SPOTTING ALPHA</span>;
      case "notifying":
        return <span className="inline-flex items-center gap-1 text-xs text-emerald-400 bg-emerald-950/40 px-2.5 py-1 rounded-full border border-emerald-800/50"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>SENDING ALERT</span>;
      case "paused":
        return <span className="inline-flex items-center gap-1 text-xs text-rose-400 bg-rose-950/40 px-2.5 py-1 rounded-full border border-rose-800/50"><span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>PAUSED</span>;
    }
  };

  return (
    <header className="border-b border-gray-800 bg-gray-950 p-6" id="agent-workspace-hdr">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
        {/* Title and Badge Info */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-3">
            <span className="p-2 bg-gradient-to-tr from-violet-600 to-indigo-600 rounded-lg text-white font-bold tracking-wider text-sm shadow-md animate-pulse">ALPHA</span>
            <h1 className="text-xl md:text-2xl font-semibold tracking-tight text-white font-sans">
              Arbitrage Agent Workspace
            </h1>
            <div className="hidden sm:block">{getStatusBadge()}</div>
          </div>
          <p className="text-gray-400 text-xs sm:text-sm font-light max-w-xl">
            Continuous dual-data processing loop. Mining live match momentum with sports commentary and cross-checking Polymarket betting odds.
          </p>
        </div>

        {/* Dynamic UTC & API Key Status */}
        <div className="flex items-center flex-wrap gap-4 text-xs">
          <div className="col-span-1 border border-gray-800 bg-gray-900 px-3 py-2 rounded-lg">
            <div className="text-gray-500 font-mono text-[10px] uppercase">Telemetry Timestamp</div>
            <div className="text-gray-300 font-mono font-medium">{currentTime}</div>
          </div>

          <div className={`flex items-center gap-2 border px-3 py-1.5 rounded-lg ${
            isGeminiConfigured 
              ? "border-emerald-800/40 bg-emerald-950/10 text-emerald-400" 
              : "border-amber-800/40 bg-amber-950/10 text-amber-400"
          }`}>
            <Sparkles className="w-3.5 h-3.5" />
            <div className="flex flex-col">
              <span className="font-medium text-[10px] uppercase tracking-wider">Gemini 3.5 API status</span>
              <span className="text-[11px] font-mono">
                {isGeminiConfigured ? "ACTIVE KEY INITIALIZED" : "DEMO ENGINE (MOCK FALLBACK)"}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Control Strip & Scenario Selector */}
      <div className="mt-6 flex flex-col md:flex-row md:items-center justify-between gap-4 p-3 bg-gray-900/60 rounded-xl border border-gray-800/50">
        <div className="flex items-center flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-mono text-gray-500 uppercase tracking-wider">Scenario:</label>
            <select
              value={activeScenario.id}
              onChange={(e) => onScenarioChange(e.target.value)}
              className="bg-gray-950 text-white border border-gray-800 text-xs uppercase rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-violet-500"
            >
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.sport}: {s.teamA} vs {s.teamB}
                </option>
              ))}
              {isCustomScenario && <option value="custom">Sandbox: Custom Match Setup</option>}
            </select>
          </div>

          <button
            onClick={onCreateCustomScenario}
            className={`text-xs px-3 py-1.5 rounded-lg font-mono border transition ${
              isCustomScenario 
                ? "bg-violet-950/40 border-violet-800 text-violet-300 hover:bg-violet-950/60" 
                : "border-gray-800 text-gray-400 hover:bg-gray-800/60"
            }`}
          >
            + Sandbox Mode
          </button>
        </div>

        {/* Engine Playback Speed Controls */}
        <div className="flex items-center gap-3">
          <button
            onClick={onPlayToggle}
            className={`flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold select-none cursor-pointer transition ${
              isPlaying 
                ? "bg-amber-600 hover:bg-amber-500 text-gray-950" 
                : "bg-indigo-600 hover:bg-indigo-500 text-white"
            }`}
          >
            {isPlaying ? (
              <>
                <Pause className="w-3.5 h-3.5" />
                Pause Automation
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5" />
                Run Loop
              </>
            )}
          </button>

          <button
            onClick={onReset}
            className="flex items-center gap-1 text-xs text-gray-400 border border-gray-800 px-3 py-1.5 rounded-lg hover:bg-gray-800 select-none transition"
            title="Reset active scenario data progress"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </button>
        </div>
      </div>
    </header>
  );
}
