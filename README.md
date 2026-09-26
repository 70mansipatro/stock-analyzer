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

## Guardrails

| Layer | Where | What |
|---|---|---|
| Input | `src/lib/guardrails.ts` | Length limit, per-user rate limit, prompt-injection patterns, LLM topic/safety classifier |
| Model | `src/app/api/chat/route.ts` | System instructions: numbers only from tools, no promised returns, no personal advice |
| Tools | `src/lib/trading.ts`, `src/lib/chat-tools.ts` | User ID from session, server-side prices, order limits, cash/holding checks, signed user confirmation before any trade |
| Output | `src/lib/guardrails.ts` | Streaming filter that rewrites "guaranteed returns", "risk-free" and similar claims |

Every block and trade is recorded in the `AuditLog` table.

Not financial advice. Market data may be delayed.
