import { redirect } from "next/navigation"

import { auth } from "@/auth"
import { ChatDashboard } from "@/app/_components/chat-dashboard"
import { listGroupsForUser, listWorkersForConversationCreation } from "@/server/services/access"
import { listConversationsForUser } from "@/server/services/conversation"

export default async function HomePage() {
  const session = await auth()

  if (!session?.user) {
    redirect("/login")
  }

  const [conversations, groups, workers] = await Promise.all([
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
  ])

  const initialConversations = conversations.map((conversation) => ({
    id: conversation.id,
    subject: conversation.subject,
    status: conversation.status,
    updatedAt: conversation.updatedAt.toISOString(),
    group: conversation.group,
    worker: conversation.worker ?? null,
    lastMessage: conversation.messages[0]
      ? {
          id: conversation.messages[0].id,
          body: conversation.messages[0].body,
          language: conversation.messages[0].language,
          createdAt: conversation.messages[0].createdAt.toISOString(),
          sender: conversation.messages[0].sender
            ? {
                id: conversation.messages[0].sender.id,
                name: conversation.messages[0].sender.name,
                role: conversation.messages[0].sender.role,
              }
            : null,
        }
      : null,
    consultation: conversation.consultation
      ? {
          id: conversation.consultation.id,
          category: conversation.consultation.category,
          status: conversation.consultation.status,
          priority: conversation.consultation.priority,
          summary: conversation.consultation.summary ?? null,
        }
      : null,
  }))

  const availableGroups = groups.map((group) => ({ id: group.id, name: group.name }))
  const availableWorkers = workers.map((worker) => ({
    id: worker.id,
    name: worker.name,
    email: worker.email,
    groupIds: worker.groupIds,
  }))

  return (
    <main className="flex min-h-[100dvh] flex-col bg-muted/20 lg:h-[100dvh]">
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
