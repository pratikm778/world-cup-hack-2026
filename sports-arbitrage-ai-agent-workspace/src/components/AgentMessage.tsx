import React from "react";
import type { CitedMarketRef } from "../../marketRefs";
import { MarketChip } from "./MarketChip";

type AgentMessageProps = {
  text: string;
  citedMarkets?: CitedMarketRef[];
  focusedMarketId?: string | null;
  onMarketSelect: (marketId: string) => void;
  className?: string;
};

export function AgentMessage({
  text,
  citedMarkets = [],
  focusedMarketId,
  onMarketSelect,
  className = "",
}: AgentMessageProps) {
  if (!text && citedMarkets.length === 0) return null;

  const lines = text.split("\n").filter(Boolean);
  const headline = lines[0] || "";
  const body = lines.slice(1).join("\n");

  return (
    <div className={`space-y-3 ${className}`}>
      {headline && (
        <p className="leading-relaxed font-sans text-sm text-slate-100">{headline}</p>
      )}

      {citedMarkets.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {citedMarkets.map((m) => (
            <span key={m.market_id} className="inline-flex">
              <MarketChip
                market={m}
                onSelect={onMarketSelect}
                isFocused={focusedMarketId === m.market_id}
              />
            </span>
          ))}
        </div>
      )}

      {body && (
        <p className="leading-relaxed font-sans text-sm text-slate-300 whitespace-pre-wrap">
          {body}
        </p>
      )}
    </div>
  );
}
