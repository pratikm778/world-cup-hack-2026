import base64
import asyncio
import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

from flask import Flask, jsonify, render_template, request

from env_loader import load_dotenv
from rocketride_exa import DEFAULT_GMI_PIPE, run_rocketride_chat_pipe

load_dotenv()

app = Flask(__name__)

SEARCH_API_URL = os.environ.get("ROCKETRIDE_SEARCH_API", "http://127.0.0.1:5055/search")
POLYMARKET_GAMMA_URL = os.environ.get("POLYMARKET_GAMMA_URL", "https://gamma-api.polymarket.com")
GMI_CHAT_URL = os.environ.get("GMI_CHAT_URL", "https://api.gmi-serving.com/v1/chat/completions")
GMI_MODEL = os.environ.get("GMI_MODEL", "google/gemini-3.5-flash")
GMI_VIA_ROCKETRIDE = os.environ.get("GMI_VIA_ROCKETRIDE", "1").strip().lower() not in {"0", "false", "no"}
POLYMARKET_WEB_URL = os.environ.get("POLYMARKET_WEB_URL", "https://polymarket.com")

MOMENTUM_TERMS = {
    "breakaway": 18,
    "one on one": 16,
    "counter attack": 14,
    "dangerous attack": 12,
    "big chance": 18,
    "shot on target": 12,
    "shots on target": 12,
    "penalty": 24,
    "var": 10,
    "corner": 8,
    "free kick": 7,
    "saved": 8,
    "woodwork": 14,
    "cross": 7,
    "pressure": 8,
    "possession": 5,
    "attacking third": 10,
    "goal disallowed": 18,
}

EXCITEMENT_TERMS = {
    "screaming": 12,
    "erupts": 10,
    "stunning": 8,
    "urgent": 7,
    "chaos": 9,
    "incredible": 7,
    "nearly": 8,
    "just wide": 10,
    "what a save": 12,
}


@dataclass
class OracleSignal:
    status: str
    action: str
    momentum_score: int
    market_lag_score: int
    confidence: int
    alert_message: str
    commentary_summary: str
    market_summary: str
    reasons: list[str]
    whatsapp: dict[str, Any]


def query_search_api(query: str) -> dict[str, Any]:
    body = json.dumps({"query": query}).encode("utf-8")
    req = urllib.request.Request(
        SEARCH_API_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=float(os.environ.get("ORACLE_SEARCH_TIMEOUT", "90"))) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Search API returned {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Search API unavailable at {SEARCH_API_URL}: {exc.reason}") from exc


def safe_query_search_api(label: str, query: str) -> dict[str, Any]:
    try:
        return query_search_api(query)
    except Exception as exc:
        app.logger.exception("%s ingestion failed", label)
        return {
            "status": "error",
            "feed": label,
            "error": str(exc),
            "query": query,
        }


def http_json(url: str, params: dict[str, Any] | None = None, timeout: float = 20) -> Any:
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
    req = urllib.request.Request(url, headers={"User-Agent": "rocketride-oracle/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def parse_jsonish(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    return value


def find_polymarket_events(query: str, limit: int = 5) -> dict[str, Any]:
    search = http_json(
        f"{POLYMARKET_GAMMA_URL}/public-search",
        {
            "q": query,
            "limit_per_type": limit,
            "events_status": "active",
            "keep_closed_markets": 0,
            "search_profiles": "false",
            "search_tags": "false",
        },
    )
    events = search.get("events") if isinstance(search, dict) else []

    if not events:
        events = http_json(
            f"{POLYMARKET_GAMMA_URL}/events",
            {
                "limit": limit,
                "active": "true",
                "closed": "false",
                "event_title": query,
            },
        )
        if isinstance(events, dict):
            events = events.get("events") or events.get("data") or []

    return normalize_polymarket_events(events if isinstance(events, list) else [])


def is_open_market(market: dict[str, Any]) -> bool:
    return bool(market.get("active", True)) and not bool(market.get("closed", False))


def normalize_polymarket_events(events: list[dict[str, Any]]) -> dict[str, Any]:
    normalized_events = []
    market_rows = []

    for event in events:
        event_title = event.get("title") or event.get("question") or event.get("slug")
        event_slug = event.get("slug")
        event_url = polymarket_event_url(event_slug)
        markets = event.get("markets") or []
        clean_markets = []
        for market in markets:
            if not is_open_market(market):
                continue
            outcomes = parse_jsonish(market.get("outcomes")) or []
            prices = parse_jsonish(market.get("outcomePrices")) or []
            clob_token_ids = parse_jsonish(market.get("clobTokenIds")) or []
            outcome_rows = []
            for index, outcome in enumerate(outcomes):
                price = None
                if index < len(prices):
                    try:
                        price = float(prices[index])
                    except (TypeError, ValueError):
                        price = None
                token_id = clob_token_ids[index] if index < len(clob_token_ids) else None
                outcome_rows.append({"name": outcome, "price": price, "token_id": token_id})

            clean_market = {
                "id": market.get("id"),
                "question": market.get("question"),
                "slug": market.get("slug"),
                "conditionId": market.get("conditionId"),
                "url": polymarket_event_url(event_slug or market.get("slug")),
                "event_slug": event_slug,
                "event_url": event_url,
                "volume": market.get("volume") or market.get("volumeNum"),
                "liquidity": market.get("liquidity") or market.get("liquidityNum"),
                "outcomes": outcome_rows,
                "active": market.get("active"),
                "closed": market.get("closed"),
            }
            clean_markets.append(clean_market)
            market_rows.append({**clean_market, "event_title": event_title})

        normalized_events.append(
            {
                "id": event.get("id"),
                "title": event_title,
                "slug": event_slug,
                "url": event_url,
                "startDate": event.get("startDate"),
                "endDate": event.get("endDate"),
                "volume": event.get("volume") or event.get("volumeNum"),
                "markets": clean_markets,
            }
        )

    return {
        "status": "ok",
        "source": "polymarket_gamma",
        "events": normalized_events,
        "markets": market_rows,
        "summary": summarize_polymarket_markets(market_rows),
    }


def summarize_polymarket_markets(markets: list[dict[str, Any]]) -> str:
    parts = []
    for market in markets[:8]:
        outcome_text = []
        for outcome in market.get("outcomes", []):
            price = outcome.get("price")
            if price is None:
                outcome_text.append(str(outcome.get("name")))
            else:
                outcome_text.append(f"{outcome.get('name')} {round(price * 100)}%")
        parts.append(f"{market.get('question') or market.get('event_title')}: {', '.join(outcome_text)}")
    return " | ".join(parts) or "No active Polymarket markets returned."


def polymarket_event_url(slug: Any) -> str | None:
    if not slug:
        return None
    return f"{POLYMARKET_WEB_URL.rstrip('/')}/event/{urllib.parse.quote(str(slug), safe='')}"


def market_yes_price(market: dict[str, Any]) -> float | None:
    for outcome in market.get("outcomes", []):
        if str(outcome.get("name", "")).lower() == "yes":
            return outcome.get("price")
    outcomes = market.get("outcomes", [])
    return outcomes[0].get("price") if outcomes else None


def numeric_value(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def discover_top_markets(theme: str, limit: int = 10) -> list[dict[str, Any]]:
    market_data = find_polymarket_events(theme, limit=max(10, limit))
    candidates = []
    for market in market_data.get("markets", []):
        yes_price = market_yes_price(market)
        if yes_price is None:
            continue
        candidates.append(
            {
                "event_title": market.get("event_title"),
                "question": market.get("question"),
                "slug": market.get("slug"),
                "conditionId": market.get("conditionId"),
                "url": market.get("url"),
                "event_url": market.get("event_url"),
                "yes_price": yes_price,
                "no_price": 1 - yes_price,
                "volume": numeric_value(market.get("volume")),
                "liquidity": numeric_value(market.get("liquidity")),
                "outcomes": market.get("outcomes", []),
            }
        )

    candidates.sort(key=lambda item: (item["volume"], item["liquidity"]), reverse=True)
    return candidates[:limit]


def realtime_insight_for_market(market: dict[str, Any]) -> dict[str, Any]:
    question = market.get("question") or market.get("event_title") or "Polymarket market"
    query = (
        "latest real-time news, injuries, lineups, match context, odds movement, and material facts for "
        f"this Polymarket market: {question}"
    )
    evidence = safe_query_search_api("market_insight", query)
    unwrapped = unwrap_rocketride_search(evidence)
    return {
        "query": query,
        "summary": unwrapped.get("summary", compact_text(unwrapped, 1200)),
        "sources": unwrapped.get("sources", []),
        "status": unwrapped.get("status"),
    }


def heuristic_rank_bets(candidates: list[dict[str, Any]], reason: str | None = None) -> list[dict[str, Any]]:
    ranked = []
    for market in candidates:
        yes_price = market["yes_price"]
        liquidity = market.get("liquidity", 0)
        volume = market.get("volume", 0)
        price_edge_band = 1 - abs(0.5 - yes_price) * 2
        score = round(min(100, (price_edge_band * 48) + min(volume / 250000, 25) + min(liquidity / 25000, 27)))
        ranked.append(
            {
                "rank": 0,
                "question": market["question"],
                "event_title": market["event_title"],
                "recommendation": "watch",
                "side": "Yes" if yes_price <= 0.62 else "No",
                "price": yes_price,
                "score": score,
                "reason": reason or "Heuristic ranking because GMI reasoning is unavailable.",
                "risk": "No LLM ranking was run; verify market rules and liquidity before trading.",
            }
        )
    ranked.sort(key=lambda item: item["score"], reverse=True)
    for index, item in enumerate(ranked, start=1):
        item["rank"] = index
    return ranked


def build_gmi_ranker_prompt(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    compact_candidates = []
    for market in candidates:
        compact_candidates.append(
            {
                "event_title": market.get("event_title"),
                "question": market.get("question"),
                "yes_price": market.get("yes_price"),
                "no_price": market.get("no_price"),
                "volume": market.get("volume"),
                "liquidity": market.get("liquidity"),
                "url": market.get("url") or market.get("event_url"),
                "insight": market.get("insight", {}).get("summary", "")[:1400],
                "sources": market.get("insight", {}).get("sources", [])[:5],
            }
        )

    return {
        "task": "Rank live Polymarket betting opportunities using market price plus real-time Exa evidence.",
        "rules": [
            "Return JSON only.",
            "Do not claim certainty.",
            "Prefer markets where the evidence is fresh, specific, and plausibly not fully reflected in the current price.",
            "Use concise bullet points for reasoning and risks.",
            "If evidence is weak, stale, or not directly about the market, lower the score and say so.",
        ],
        "markets": compact_candidates,
        "output_schema": {
            "rankings": [
                {
                    "rank": 1,
                    "question": "string",
                    "event_title": "string",
                    "recommendation": "buy_yes|buy_no|watch|avoid",
                    "side": "Yes|No|None",
                    "price": 0.5,
                    "score": 0,
                    "reason": "one sentence summary",
                    "reason_bullets": ["specific evidence bullet", "price/market mismatch bullet"],
                    "risk_bullets": ["liquidity/rules/staleness risk"],
                    "risk": "one sentence risk summary",
                }
            ]
        },
    }


def normalize_gmi_rankings(parsed: dict[str, Any], *, provider: str, model: str | None, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    result = {
        "provider": provider,
        "model": model,
        "rankings": parsed.get("rankings", []),
    }
    if extra:
        result.update(extra)
    return result


def extract_rocketride_answer_text(result: Any) -> str:
    if isinstance(result, dict):
        answers = result.get("answers")
        if isinstance(answers, list) and answers:
            return str(answers[0])
        if isinstance(answers, str):
            return answers
        for key in ("answer", "content", "text", "result"):
            if key in result:
                value = result[key]
                return value if isinstance(value, str) else json.dumps(value)
    if isinstance(result, list) and result:
        return str(result[0])
    return str(result)


def parse_json_object_text(content: str) -> dict[str, Any]:
    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def call_gmi_ranker_via_rocketride(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    prompt = build_gmi_ranker_prompt(candidates)
    prompt_text = json.dumps(
        {
            "system": "You are a prediction-market analyst. Produce concise, risk-aware JSON.",
            "user": prompt,
        },
        ensure_ascii=False,
    )
    result = asyncio.run(
        run_rocketride_chat_pipe(
            prompt_text,
            pipe=os.environ.get("ROCKETRIDE_GMI_PIPE", str(DEFAULT_GMI_PIPE)),
            timeout_seconds=float(os.environ.get("ROCKETRIDE_GMI_TIMEOUT", "120")),
        )
    )
    content = extract_rocketride_answer_text(result)
    parsed = parse_json_object_text(content)
    return normalize_gmi_rankings(
        parsed,
        provider="rocketride_gmi",
        model=GMI_MODEL,
        extra={"transport": "rocketride", "pipe": os.environ.get("ROCKETRIDE_GMI_PIPE", str(DEFAULT_GMI_PIPE))},
    )


def call_gmi_ranker_direct(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    api_key = os.environ.get("GMI_API_KEY", "").strip()
    if not api_key:
        return {
            "provider": "heuristic",
            "model": None,
            "rankings": heuristic_rank_bets(candidates, "Heuristic ranking because GMI_API_KEY is not configured."),
            "note": "Set GMI_API_KEY to enable GMI Cloud LLM reasoning.",
        }

    prompt = build_gmi_ranker_prompt(candidates)
    body = json.dumps(
        {
            "model": GMI_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a prediction-market analyst. Produce concise, risk-aware JSON.",
                },
                {"role": "user", "content": json.dumps(prompt)},
            ],
            "temperature": 0.2,
            "max_tokens": 3000,
            "response_format": {"type": "json_object"},
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        GMI_CHAT_URL,
        data=body,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "curl/8.7.1",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=float(os.environ.get("GMI_TIMEOUT", "90"))) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"GMI returned {exc.code}: {detail}") from exc

    content = payload["choices"][0]["message"]["content"]
    parsed = parse_json_object_text(content)
    return normalize_gmi_rankings(parsed, provider="gmi", model=payload.get("model", GMI_MODEL), extra={"usage": payload.get("usage"), "transport": "direct_http"})


def call_gmi_ranker(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    if GMI_VIA_ROCKETRIDE:
        try:
            return call_gmi_ranker_via_rocketride(candidates)
        except Exception as exc:
            direct = call_gmi_ranker_direct(candidates)
            error = str(exc)
            if "Invalid API key" in error:
                error = (
                    "RocketRide GMI node rejected its API key. Restart the RocketRide server with "
                    "GMI_API_KEY exported in that server process environment."
                )
            direct["rocketride_gmi_error"] = error
            direct["transport"] = direct.get("transport", "direct_http")
            return direct
    return call_gmi_ranker_direct(candidates)


def compact_text(value: Any, max_chars: int = 9000) -> str:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, ensure_ascii=False)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


def unwrap_rocketride_search(value: dict[str, Any]) -> dict[str, Any]:
    """Turn RocketRide's answer-wrapped Exa JSON into a compact evidence object."""
    if value.get("status") == "error":
        return value

    answers = value.get("result", {}).get("answers", [])
    if not answers:
        return {"status": "empty", "results": [], "summary": "No search answers returned."}

    first_answer = answers[0]
    try:
        exa_payload = json.loads(first_answer) if isinstance(first_answer, str) else first_answer
    except json.JSONDecodeError:
        return {"status": "raw", "summary": compact_text(first_answer)}

    sources: list[dict[str, Any]] = []
    highlights: list[str] = []
    for item in exa_payload.get("results", [])[:5]:
        item_highlights = item.get("highlights") or []
        clean_highlights = [compact_text(highlight, 360) for highlight in item_highlights[:2]]
        highlights.extend(clean_highlights)
        sources.append(
            {
                "title": item.get("title"),
                "url": item.get("url"),
                "publishedDate": item.get("publishedDate"),
                "highlights": clean_highlights,
            }
        )

    return {
        "status": "ok",
        "requestId": exa_payload.get("requestId"),
        "searchTime": exa_payload.get("searchTime"),
        "sources": sources,
        "summary": " ".join(highlights)[:2200] or "No highlights returned.",
    }


def score_terms(text: str, terms: dict[str, int]) -> tuple[int, list[str]]:
    lower = text.lower()
    score = 0
    hits: list[str] = []
    for term, weight in terms.items():
        if term in lower:
            score += weight
            hits.append(term)
    return min(score, 100), hits[:8]


def extract_market_lag(text: str) -> tuple[int, list[str]]:
    lower = text.lower()
    reasons: list[str] = []
    lag = 25

    percentages = [int(match) for match in re.findall(r"\b([1-9][0-9])\s?%", lower)]
    decimal_odds = [float(match) for match in re.findall(r"\b0\.(\d{2,3})\b", lower)]
    decimal_odds = [float(f"0.{str(value).split('.')[0]}") for value in decimal_odds]

    if percentages:
        best = max(percentages)
        if best < 55:
            lag += 35
            reasons.append(f"market probability appears muted at {best}%")
        elif best < 65:
            lag += 22
            reasons.append(f"market probability appears only moderate at {best}%")
        else:
            lag -= 10
            reasons.append(f"market may already be pricing a move at {best}%")

    if decimal_odds:
        best_decimal = max(decimal_odds)
        if best_decimal < 0.55:
            lag += 30
            reasons.append(f"yes price appears below 0.55 at {best_decimal:.2f}")
        elif best_decimal < 0.65:
            lag += 18
            reasons.append(f"yes price appears below 0.65 at {best_decimal:.2f}")

    if "unchanged" in lower or "hasn't moved" in lower or "has not moved" in lower:
        lag += 20
        reasons.append("market text indicates odds have not moved")
    if "suspended" in lower or "halted" in lower or "resolved" in lower:
        lag -= 35
        reasons.append("market may be halted, suspended, or resolved")

    return max(0, min(lag, 100)), reasons


def make_signal(match: str, commentary: dict[str, Any], market: dict[str, Any]) -> OracleSignal:
    commentary_evidence = unwrap_rocketride_search(commentary)
    market_evidence = market if market.get("source") == "polymarket_gamma" else unwrap_rocketride_search(market)
    commentary_text = compact_text(commentary_evidence.get("summary", commentary_evidence))
    market_text = compact_text(market_evidence.get("summary", market_evidence))

    momentum, momentum_hits = score_terms(commentary_text, MOMENTUM_TERMS)
    excitement, excitement_hits = score_terms(commentary_text, EXCITEMENT_TERMS)
    momentum_score = min(100, momentum + excitement)
    market_lag_score, lag_reasons = extract_market_lag(market_text)
    confidence = round((momentum_score * 0.58) + (market_lag_score * 0.42))

    reasons = []
    if momentum_hits:
        reasons.append("pitch momentum: " + ", ".join(momentum_hits))
    if excitement_hits:
        reasons.append("commentary intensity: " + ", ".join(excitement_hits))
    reasons.extend(lag_reasons)
    if not reasons:
        reasons.append("insufficient live signal density; keep monitoring")

    if momentum_score >= 68 and market_lag_score >= 58:
        status = "alpha"
        action = "Alert"
    elif momentum_score >= 50:
        status = "watch"
        action = "Monitor"
    else:
        status = "quiet"
        action = "Stand down"

    alert_message = (
        f"{match}: {action}. Momentum {momentum_score}/100, market lag {market_lag_score}/100, "
        f"confidence {confidence}/100. {reasons[0]}"
    )

    return OracleSignal(
        status=status,
        action=action,
        momentum_score=momentum_score,
        market_lag_score=market_lag_score,
        confidence=confidence,
        alert_message=alert_message,
        commentary_summary=commentary_text[:700],
        market_summary=market_text[:700],
        reasons=reasons,
        whatsapp={"sent": False, "reason": "not requested"},
    )


def send_whatsapp(message: str) -> dict[str, Any]:
    sid = os.environ.get("TWILIO_ACCOUNT_SID")
    token = os.environ.get("TWILIO_AUTH_TOKEN")
    from_number = os.environ.get("TWILIO_WHATSAPP_FROM")
    to_number = os.environ.get("TWILIO_WHATSAPP_TO")

    if not all([sid, token, from_number, to_number]):
        return {
            "sent": False,
            "reason": "Twilio WhatsApp env vars are not configured",
            "required_env": [
                "TWILIO_ACCOUNT_SID",
                "TWILIO_AUTH_TOKEN",
                "TWILIO_WHATSAPP_FROM",
                "TWILIO_WHATSAPP_TO",
            ],
        }

    data = urllib.parse.urlencode(
        {
            "From": from_number,
            "To": to_number,
            "Body": message,
        }
    ).encode("utf-8")
    auth = base64.b64encode(f"{sid}:{token}".encode("utf-8")).decode("ascii")
    req = urllib.request.Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
        data=data,
        headers={"Authorization": f"Basic {auth}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            body = json.loads(response.read().decode("utf-8"))
            return {"sent": True, "sid": body.get("sid"), "status": body.get("status")}
    except Exception as exc:
        return {"sent": False, "reason": str(exc)}


@app.get("/")
def index():
    return render_template("oracle.html")


@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "search_api": SEARCH_API_URL,
            "gmi_api_key": "set" if os.environ.get("GMI_API_KEY") else "missing",
            "gmi_model": os.environ.get("GMI_MODEL", GMI_MODEL),
            "gmi_via_rocketride": GMI_VIA_ROCKETRIDE,
        }
    )


@app.post("/api/analyze")
def analyze():
    payload = request.get_json(silent=True) or {}
    match = str(payload.get("match") or "France vs opponent").strip()
    market = str(payload.get("market") or f"{match} Polymarket odds win market").strip()
    send_alert = bool(payload.get("send_alert", False))

    started = time.time()
    commentary = safe_query_search_api(
        "commentary",
        f"latest live football commentary play by play momentum shots dangerous attacks {match}"
    )

    try:
        market_data = find_polymarket_events(market)
    except Exception:
        app.logger.exception("polymarket gamma ingestion failed")
        market_data = safe_query_search_api("market", f"latest Polymarket odds probability market {market}")
    signal = make_signal(match, commentary, market_data)

    if send_alert and signal.status == "alpha":
        signal.whatsapp = send_whatsapp(signal.alert_message)
    elif send_alert:
        signal.whatsapp = {"sent": False, "reason": "signal is not strong enough to alert"}

    return jsonify(
        {
            "status": "ok",
            "latency_seconds": round(time.time() - started, 2),
            "signal": signal.__dict__,
            "sources": {
                "commentary": unwrap_rocketride_search(commentary),
                "market": market_data if market_data.get("source") == "polymarket_gamma" else unwrap_rocketride_search(market_data),
            },
        }
    )


@app.post("/api/top-bets")
def top_bets():
    payload = request.get_json(silent=True) or {}
    theme = str(payload.get("theme") or "football soccer today").strip()
    limit = int(payload.get("limit") or 10)
    limit = max(1, min(limit, 10))
    started = time.time()

    candidates = discover_top_markets(theme, limit=limit)
    for market in candidates:
        market["insight"] = realtime_insight_for_market(market)

    try:
        reasoning = call_gmi_ranker(candidates)
    except Exception as exc:
        app.logger.exception("GMI ranking failed")
        reasoning = {
            "provider": "heuristic",
            "model": None,
            "rankings": heuristic_rank_bets(candidates, f"Heuristic ranking because GMI failed: {exc}"),
            "error": str(exc),
        }

    return jsonify(
        {
            "status": "ok",
            "theme": theme,
            "latency_seconds": round(time.time() - started, 2),
            "reasoning": reasoning,
            "candidates": candidates,
        }
    )


if __name__ == "__main__":
    port = int(os.environ.get("ORACLE_PORT", "6060"))
    print(f"Polymarket Signal Desk listening on http://127.0.0.1:{port}", flush=True)
    app.run(host=os.environ.get("ORACLE_HOST", "127.0.0.1"), port=port)
