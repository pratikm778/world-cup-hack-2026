import React from "react";
import { ExternalLink } from "lucide-react";
import type { CitedMarketRef } from "../../marketRefs";

type MarketChipProps = {
  market: CitedMarketRef;
  onSelect: (marketId: string) => void;
  isFocused?: boolean;
};

export function MarketChip({ market, onSelect, isFocused }: MarketChipProps) {
  const priceLabel =
    market.price_c !== undefined ? `${market.price_c}c` : null;

  return (
    <span className="inline-flex items-center gap-0.5 max-w-full">
      <button
        type="button"
        onClick={() => onSelect(market.market_id)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border text-[10px] font-mono transition-all cursor-pointer ${
          market.role === "primary"
            ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/25"
            : "bg-cyan-950/30 border-cyan-700/30 text-cyan-300/90 hover:bg-cyan-500/10"
        } ${isFocused ? "ring-2 ring-white/50 scale-[1.02]" : ""}`}
        title={`Focus ${market.label}${priceLabel ? ` · ${priceLabel}` : ""}`}
      >
        <span className="truncate max-w-[140px]">{market.label}</span>
        {priceLabel && (
          <span className="text-cyan-400/80 shrink-0">· {priceLabel}</span>
        )}
      </button>
      {market.polymarket_url && (
        <a
          href={market.polymarket_url}
          target="_blank"
          rel="noreferrer"
          className="p-0.5 rounded text-slate-500 hover:text-cyan-400 transition-colors"
          title="Open on Polymarket"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </span>
  );
}
