"""Provider interfaces — shared types for the seed pipeline.

The same shapes are used for historical pulls (now) and live streams (later),
so the replay engine doesn't care which mode it's reading from.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Any, Iterator, Protocol


@dataclass
class FixtureRef:
    """Identifies a match across providers."""
    home: str
    away: str
    kickoff_utc: datetime
    competition: str = "epl"
    polymarket_event_slug: str | None = None
    sportmonks_fixture_id: int | None = None
    api_football_fixture_id: int | None = None
    espn_game_id: str | None = None

    def short_id(self) -> str:
        return f"{self.away[:3].lower()}-{self.home[:3].lower()}-{self.kickoff_utc.date().isoformat()}"


@dataclass
class CommentaryEntry:
    minute: int
    text: str
    ts_utc: datetime | None = None
    extra_time: int = 0
    raw_event_type: str | None = None
    players: list[str] = field(default_factory=list)
    team: str | None = None
    source: str = "unknown"


@dataclass
class Market:
    market_id: str
    question: str
    outcomes: list[str]
    token_ids: list[str]
    sports_market_type: str
    event_id: str
    final_outcome_prices: list[float] | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class PricePoint:
    ts_utc: datetime
    price: float
    token_id: str


class CommentaryProvider(Protocol):
    def get_historical(self, fixture: FixtureRef) -> list[CommentaryEntry]: ...
    def stream_live(
        self, fixture: FixtureRef, *, poll_interval_seconds: int = 60
    ) -> Iterator[CommentaryEntry]: ...


class MarketProvider(Protocol):
    def list_event_markets(self, fixture: FixtureRef) -> list[Market]: ...
    def get_price_history(
        self,
        token_id: str,
        *,
        start_ts: datetime,
        end_ts: datetime,
        fidelity_minutes: int,
    ) -> list[PricePoint]: ...
    def stream_live_prices(
        self, token_id: str, *, poll_interval_seconds: int = 60
    ) -> Iterator[PricePoint]: ...


def dump(obj: Any) -> Any:
    """JSON encoder for our dataclasses + datetimes."""
    if hasattr(obj, "__dataclass_fields__"):
        return {k: dump(v) for k, v in asdict(obj).items()}
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, list):
        return [dump(x) for x in obj]
    if isinstance(obj, dict):
        return {k: dump(v) for k, v in obj.items()}
    return obj
