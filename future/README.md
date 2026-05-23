# RocketRide Exa API

Minimal Flask API that exposes RocketRide's native `search_exa` pipeline over HTTP.
The Oracle UI uses RocketRide for live commentary/context and Polymarket's public Gamma API for real active market data.

## Start RocketRide

In one terminal:

```bash
cd /Users/kaushiksivakumar/workspace/rocketride/rocketride-server
ROCKETRIDE_EXA_KEY=your_exa_key ./builder server:run
```

Keep that process running.

## Start The Flask API

In another terminal:

```bash
cd /Users/kaushiksivakumar/workspace/rocketride
python -m pip install -r requirements.txt
python api.py
```

The API listens on `http://127.0.0.1:5055` by default. Port `5000` is often used by macOS AirPlay/AirTunes.

## Call It

```bash
curl -s http://127.0.0.1:5055/health
```

```bash
curl -s -X POST http://127.0.0.1:5055/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"latest rocket launch news"}'
```

## Expose With Ngrok

```bash
ngrok http 5055
```

Then call the forwarded URL:

```bash
curl -s -X POST https://YOUR-NGROK-DOMAIN.ngrok-free.app/search \
  -H 'Content-Type: application/json' \
  -d '{"query":"latest rocket launch news"}'
```

## Polymarket Signal Desk

Start the RocketRide-backed search API first, then run the analyst UI:

```bash
cd /Users/kaushiksivakumar/workspace/rocketride
python oracle_app.py
```

Open:

```text
http://127.0.0.1:6060
```

Expose the UI with:

```bash
ngrok http 6060
```

Optional WhatsApp alerts use Twilio:

```bash
export TWILIO_ACCOUNT_SID=...
export TWILIO_AUTH_TOKEN=...
export TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
export TWILIO_WHATSAPP_TO=whatsapp:+1...
```

Optional GMI Cloud LLM ranking:

```bash
export GMI_API_KEY=...
export GMI_MODEL=google/gemma-4-31b-it
export GMI_VIA_ROCKETRIDE=1
```

The live-bets workflow uses Polymarket Gamma public search for active markets, RocketRide/Exa for current evidence, and GMI Cloud for bullet-point ranking. By default it tries GMI through RocketRide's `llm_gmi_cloud` pipe first, then falls back to the direct GMI `/v1/chat/completions` HTTP call if that pipe is unavailable.

For GMI through RocketRide, the RocketRide server process must also receive `GMI_API_KEY`; loading `.env` in the Flask app is not enough because RocketRide runs as a separate process:

```bash
cd /Users/kaushiksivakumar/workspace/rocketride/rocketride-server
export GMI_API_KEY=...
./builder server:run
```

All app environment variables can live in `.env` at the workspace root.

## Files

- `api.py` - Flask API
- `oracle_app.py` - analyst UI and signal API
- `rocketride_exa.py` - shared RocketRide client helper
- `run_exa_pipe.py` - command-line runner for direct local testing
- `rocketride-server/` - RocketRide server checkout
