# Stock Analyzer

Stock market analysis app with Google SSO, an AI assistant (tool calling + guardrails), statistical forecasts and **paper trading** (simulated, no real money).

- **Dashboard:** portfolio summary and today's top US stocks (most active, gainers, losers)
- **Stock page:** live quote, 12-month chart with moving averages, technical signals, forecast, buy/sell
- **Portfolio:** holdings at live prices, P&L, trade history
- **AI Assistant:** chat that calls tools to list, analyze, forecast and trade (trades need a click to confirm)

Stack: Next.js 16, Auth.js (Google), Postgres + Prisma 7, Vercel AI SDK 7 + Gemini on Vertex AI, Yahoo Finance data, Recharts.

## Setup

1. Install dependencies (also generates the Prisma client):
   ```bash
   npm install
   ```
2. Create a Postgres database, e.g. with Homebrew:
   ```bash
   brew install postgresql@17 && brew services start postgresql@17
   createdb stockapp
   ```
3. Copy `.env.example` to `.env.local` and fill it in:
   - `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET`: a Google OAuth **Web application** client with redirect URI `http://localhost:3000/api/auth/callback/google`
   - `AUTH_SECRET` and `TOOL_APPROVAL_SECRET`: `openssl rand -base64 32`
   - `GOOGLE_VERTEX_PROJECT`: a GCP project with the Vertex AI API enabled
4. Log in to Google Cloud for Vertex AI:
   ```bash
   gcloud auth application-default login
   ```
5. Create the tables and start the app:
   ```bash
   npx prisma migrate dev
   npm run dev
   ```
   Open http://localhost:3000.

View the database with `npm run db:studio` (http://localhost:5555).

## Troubleshooting login

**"Sign-in is misconfigured"** means Auth.js failed before reaching Google. Check the `[auth][error]` line in the `npm run dev` terminal:

- `AdapterError` / `Can't reach database server`: Postgres isn't running, or the database in `DATABASE_URL` doesn't exist on this machine. Create it, then run `npx prisma migrate dev`. On Windows (psql or pgAdmin, as the `postgres` user):
  ```sql
  CREATE ROLE stockapp LOGIN PASSWORD 'choose-a-password' CREATEDB;
  CREATE DATABASE stockapp OWNER stockapp;
  ```
- `MissingSecret`: the env file wasn't found. It must be named exactly `.env.local` or `.env` in the project root. On Windows, check it isn't `.env.txt` (File Explorer → View → Show → File name extensions).

**"redirect_uri_mismatch"**: open the app at exactly `http://localhost:3000`, or add your URL to the OAuth client's redirect URIs.

**Chat says it "can't authenticate with Google Cloud"** (server log: `Could not load the default credentials`): this computer has no Google Cloud credentials for Vertex AI. Either paste a service-account key into `GOOGLE_VERTEX_CREDENTIALS` in `.env.local` (base64 of the JSON key; the service account needs the **Vertex AI User** role), or install the [gcloud CLI](https://cloud.google.com/sdk/docs/install) and run `gcloud auth application-default login` with an account that has the **Vertex AI User** role on the project, or set `GOOGLE_APPLICATION_CREDENTIALS` in `.env.local` to the path of a service-account JSON key. Restart `npm run dev` afterwards.

**"Access blocked" / AccessDenied**: while the Google app is in Testing mode, add your Gmail under Google Auth Platform → Audience → Test users.

## Guardrails

| Layer | Where | What |
|---|---|---|
| Input | `src/lib/guardrails.ts` | Length limit, per-user rate limit, prompt-injection patterns, LLM topic/safety classifier |
| Model | `src/app/api/chat/route.ts` | System instructions: numbers only from tools, no promised returns, no personal advice |
| Tools | `src/lib/trading.ts`, `src/lib/chat-tools.ts` | User ID from session, server-side prices, order limits, cash/holding checks, signed user confirmation before any trade |
| Output | `src/lib/guardrails.ts` | Streaming filter that rewrites "guaranteed returns", "risk-free" and similar claims |

Every block and trade is recorded in the `AuditLog` table.

Not financial advice. Market data may be delayed.

## AI Auto-Trader (/agent)

An agent that watches 24 stocks (12 US + 12 NIFTY by default), scores each one from -100 to +100
(trend, MACD momentum, RSI, 20-day return), has Gemini review the buy candidates, and trades
virtual money within your limits (budget, per-stock %, stop-loss, take-profit, trades per day).

- **Modes:** Auto (trades itself) · Suggest (you approve each trade) · Dry run (records only)
- **Schedule:** every 5 minutes while NSE or NYSE is open; **Demo speed** runs every minute, any time
- **Safety:** every order goes through the normal trade checks, the admin kill switch and a
  database run lock; the agent never re-buys a stock within 30 minutes
- **Backtest:** replays 3, 6 or 12 months of real prices through the same strategy and compares
  it with buy-and-hold, the S&P 500 and NIFTY 50

**Demo (3 minutes):** open Auto-Trader, pick a risk level, press *Backtest last 6 months*, then
switch it on with *Demo speed* and press *Run now*. Open a trade to see its score breakdown, turn
off trading in Settings > Platform settings to show the kill switch, and ask the chat
"What did my auto-trader do today and why?".

Tests: `npm test` (strategy scoring and every trading limit).
