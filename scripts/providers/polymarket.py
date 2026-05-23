"""Polymarket provider — Gamma (market discovery) + CLOB (price history).

Both APIs are public; no auth required for the read paths we use.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

import requests

from .base import FixtureRef, Market, PricePoint

GAMMA_BASE = "https://gamma-api.polymarket.com"
CLOB_BASE = "https://clob.polymarket.com"
TIMEOUT = 20

# Polymarket structures each EPL game as a constellation of sibling events
# sharing a base slug. Empirically these are the only suffixes used; other
# candidates (-total-cards, -total-goals, -anytime-scorer, -first-scorer,
# -btts, -double-chance) all 404 for EPL regular-season games.
EPL_EVENT_SUFFIXES = (
    "",                     # 3-way moneyline
    "-more-markets",        # spreads + totals + BTTS
    "-halftime-result",     # halftime moneyline
    "-exact-score",         # exact score grid (~24 cells)
    "-total-corners",       # corners O/U at multiple thresholds
)


class PolymarketProvider:
    def __init__(self, session: requests.Session | None = None) -> None:
        self.s = session or requests.Session()

    def get_event(self, slug: str) -> dict[str, Any] | None:
        """Return the event dict for `slug`, or None if no such event exists."""
        r = self.s.get(f"{GAMMA_BASE}/events", params={"slug": slug}, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        return data[0] if data else None

    def _markets_from_event(self, event: dict[str, Any], event_group: str) -> list[Market]:
        """Convert one event's raw markets array into normalized Market objects.

        Markets without `clobTokenIds` are silently dropped — those are
        unfunded shell entries (e.g., exact-score cells like 5-0 that nobody
        traded). They have no orderbook to query, so they're not useful for
        the replay engine.
        """
        markets: list[Market] = []
        skipped_unfunded = 0
        for raw in event.get("markets", []):
            if not raw.get("clobTokenIds"):
                skipped_unfunded += 1
                continue
            try:
                outcomes = json.loads(raw["outcomes"])
                token_ids = json.loads(raw["clobTokenIds"])
                final = json.loads(raw.get("outcomePrices", "[]")) or None
                final_f = [float(x) for x in final] if final else None
            except (KeyError, json.JSONDecodeError) as e:
                print(f"  ! skipping malformed market {raw.get('id')}: {e}")
                continue
            markets.append(
                Market(
                    market_id=str(raw["id"]),
                    question=raw["question"],
                    outcomes=outcomes,
                    token_ids=token_ids,
                    sports_market_type=raw.get("sportsMarketType", "unknown"),
                    event_id=str(event["id"]),
                    final_outcome_prices=final_f,
                    metadata={
                        "slug": raw.get("slug"),
                        "group_item_title": raw.get("groupItemTitle"),
                        "volume": raw.get("volumeNum"),
                        "closed": raw.get("closed"),
                        "closed_time": raw.get("closedTime"),
                        "start_date": raw.get("startDate"),
                        "end_date": raw.get("endDate"),
                        "game_start_time": raw.get("gameStartTime"),
                        "event_group": event_group,
                        "event_slug": event.get("slug"),
                    },
                )
            )
        if skipped_unfunded:
            print(f"  ({event_group}: skipped {skipped_unfunded} unfunded shell markets)")
        return markets

    def list_event_markets(self, fixture: FixtureRef) -> tuple[dict[str, Any], list[Market]]:
        """Single-event lookup (backwards-compat). Returns the moneyline event."""
        if not fixture.polymarket_event_slug:
            raise ValueError("fixture.polymarket_event_slug is required")
        event = self.get_event(fixture.polymarket_event_slug)
        if event is None:
            raise LookupError(f"No Polymarket event with slug {fixture.polymarket_event_slug!r}")
        return event, self._markets_from_event(event, event_group="moneyline")

    def list_all_event_markets(
        self,
        fixture: FixtureRef,
        suffixes: tuple[str, ...] = EPL_EVENT_SUFFIXES,
    ) -> tuple[list[dict[str, Any]], list[Market]]:
        """Probe all known sibling-event slugs and return merged markets.

        Returns (list_of_event_dicts, merged_markets). Silently skips suffixes
        that 404 — Polymarket isn't consistent about which markets exist for
        which games (e.g., halftime/corners can be missing for less-traded ties).
        """
        if not fixture.polymarket_event_slug:
            raise ValueError("fixture.polymarket_event_slug is required")
        base = fixture.polymarket_event_slug
        events: list[dict[str, Any]] = []
        markets: list[Market] = []
        for suf in suffixes:
            slug = base + suf
            event = self.get_event(slug)
            if event is None:
                continue
            group = suf.lstrip("-") or "moneyline"
            events.append(event)
            markets.extend(self._markets_from_event(event, event_group=group))
        if not events:
            raise LookupError(f"No Polymarket events found for base slug {base!r}")
        return events, markets

    def get_price_history(
        self,
        token_id: str,
        *,
        start_ts: datetime,
        end_ts: datetime,
        fidelity_minutes: int,
    ) -> list[PricePoint]:
        # Polymarket's `fidelity` is in MINUTES (1=densest, 60=hourly buckets).
        # The endpoint also caps responses around ~250-330 points, so for very
        # long windows you trade granularity for coverage.
        params = {
            "market": token_id,
            "startTs": int(start_ts.timestamp()),
            "endTs": int(end_ts.timestamp()),
            "fidelity": fidelity_minutes,
        }
        r = self.s.get(f"{CLOB_BASE}/prices-history", params=params, timeout=TIMEOUT)
        r.raise_for_status()
        payload = r.json()
        history = payload.get("history", [])
        return [
            PricePoint(
                ts_utc=datetime.fromtimestamp(p["t"], tz=timezone.utc),
                price=float(p["p"]),
                token_id=token_id,
            )
            for p in history
        ]
