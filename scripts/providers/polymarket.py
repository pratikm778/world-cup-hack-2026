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


class PolymarketProvider:
    def __init__(self, session: requests.Session | None = None) -> None:
        self.s = session or requests.Session()

    def get_event(self, slug: str) -> dict[str, Any]:
        r = self.s.get(f"{GAMMA_BASE}/events", params={"slug": slug}, timeout=TIMEOUT)
        r.raise_for_status()
        data = r.json()
        if not data:
            raise LookupError(f"No Polymarket event with slug {slug!r}")
        return data[0]

    def list_event_markets(self, fixture: FixtureRef) -> tuple[dict[str, Any], list[Market]]:
        if not fixture.polymarket_event_slug:
            raise ValueError("fixture.polymarket_event_slug is required")
        event = self.get_event(fixture.polymarket_event_slug)
        markets: list[Market] = []
        for raw in event.get("markets", []):
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
                    },
                )
            )
        return event, markets

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
