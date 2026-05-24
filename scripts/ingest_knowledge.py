"""Ingest data/knowledge/*.txt into Chroma via RocketRide (knowledge_ingest.pipe).

RocketRide handles parsing, LangChain chunking, miniLM embedding, and vector
storage — run once before demo (or when KB files change).

Prerequisites:
  - RocketRide local server on :8080
  - Chroma on localhost:8330  (docker run -p 8330:8000 chromadb/chroma)
  - pip install rocketride

Usage:
  python scripts/ingest_knowledge.py
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
PIPE = REPO / "knowledge_ingest.pipe"
KB_DIR = REPO / "data" / "knowledge"


async def main() -> int:
    files = sorted(KB_DIR.rglob("*.txt"))
    if not files:
        print(f"No .txt files under {KB_DIR}")
        return 1
    if not PIPE.exists():
        print(f"Missing {PIPE}")
        return 1

    try:
        from rocketride import RocketRideClient
    except ImportError:
        print("Install the RocketRide client: pip install rocketride")
        return 1

    print(f"Ingesting {len(files)} knowledge files via {PIPE.name} …")
    async with RocketRideClient() as client:
        result = await client.use(filepath=str(PIPE))
        token = result["token"]
        print(f"Pipeline token: {token}")
        await client.send_files([str(p) for p in files], token)
        status = await client.get_task_status(token)
        print(f"Done — pipeline state: {status.get('state', status)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
