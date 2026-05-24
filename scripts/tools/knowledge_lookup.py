"""knowledge_lookup — demo-scale historical KB from chunked .txt files.

Loads plain-text chunks with optional `# key: value` headers from
`data/knowledge/` and `data/matches/<match_id>/knowledge/`. Retrieval is
simple keyword overlap (no vectors) — enough for hackathon demos.
"""
from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from .match_helpers import DATA_DIR, load_meta

ChunkType = Literal["player", "team", "matchup", "commentary"]

KNOWLEDGE_DIR = DATA_DIR.parent / "knowledge"
HEADER_RE = re.compile(r"^#\s*(\w+)\s*:\s*(.+)$")
TOKEN_RE = re.compile(r"[a-z0-9]+")


def _knowledge_roots(match_id: str | None) -> list[Path]:
    roots = [KNOWLEDGE_DIR]
    if match_id:
        match_kb = DATA_DIR / match_id / "knowledge"
        if match_kb.is_dir():
            roots.append(match_kb)
    return roots


def _parse_chunk(path: Path, text: str) -> dict[str, Any]:
    meta: dict[str, str] = {}
    body_lines: list[str] = []
    for line in text.splitlines():
        m = HEADER_RE.match(line.strip())
        if m and not body_lines:
            meta[m.group(1).lower()] = m.group(2).strip()
            continue
        body_lines.append(line)
    body = "\n".join(body_lines).strip()
    tags_raw = meta.get("tags", "")
    tags = [t.strip() for t in tags_raw.split(",") if t.strip()]
    chunk_id = meta.get("id") or path.stem
    try:
        source_file = str(path.relative_to(DATA_DIR.parent.parent))
    except ValueError:
        source_file = str(path)
    return {
        "id": chunk_id,
        "type": meta.get("type", "commentary"),
        "entity": meta.get("entity", ""),
        "match_id": meta.get("match_id", ""),
        "tags": tags,
        "source_file": source_file,
        "text": body,
    }


@lru_cache(maxsize=1)
def _load_all_chunks() -> tuple[dict[str, Any], ...]:
    """Load every .txt chunk under data/knowledge/ (global corpus)."""
    chunks: list[dict[str, Any]] = []
    if not KNOWLEDGE_DIR.is_dir():
        return tuple(chunks)
    for path in sorted(KNOWLEDGE_DIR.rglob("*.txt")):
        try:
            chunks.append(_parse_chunk(path, path.read_text(encoding="utf-8")))
        except OSError:
            continue
    return tuple(chunks)


def _load_match_chunks(match_id: str) -> tuple[dict[str, Any], ...]:
    match_kb = DATA_DIR / match_id / "knowledge"
    if not match_kb.is_dir():
        return ()
    chunks: list[dict[str, Any]] = []
    for path in sorted(match_kb.rglob("*.txt")):
        try:
            chunks.append(_parse_chunk(path, path.read_text(encoding="utf-8")))
        except OSError:
            continue
    return tuple(chunks)


def _tokenize(text: str) -> set[str]:
    return set(TOKEN_RE.findall(text.lower()))


def _score_chunk(chunk: dict[str, Any], terms: set[str]) -> int:
    if not terms:
        return 0
    entity = chunk.get("entity", "").lower()
    text = chunk.get("text", "").lower()
    tags = " ".join(chunk.get("tags") or []).lower()
    score = 0
    for t in terms:
        if t in entity:
            score += 4
        if t in chunk.get("id", "").lower():
            score += 3
        if t in tags:
            score += 2
        if t in text:
            score += 1
    return score


def knowledge_search(
    q: str = "",
    *,
    match_id: str | None = None,
    entity: str | None = None,
    chunk_type: ChunkType | None = None,
    limit: int = 3,
) -> dict[str, Any]:
    """Keyword search over KB chunks. Returns top matches by overlap score."""
    terms = _tokenize(q)
    if entity:
        terms |= _tokenize(entity)

    seen: set[str] = set()
    candidates: list[dict[str, Any]] = []
    for chunk in _load_all_chunks():
        if chunk["id"] not in seen:
            seen.add(chunk["id"])
            candidates.append(chunk)
    if match_id:
        for chunk in _load_match_chunks(match_id):
            if chunk["id"] not in seen:
                seen.add(chunk["id"])
                candidates.append(chunk)

    scored: list[tuple[int, dict[str, Any]]] = []
    entity_lower = (entity or "").lower()
    type_filter = chunk_type

    for chunk in candidates:
        if type_filter and chunk.get("type") != type_filter:
            continue
        if match_id and chunk.get("match_id") and chunk["match_id"] != match_id:
            continue
        if entity_lower and entity_lower not in chunk.get("entity", "").lower():
            if not any(entity_lower in t.lower() for t in chunk.get("tags", [])):
                if entity_lower not in chunk.get("text", "").lower():
                    continue
        score = _score_chunk(chunk, terms)
        if score > 0 or (not q and not entity):
            scored.append((score, chunk))

    scored.sort(key=lambda x: (-x[0], x[1]["id"]))
    hits = [
        {
            "id": c["id"],
            "type": c["type"],
            "entity": c.get("entity", ""),
            "match_id": c.get("match_id", ""),
            "score": score,
            "text": c["text"],
            "source_file": c.get("source_file", ""),
        }
        for score, c in scored[: max(1, limit)]
    ]
    if not hits and candidates and not q and not entity:
        hits = [
            {
                "id": c["id"],
                "type": c["type"],
                "entity": c.get("entity", ""),
                "match_id": c.get("match_id", ""),
                "score": 0,
                "text": c["text"],
                "source_file": c.get("source_file", ""),
            }
            for c in candidates[: max(1, limit)]
        ]

    return {"query": q, "match_id": match_id, "count": len(hits), "chunks": hits}


def knowledge_for_match(
    match_id: str,
    *,
    extra_query: str = "",
    limit: int = 3,
) -> list[dict[str, Any]]:
    """Preload a few relevant chunks for tick/chat payloads."""
    meta = load_meta(match_id)
    home = meta.get("home", "")
    away = meta.get("away", "")
    query = f"{home} {away} {extra_query}".strip()
    result = knowledge_search(q=query, match_id=match_id, limit=limit)
    return result["chunks"]
