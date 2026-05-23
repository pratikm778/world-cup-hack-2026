"""ESPN provider — public soccer summary endpoint.

No auth, no signup. Returns rich commentary: narrative text + structured event
type + wallclock timestamps. Same endpoint serves live in-progress games
(commentary array fills in as the match runs), so this works for both the
historical seed pull *and* the future live-mode story.

The price is league/match coverage limited to whatever ESPN tracks, which for
top-5 European leagues is comprehensive.

Empirical cadence on this match: median 51s between entries during active
play, p95 ~5min. 60s polling catches events with ~30s average lag (half the
poll interval) and is gentle on ESPN — most events land in their own poll
cycle, bursts get batched.
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Iterator

import requests

from .base import CommentaryEntry, FixtureRef

DEFAULT_POLL_INTERVAL_S = 60

SUMMARY_URL = "https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/summary"
LEAGUE_CODES = {"epl": "eng.1", "laliga": "esp.1", "seriea": "ita.1", "bundesliga": "ger.1"}
TIMEOUT = 20

# ESPN time.displayValue is "<minute>'" or "<minute>'+<extra>'", e.g. "45'", "45'+3'", "90'+6'".
_MINUTE_RE = re.compile(r"^(\d+)'(?:\+(\d+)')?$")


def _parse_minute(display_value: str) -> tuple[int, int]:
    if not display_value:
        return 0, 0
    m = _MINUTE_RE.match(display_value.strip())
    if not m:
        return 0, 0
    return int(m.group(1)), int(m.group(2) or 0)


class EspnProvider:
    def __init__(self, session: requests.Session | None = None) -> None:
        self.s = session or requests.Session()

    def get_summary(self, fixture: FixtureRef) -> dict[str, Any]:
        if not fixture.espn_game_id:
            raise ValueError("fixture.espn_game_id is required")
        league = LEAGUE_CODES.get(fixture.competition, fixture.competition)
        r = self.s.get(
            SUMMARY_URL.format(league=league),
            params={"event": fixture.espn_game_id},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        return r.json()

    def _summary_to_entries(self, summary: dict[str, Any]) -> list[tuple[int, CommentaryEntry]]:
        """Convert raw summary commentary into (sequence, CommentaryEntry) pairs."""
        out: list[tuple[int, CommentaryEntry]] = []
        for raw in summary.get("commentary", []):
            display = raw.get("time", {}).get("displayValue", "")
            minute, extra = _parse_minute(display)
            play = raw.get("play") or {}
            wallclock = play.get("wallclock")
            ts_utc = (
                datetime.fromisoformat(wallclock.replace("Z", "+00:00"))
                if wallclock
                else None
            )
            event_type = (play.get("type") or {}).get("type")
            athletes = play.get("athletesInvolved") or []
            players = [a.get("displayName") for a in athletes if a.get("displayName")]
            team = (play.get("team") or {}).get("displayName")
            sequence = int(raw.get("sequence", 0))

            out.append((
                sequence,
                CommentaryEntry(
                    minute=minute,
                    extra_time=extra,
                    text=raw.get("text", ""),
                    ts_utc=ts_utc,
                    raw_event_type=event_type,
                    players=players,
                    team=team,
                    source="espn",
                ),
            ))
        return out

    def get_historical(self, fixture: FixtureRef) -> tuple[list[CommentaryEntry], list[dict[str, Any]]]:
        """Return (full play-by-play commentary, curated keyEvents).

        keyEvents is ESPN's editorial highlight reel — goals, cards, subs only.
        Useful for the event classifier as a ground-truth label set.
        """
        summary = self.get_summary(fixture)
        commentary = [entry for _seq, entry in self._summary_to_entries(summary)]
        return commentary, summary.get("keyEvents", [])

    def _is_match_complete(self, summary: dict[str, Any]) -> bool:
        # header.competitions[0].status.type.completed is the canonical flag.
        header = summary.get("header") or {}
        comps = header.get("competitions") or []
        if not comps:
            return False
        status = (comps[0].get("status") or {}).get("type") or {}
        return bool(status.get("completed"))

    def stream_live(
        self,
        fixture: FixtureRef,
        *,
        poll_interval_seconds: int = DEFAULT_POLL_INTERVAL_S,
    ) -> Iterator[CommentaryEntry]:
        """Poll the summary endpoint every `poll_interval_seconds` and yield
        new commentary entries as they appear.

        Dedupes on ESPN's monotonically-increasing `sequence` field. Stops once
        the match status flips to completed *and* one final poll surfaces no
        new entries (covers the edge case where the final whistle entry lands
        in the same poll cycle as the status flip).
        """
        last_seen_sequence = -1
        saw_completed_flag = False

        while True:
            summary = self.get_summary(fixture)
            new_entries = [
                (seq, entry)
                for seq, entry in self._summary_to_entries(summary)
                if seq > last_seen_sequence
            ]
            for seq, entry in sorted(new_entries, key=lambda x: x[0]):
                yield entry
                last_seen_sequence = max(last_seen_sequence, seq)

            completed = self._is_match_complete(summary)
            if completed and saw_completed_flag and not new_entries:
                return
            saw_completed_flag = completed

            time.sleep(poll_interval_seconds)
