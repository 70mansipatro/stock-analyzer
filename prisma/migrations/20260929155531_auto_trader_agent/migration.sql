-- CreateEnum
CREATE TYPE "AgentMode" AS ENUM ('AUTO', 'SUGGEST', 'DRY_RUN');

-- CreateEnum
CREATE TYPE "AgentRisk" AS ENUM ('CONSERVATIVE', 'BALANCED', 'AGGRESSIVE');

-- AlterEnum
ALTER TYPE "TradeSource" ADD VALUE 'AGENT';

-- CreateTable
CREATE TABLE "AgentConfig" (
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" "AgentMode" NOT NULL DEFAULT 'AUTO',
    "risk" "AgentRisk" NOT NULL DEFAULT 'BALANCED',
    "budget" DECIMAL(14,2) NOT NULL DEFAULT 5000,
    "maxPositionPct" INTEGER NOT NULL DEFAULT 15,
    "maxTradesPerDay" INTEGER NOT NULL DEFAULT 10,
    "stopLossPct" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "takeProfitPct" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "universe" TEXT[],
    "useAiReview" BOOLEAN NOT NULL DEFAULT true,
    "dailyEmail" BOOLEAN NOT NULL DEFAULT true,
    "demoSpeed" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastSummaryDate" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentConfig_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "mode" "AgentMode" NOT NULL,
    "status" TEXT NOT NULL,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "summary" TEXT,
    "aiNote" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentDecision" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(14,4),
    "score" INTEGER NOT NULL DEFAULT 0,
    "confidence" INTEGER NOT NULL DEFAULT 0,
    "reasons" JSONB NOT NULL,
    "aiNote" TEXT,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "tradeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentRun_userId_startedAt_idx" ON "AgentRun"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentDecision_userId_createdAt_idx" ON "AgentDecision"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentDecision_userId_status_idx" ON "AgentDecision"("userId", "status");

-- AddForeignKey
ALTER TABLE "AgentConfig" ADD CONSTRAINT "AgentConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentDecision" ADD CONSTRAINT "AgentDecision_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
