-- CreateTable
CREATE TABLE "ConversationSegment" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "messageIds" TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationSegment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationSegment_conversationId_idx" ON "ConversationSegment"("conversationId");

-- AddForeignKey
ALTER TABLE "ConversationSegment" ADD CONSTRAINT "ConversationSegment_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
