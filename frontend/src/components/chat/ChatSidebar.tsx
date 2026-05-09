import React, { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Plus, MessageSquare, Search, Ticket } from 'lucide-react'
import { Chat } from '../../types'
import { useAuth } from '../../contexts/AuthContext'
import { useTicketAttentionCount } from '../../hooks/useTicketAttentionCount'

interface ChatSidebarProps {
  chats: Chat[]
  activeChatId: number | null
  onChatSelect: (chatId: number) => void
  onNewChat: () => void
}

const ChatSidebar: React.FC<ChatSidebarProps> = ({
  chats,
  activeChatId,
  onChatSelect,
  onNewChat,
}) => {
  const { user } = useAuth()
  const ticketAttentionCount = useTicketAttentionCount(user)
  const [searchTerm, setSearchTerm] = useState<string>("")

  return (
    <aside className="chat-scroll-area flex h-full w-full min-w-0 flex-col overflow-y-auto border-r border-[#E6B422]/20 bg-[linear-gradient(180deg,#1E6B3B_0%,#185832_100%)] text-white shadow-[0_12px_30px_rgba(0,0,0,0.12)] md:h-full md:w-[340px]">
      <div className="px-4 py-4">
        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#E6B422]/35 bg-white/10 px-4 py-3.5 text-base font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:bg-white/14"
        >
          <Plus className="h-4 w-4 text-[#E6B422]" />
          <span>New Chat</span>
        </button>
      </div>

      <div className="px-4 pb-4">
        <NavLink
          to="/app/tickets"
          className={({ isActive }) =>
            `flex items-center justify-between gap-2 rounded-lg px-4 py-3 transition ${
              isActive
                ? 'bg-[#E6B422] text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
                : 'bg-white/10 text-white hover:bg-white/14'
            }`
          }
        >
          <span className="flex items-center gap-2">
            <Ticket className="h-3.5 w-3.5" />
            <span>My Tickets</span>
          </span>
          {ticketAttentionCount > 0 ? (
            <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-[#E6B422] px-2 py-0.5 text-xs font-semibold text-[#1E6B3B]">
              {ticketAttentionCount}
            </span>
          ) : null}
        </NavLink>
      </div>

      <div className="px-4 pb-4">
        <div className="rounded-lg border border-[#E6B422]/35 bg-white/10 p-3 shadow-[0_2px_6px_rgba(0,0,0,0.05)] backdrop-blur-sm">
          <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-[#FEF9E6]">
            Search chats
          </p>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#FEF9E6]" />
            <input
              type="text"
              aria-label="Search conversations"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search conversations..."
              className="w-full rounded-lg border border-[#E6B422]/40 bg-white/92 px-11 py-3 text-sm text-[#333333] outline-none transition placeholder:text-[#1E6B3B]/70 focus:border-[#E6B422] focus:ring-2 focus:ring-[#E6B422]/30"
            />
          </div>
        </div>
      </div>

      <div className="chat-scroll-area flex-1 overflow-y-auto px-4 pb-6">
        <div className="space-y-1.5">
          {useMemo(() => {
            const q = searchTerm.trim().toLowerCase()
            if (!q) return chats
            return chats.filter((chat) => {
              if (chat.title && chat.title.toLowerCase().includes(q)) return true
              for (const m of chat.messages || []) {
                if (m.content && m.content.toLowerCase().includes(q)) return true
              }
              return false
            })
          }, [chats, searchTerm]).map((chat) => {
            const createdAt = new Date(chat.created_at)
            const hasValidDate = !Number.isNaN(createdAt.getTime())
            const timeLabel = hasValidDate
              ? createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : ''

            return (
              <button
                key={chat.id}
                onClick={() => onChatSelect(chat.id)}
                className={`w-full rounded-lg border px-4 py-4 text-left transition ${
                  activeChatId === chat.id
                    ? 'border-l-4 border-l-[#E6B422] border-[#E6B422]/40 bg-[#FEF9E6] text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
                    : 'border-white/10 bg-white/8 text-white hover:bg-white/14'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                    activeChatId === chat.id ? 'bg-[#E6B422]/20 text-[#1E6B3B]' : 'text-[#E6B422]'
                  }`}>
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-base font-semibold ${
                      activeChatId === chat.id ? 'text-[#1E6B3B]' : 'text-white'
                    }`}>
                      {chat.title}
                    </p>
                    {timeLabel ? (
                      <p className={`mt-1 text-xs ${activeChatId === chat.id ? 'text-[#1E6B3B]/70' : 'text-white/70'}`}>{timeLabel}</p>
                    ) : null}
                  </div>
                </div>
              </button>
            )
          })}

          {chats.length === 0 && (
            <div className="px-4 py-4 text-center text-sm text-white/78">
              <MessageSquare className="mx-auto h-8 w-8 text-[#E6B422]/40" />
              <p className="mt-3 font-medium">No conversations yet</p>
              <p className="mt-1 text-xs text-white/58">Start a new chat to begin.</p>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}

export default ChatSidebar
