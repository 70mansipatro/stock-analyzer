-- CreateTable
CREATE TABLE "BlockedEmail" (
    "email" TEXT NOT NULL,
    "name" TEXT,
    "reason" TEXT,
    "blockedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedEmail_pkey" PRIMARY KEY ("email")
);
