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

**Paper trading only — no real money is used.** The Auto-Trader uses configurable profit targets and
risk protection, but market returns are not guaranteed.

The agent watches the stocks you select (US tickers, or Indian ones on NSE `.NS` / BSE `.BO`), scores
each one from -100 to +100 (200/50/20-day averages, MACD momentum, RSI, 20-day return), applies your
exit rules and limits, has Gemini review the buy candidates, and trades virtual money.

- **Modes:** Full auto (buys and sells by itself, no approval) · Suggest (you approve each trade) · Dry run (records only)
- **Exit rules:** profit target (default 15%, 0 = off), maximum loss (default 15%), optional trailing stop
  (e.g. bought at $100, peaked at $130, 10% trail → sells near $117), and a weak strategy score after a
  5-day minimum hold. Protective exits are never held back by the daily trade cap.
- **AI review:** can only veto a buy. It never adds or resizes a trade and never blocks a sell; if Gemini
  is unavailable the rule engine decides and the run is marked "AI unavailable".
- **Schedule:** every 5 minutes while each stock's own exchange is open (NYSE/Nasdaq in New York time,
  NSE/BSE in India time, weekends and exchange holidays excluded). *Run now* scans any time but still
  holds orders for a closed market unless *Market hours only* is off; *Demo speed* runs every minute.
- **Safety:** every order goes through `executeOrder` (role, suspension, kill switch, per-order limits,
  cash, holdings); a database run lock stops overlapping runs; an idempotency key allows one automatic
  buy per stock per day and one sell per position; the trade, its decision and the position are written
  in one transaction; switching the agent off stops the run before its next order.
- **History:** every scan and decision (BUY / SELL / HOLD, score, reasons, AI verdict, risk settings,
  entry/exit price, realized P/L) is kept in `AgentDecision`, with an `AuditLog` entry for each order.
- **Notifications:** in-app, an email per automatic trade and a daily summary (after the hour you pick),
  plus an optional webhook (`NOTIFY_WEBHOOK_URL`), all through `src/lib/notify.ts`. A failed notification
  never undoes a trade.
- **Backtest:** a historical simulation of your saved settings on your selected stocks (same strategy,
  exit rules and limits), compared with buy-and-hold, the S&P 500 and NIFTY 50. Past results do not
  guarantee future returns.

**Try FULL AUTO locally:** open Auto-Trader, add 3 stocks (e.g. NVDA, MSFT, RELIANCE.NS), pick *Full auto*,
set profit target and maximum loss to 15%, save, press *Start Auto-Trader*, then *Run now* (or turn on
*Demo speed* to run every minute outside market hours). Trades appear under *Recent automatic trades*,
in Portfolio, under the bell and in the admin Emails tab.

Tests: `npm test` (strategy scoring, exit rules, market hours, every trading limit, and full auto-trader runs against an in-memory database).
