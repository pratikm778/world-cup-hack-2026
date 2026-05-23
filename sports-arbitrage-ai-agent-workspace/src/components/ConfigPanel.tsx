import { Settings, HelpCircle, Phone, Sliders, Volume2, ShieldAlert } from "lucide-react";
import { AgentConfiguration } from "../types";

interface ConfigPanelProps {
  config: AgentConfiguration;
  onChange: (config: AgentConfiguration) => void;
  isCustomScenario: boolean;
  onBaselineOddsChange?: (target: "A" | "B" | "draw" | "over25" | "nextScorerA" | "nextScorerB", val: number) => void;
  currentOdds?: { 
    yesA: number; 
    yesB: number; 
    draw: number;
    over25?: number;
    nextScorerA?: number;
    nextScorerB?: number;
  };
}

export default function ConfigPanel({
  config,
  onChange,
  isCustomScenario,
  onBaselineOddsChange,
  currentOdds
}: ConfigPanelProps) {
  const updateField = (field: keyof AgentConfiguration, value: any) => {
    onChange({
      ...config,
      [field]: value,
    });
  };

  return (
    <div className="bg-gray-950 border border-gray-800 rounded-xl p-5 shadow-lg space-y-5" id="agent-config-panel">
      <div className="flex items-center justify-between pb-3 border-b border-gray-800">
        <div className="flex items-center gap-2 text-white">
          <Settings className="w-4 h-4 text-violet-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wider font-mono">
            Agent Threshold Controls
          </h2>
        </div>
        <span className="text-[10px] font-mono text-gray-500 bg-gray-900 px-2 py-0.5 rounded-md border border-gray-800">
          SECURE LOCALLY
        </span>
      </div>

      <div className="space-y-4">
        {/* Step Ingestion Interval */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
              Stream Ingestion Speed (RocketRide)
            </label>
            <span className="text-xs font-mono text-cyan-400 font-bold bg-cyan-950/40 px-2 py-0.5 rounded">
              {(config.ingestionSpeedMs / 1000).toFixed(1)} Sec
            </span>
          </div>
          <input
            type="range"
            min="2000"
            max="12000"
            step="500"
            value={config.ingestionSpeedMs}
            onChange={(e) => updateField("ingestionSpeedMs", Number(e.target.value))}
            className="w-full accent-violet-600 bg-gray-900 rounded-md h-1.5 cursor-pointer"
          />
          <span className="text-[10px] text-gray-500 block">
            Sets the continuous loop speed for pulling new comments & odds.
          </span>
        </div>

        {/* Alpha Target Discrepancy Threshold */}
        <div className="space-y-1.5 pt-1">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-amber-400" />
              Arbitrage Alpha Alert Threshold
            </label>
            <span className="text-xs font-mono text-amber-400 font-bold bg-amber-950/40 px-2 py-0.5 rounded">
              +{config.alphaThreshold}%
            </span>
          </div>
          <input
            type="range"
            min="2"
            max="25"
            step="1"
            value={config.alphaThreshold}
            onChange={(e) => updateField("alphaThreshold", Number(e.target.value))}
            className="w-full accent-violet-600 bg-gray-900 rounded-md h-1.5 cursor-pointer"
          />
          <span className="text-[10px] text-gray-500 block">
            Minimum percentage discrepancy (True Probability vs. Market Price) needed to fire alert.
          </span>
        </div>

        {/* WhatsApp Mobile Target Routing */}
        <div className="space-y-2 pt-1">
          <label className="text-xs font-medium text-gray-300 flex items-center gap-1.5">
            <Phone className="w-3.5 h-3.5 text-emerald-400" />
            WhatsApp Notification Target (Connected App)
          </label>
          <div className="relative">
            <input
              type="text"
              placeholder="+1 (555) 322-9011"
              value={config.whatsappNumber}
              onChange={(e) => updateField("whatsappNumber", e.target.value)}
              className="w-full bg-gray-950 border border-gray-800 text-xs text-white placeholder-gray-600 rounded-lg px-3 py-2 pl-8 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <span className="absolute left-2.5 top-2.5 text-xs text-emerald-500 font-mono font-bold">📲</span>
          </div>
          <p className="text-[10px] text-gray-500">
            Securely tunnels notifications to this mobile target when discrepancy emerges.
          </p>
        </div>

        {/* Acoustic Announcer Screaming Audio Input */}
        <div className="pt-2 border-t border-gray-900">
          <div className="flex items-start justify-between gap-4 p-3 bg-gray-900/40 rounded-lg border border-gray-800">
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-200 flex items-center gap-1.5">
                <Volume2 className="w-3.5 h-3.5 text-pink-500" strokeWidth={2.5} />
                Interactive Vocal Spike Hearing (Omni)
              </label>
              <p className="text-[10px] text-gray-400 leading-normal">
                Models native raw voice listening. The agent watches for emotional frequency peaks (e.g. broadcasters screaming "MBAPPE BREAKS AWAY!") to shift weights *before* play-by-play text lands.
              </p>
            </div>
            <div className="relative flex items-center pt-1">
              <input
                type="checkbox"
                checked={config.useAcousticListening}
                onChange={(e) => updateField("useAcousticListening", e.target.checked)}
                className="w-4 h-4 text-violet-600 bg-gray-950 border-gray-850 rounded focus:ring-violet-500 focus:ring-offset-gray-900 focus:ring-2"
              />
            </div>
          </div>
        </div>

        {/* Custom Odds Adjuster (Sandbox-Only) */}
        {isCustomScenario && currentOdds && onBaselineOddsChange && (
          <div className="pt-3 border-t border-gray-900 space-y-3">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-xs uppercase font-mono text-violet-400 font-semibold flex items-center gap-1.5">
                <span>🔧</span> Sandbox Odds Controller
              </h3>
            </div>
            <p className="text-[10px] text-gray-400">
              Shift Polymarket prices manually in real-time to witness the agent reactively spot or discard trading alpha.
            </p>
            
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-gray-500 uppercase block">Yes Team A</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={currentOdds.yesA}
                  onChange={(e) => onBaselineOddsChange("A", Number(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-850 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-gray-500 uppercase block">Yes Team B</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={currentOdds.yesB}
                  onChange={(e) => onBaselineOddsChange("B", Number(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-850 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-violet-500"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-gray-500 uppercase block">Draw Price</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={currentOdds.draw}
                  onChange={(e) => onBaselineOddsChange("draw", Number(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-850 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-violet-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-gray-900/60">
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-cyan-400 uppercase block">Over 2.5 Goals</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={currentOdds.over25 || 0.40}
                  onChange={(e) => onBaselineOddsChange("over25", Number(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-850 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-cyan-400 uppercase block">Next Goal A</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={currentOdds.nextScorerA || 0.35}
                  onChange={(e) => onBaselineOddsChange("nextScorerA", Number(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-850 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div className="space-y-1">
                <span className="text-[9px] font-mono text-cyan-400 uppercase block">Next Goal B</span>
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={currentOdds.nextScorerB || 0.45}
                  onChange={(e) => onBaselineOddsChange("nextScorerB", Number(e.target.value))}
                  className="w-full bg-gray-950 border border-gray-850 rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
