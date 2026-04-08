# GitHub → DeepFlow Webhook Bridge

Proof of concept that receives GitHub webhook events (PR lifecycle) and maps them to DeepFlow ticket updates via the template-webhook API.

See [GAPS.md](GAPS.md) for the full product gap analysis.

## What It Does

```
GitHub PR Event          →  Webhook Bridge         →  DeepFlow
─────────────────────────────────────────────────────────────────
PR opened (branch X)     →  Extract branch name    →  Move ticket to "PR Open"
Review requested         →  Identify reviewer      →  Reassign ticket to reviewer
PR merged                →  Detect merge           →  Mark ticket as "Done"
PR closed (no merge)     →  Log only               →  No action
```

## Quick Start

```bash
npm install
cp .env.example .env     # edit with your values
npm start
```

## Test Locally

Simulate a full PR lifecycle (open → review → merge) without needing GitHub:

```bash
# Start the server
npm start

# In another terminal — run the full lifecycle
npm run test-lifecycle

# Or individual events
npm run test-ping
npm run test-pr-opened
npm run test-pr-review
npm run test-pr-merged
npm run test-pr-closed
npm run test-push
```

## Configuration (.env)

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `WEBHOOK_SECRET` | GitHub webhook secret for signature verification |
| `DEEPFLOW_WEBHOOK_URL` | DeepFlow template-webhook endpoint |
| `PUBLIC_BASE_URL` | Public URL for this server (ngrok) — needed for DeepFlow to download event data |

## Deploy to Render

1. Go to [render.com](https://render.com) → **New** → **Web Service**
2. Connect your GitHub repo (`danijelvukovic-servalit/deepflow-webhook-test`)
3. Render auto-detects `render.yaml` — confirm settings
4. Set environment variables:
   - `PUBLIC_BASE_URL` = your Render URL (e.g. `https://deepflow-webhook-bridge.onrender.com`)
   - `WEBHOOK_SECRET` = generate with `npm run generate-secret`
   - `DEEPFLOW_WEBHOOK_URL` = your DeepFlow template-webhook URL
5. Deploy

Or use the Dockerfile:
```bash
docker build -t deepflow-webhook-bridge .
docker run -p 3000:3000 --env-file .env deepflow-webhook-bridge
```

## Connecting to GitHub

1. Generate a secret: `npm run generate-secret`
2. In your GitHub repo → Settings → Webhooks → Add webhook:
   - **Payload URL**: `https://your-render-url.onrender.com/webhook`
   - **Content type**: `application/json`
   - **Secret**: same as your env var
   - **Events**: Pull requests
3. The server will process PR events and forward to DeepFlow

## API Endpoints

| Endpoint | Description |
|---|---|
| `GET /` | Dashboard — server status + recent events with DeepFlow mapping |
| `GET /events` | List all received events (last 50) |
| `GET /events/:filename` | View a specific event's full payload |
| `POST /webhook` | GitHub webhook receiver |
| `GET /event-data/:id.json` | Hosted event data (for DeepFlow to download) |
| `POST /deepflow-results` | Receives results back from DeepFlow workflows |
| `GET /deepflow-results` | List DeepFlow workflow results |

## Project Structure

```
├── server.js            # Express server — webhook receiver + dashboard
├── deepflow-client.js   # DeepFlow API client — event mapping + forwarding
├── test-webhook.js      # Test script — simulates GitHub PR lifecycle
├── GAPS.md              # Product gap analysis for the client
├── Dockerfile           # Docker image for deployment
├── render.yaml          # Render.com auto-deploy config
├── .env.example         # Configuration template
└── logs/                # Received events + event data (gitignored)
```
