import { redirect } from "next/navigation"
import { UserRole } from "@prisma/client"

import { auth } from "@/auth"
import { ChatDashboard } from "@/app/_components/chat-dashboard"
import { listGroupsForUser, listWorkersForConversationCreation } from "@/server/services/access"
import { listConversationsForUser, listAvailableGroupsForWorker } from "@/server/services/conversation"

export default async function HomePage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const [conversations, groups, workers, workerGroups] = await Promise.all([
    listConversationsForUser({
      id: session.user.id,
      role: session.user.role,
    }),
    listGroupsForUser({
      id: session.user.id,
      role: session.user.role,
    }),
    listWorkersForConversationCreation({
      id: session.user.id,
      role: session.user.role,
    }),
    listAvailableGroupsForWorker({
      id: session.user.id,
      role: session.user.role,
    }),
  ])

  // マネージャーの場合、会話がないワーカーも含める
  const conversationMap = new Map(
    conversations.map((conv) => [conv.worker?.id, conv])
  )

  const initialConversations = workers.map((worker) => {
    const existingConv = conversationMap.get(worker.id)

    if (existingConv) {
      // 既存の会話がある場合
      return {
        id: existingConv.id,
        subject: existingConv.subject,
        status: existingConv.status,
        updatedAt: existingConv.updatedAt.toISOString(),
        group: existingConv.group,
        worker: existingConv.worker ?? null,
        lastMessage:
          existingConv.messages[0] && existingConv.messages[0].sender
            ? {
                id: existingConv.messages[0].id,
                body: existingConv.messages[0].body,
                language: existingConv.messages[0].language,
                type: existingConv.messages[0].type,
                createdAt: existingConv.messages[0].createdAt.toISOString(),
                metadata: null,
                sender: {
                  id: existingConv.messages[0].sender.id,
                  name: existingConv.messages[0].sender.name ?? null,
                  role: existingConv.messages[0].sender.role,
                },
                llmArtifact: null,
              }
            : null,
        consultation: existingConv.consultation
          ? {
              id: existingConv.consultation.id,
              category: existingConv.consultation.category,
              status: existingConv.consultation.status,
              priority: existingConv.consultation.priority,
              summary: existingConv.consultation.summary ?? null,
            }
          : null,
      }
    } else {
      // 会話がないワーカーの場合、仮のエントリを作成
      const workerGroup = groups.find(g => worker.groupIds.includes(g.id))
      return {
        id: `placeholder-${worker.id}`,
        subject: null,
        status: "ACTIVE" as const,
        updatedAt: new Date().toISOString(),
        group: workerGroup ? { id: workerGroup.id, name: workerGroup.name } : { id: "", name: "" },
        worker: {
          id: worker.id,
          name: worker.name,
        },
        lastMessage: null,
        consultation: null,
      }
    }
  })

  // MEMBERの場合は workerGroups を使用、それ以外は groups を使用
  const availableGroups = session.user.role === UserRole.MEMBER
    ? workerGroups
    : groups.map((group) => ({ id: group.id, name: group.name }))

  const availableWorkers = workers.map((worker) => ({
    id: worker.id,
    name: worker.name,
    email: worker.email,
    groupIds: worker.groupIds,
  }))

  return (
    <main className="flex h-[100dvh] flex-col overflow-hidden bg-muted/20">
      <ChatDashboard
        initialConversations={initialConversations}
        availableGroups={availableGroups}
        availableWorkers={availableWorkers}
        currentUser={{
          id: session.user.id,
          role: session.user.role,
          name: session.user.name ?? null,
        }}
      />
    </main>
  )
}
