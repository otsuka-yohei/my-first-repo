/**
 * 会話リストアイテムコンポーネント
 */

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import type { ConversationSummary, ConversationTag } from "./types"
import { getInitials, formatRelativeTime } from "./utils"

export type ConversationListItemProps = {
  conversation: ConversationSummary
  tags: ConversationTag[]
  isOnline: boolean
}

export function ConversationListItem({ conversation, tags, isOnline }: ConversationListItemProps) {
  return (
    <div className="flex items-start gap-3">
      <Avatar className="h-10 w-10">
        <AvatarFallback>{getInitials(conversation.worker?.name)}</AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{conversation.worker?.name ?? "相談"}</p>
            <p className="mt-1 line-clamp-1 text-xs text-muted-foreground break-words">
              {conversation.lastMessage?.body ?? "まだメッセージがありません"}
            </p>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatRelativeTime(conversation.updatedAt)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              isOnline ? "bg-emerald-500" : "bg-slate-300"
            }`}
            aria-hidden
          />
          <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <Badge
                key={tag.id}
                variant={tag.tone === "urgent" ? "destructive" : "secondary"}
                className={
                  tag.tone === "urgent"
                    ? "bg-[#FF4D4F] text-white"
                    : "bg-slate-100 text-slate-700"
                }
              >
                {tag.label}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
