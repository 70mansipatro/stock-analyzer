-- AlterEnum: the old AUTO mode already traded without approval, so it becomes FULL_AUTO (existing rows keep working).
ALTER TYPE "AgentMode" RENAME VALUE 'AUTO' TO 'FULL_AUTO';

-- AlterTable (new defaults apply to new rows only; existing users keep their settings)
ALTER TABLE "AgentConfig" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "marketHoursOnly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "summaryHour" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "tradeEmails" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "trailingStopEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trailingStopPct" DECIMAL(5,2) NOT NULL DEFAULT 10,
ALTER COLUMN "mode" SET DEFAULT 'FULL_AUTO',
ALTER COLUMN "stopLossPct" SET DEFAULT 15;

-- AlterTable
ALTER TABLE "AgentDecision" ADD COLUMN     "aiStatus" TEXT,
ADD COLUMN     "entryPriceUsd" DECIMAL(14,4),
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "market" TEXT,
ADD COLUMN     "priceUsd" DECIMAL(14,4),
ADD COLUMN     "realizedPnl" DECIMAL(14,2),
ADD COLUMN     "realizedPnlPct" DECIMAL(8,2),
ADD COLUMN     "settings" JSONB,
ADD COLUMN     "trigger" TEXT;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "buyCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "errorCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "holdCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sellCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AgentPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "highWaterUsd" DECIMAL(14,4) NOT NULL,
    "buyTradeId" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentPosition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentPosition_userId_symbol_key" ON "AgentPosition"("userId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "AgentDecision_idempotencyKey_key" ON "AgentDecision"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AgentDecision_userId_action_createdAt_idx" ON "AgentDecision"("userId", "action", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_userId_symbol_createdAt_idx" ON "AgentDecision"("userId", "symbol", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_tradeId_idx" ON "AgentDecision"("tradeId");

-- CreateIndex
CREATE INDEX "Trade_userId_source_createdAt_idx" ON "Trade"("userId", "source", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentPosition" ADD CONSTRAINT "AgentPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "AgentConfig"("userId") ON DELETE CASCADE ON UPDATE CASCADE;
