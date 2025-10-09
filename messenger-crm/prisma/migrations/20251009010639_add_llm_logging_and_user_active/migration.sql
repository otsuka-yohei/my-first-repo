-- CreateEnum
CREATE TYPE "SuggestionAction" AS ENUM ('USED_AS_IS', 'USED_WITH_EDIT', 'NOT_USED');

-- CreateEnum
CREATE TYPE "TagChangeAction" AS ENUM ('ADDED', 'REMOVED', 'MODIFIED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "SuggestionUsageLog" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suggestionIndex" INTEGER NOT NULL,
    "suggestionText" TEXT NOT NULL,
    "action" "SuggestionAction" NOT NULL,
    "originalText" TEXT,
    "editedText" TEXT,
    "prompt" TEXT,
    "modelUsed" TEXT,
    "tokensUsed" INTEGER,
    "generationTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestionUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TagChangeLog" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "TagChangeAction" NOT NULL,
    "tagName" TEXT NOT NULL,
    "previousValue" TEXT,
    "newValue" TEXT,
    "isAIGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuggestionUsageLog_messageId_idx" ON "SuggestionUsageLog"("messageId");

-- CreateIndex
CREATE INDEX "SuggestionUsageLog_userId_idx" ON "SuggestionUsageLog"("userId");

-- CreateIndex
CREATE INDEX "SuggestionUsageLog_action_idx" ON "SuggestionUsageLog"("action");

-- CreateIndex
CREATE INDEX "SuggestionUsageLog_createdAt_idx" ON "SuggestionUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "TagChangeLog_consultationId_idx" ON "TagChangeLog"("consultationId");

-- CreateIndex
CREATE INDEX "TagChangeLog_userId_idx" ON "TagChangeLog"("userId");

-- CreateIndex
CREATE INDEX "TagChangeLog_action_idx" ON "TagChangeLog"("action");

-- CreateIndex
CREATE INDEX "TagChangeLog_createdAt_idx" ON "TagChangeLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "SuggestionUsageLog" ADD CONSTRAINT "SuggestionUsageLog_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestionUsageLog" ADD CONSTRAINT "SuggestionUsageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagChangeLog" ADD CONSTRAINT "TagChangeLog_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "ConsultationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagChangeLog" ADD CONSTRAINT "TagChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
