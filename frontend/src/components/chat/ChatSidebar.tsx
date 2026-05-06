import React, { useMemo, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Plus, MessageSquare, Search, Ticket, LogOut } from 'lucide-react'
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
  const { user, logout } = useAuth()
  const ticketAttentionCount = useTicketAttentionCount(user)
  const [searchTerm, setSearchTerm] = useState<string>("")

  return (
    <aside className="flex h-full w-full min-w-0 flex-col overflow-y-auto border-r border-white/10 bg-[linear-gradient(180deg,#17204d_0%,#24306d_50%,#1d2758_100%)] text-white shadow-[0_24px_70px_rgba(15,23,42,0.34)] md:h-full md:w-[340px]">
      <div className="px-4 py-4">
        <button
          onClick={onNewChat}
          className="flex w-full items-center justify-center gap-2 rounded-[1.35rem] bg-white px-4 py-3.5 text-base font-semibold text-primary-800 shadow-[0_18px_36px_rgba(15,23,42,0.24)] transition hover:bg-white/92"
        >
          <Plus className="h-4 w-4" />
          <span>New Chat</span>
        </button>
      </div>

      <div className="px-4 pb-4">
        <NavLink
          to="/app/tickets"
          className={({ isActive }) =>
            `nav-pill flex items-center justify-between gap-2 ${
              isActive
                ? 'nav-pill-active'
                : 'nav-pill-idle'
            }`
          }
        >
          <span className="flex items-center gap-2">
            <Ticket className="h-3.5 w-3.5" />
            <span>My Tickets</span>
          </span>
          {ticketAttentionCount > 0 ? (
            <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-accent-400 px-2 py-0.5 text-xs font-semibold text-accent-900">
              {ticketAttentionCount}
            </span>
          ) : null}
        </NavLink>
      </div>

      <div className="px-4 pb-4">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-white/38" />
          <input
            type="text"
            aria-label="Search conversations"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search conversations..."
            className="w-full rounded-[1.35rem] border border-white/10 bg-white/6 px-11 py-3 text-base text-white outline-none transition placeholder:text-white/40 focus:border-white/20 focus:ring-4 focus:ring-white/10"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-6">
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
                className={`w-full rounded-xl border px-4 py-4 text-left transition ${
                  activeChatId === chat.id
                    ? 'border-white/80 bg-white text-primary-800 shadow-[0_16px_34px_rgba(15,23,42,0.24)]'
                    : 'border-transparent bg-white/[0.03] text-white/75 hover:bg-white/10 hover:text-white'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                    activeChatId === chat.id ? 'bg-primary-50 text-primary-700' : 'text-white/40'
                  }`}>
                    <MessageSquare className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-base font-semibold ${
                      activeChatId === chat.id ? 'text-primary-700' : 'text-white/78'
                    }`}>
                      {chat.title}
                    </p>
                    {timeLabel ? (
                      <p className={`mt-1 text-xs ${activeChatId === chat.id ? 'text-slate-400' : 'text-white/42'}`}>{timeLabel}</p>
                    ) : null}
                  </div>
                </div>
              </button>
            )
          })}

          {chats.length === 0 && (
            <div className="px-4 py-4 text-center text-sm text-white/72">
              <MessageSquare className="mx-auto h-8 w-8 text-white/24" />
              <p className="mt-3 font-medium">No conversations yet</p>
              <p className="mt-1 text-xs text-white/42">Start a new chat to begin.</p>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-white/10 px-5 py-6">
        <button
          onClick={() => {
            void logout()
          }}
          className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.24em] text-white/68 transition hover:text-white"
        >
          <LogOut className="h-5 w-5" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  )
}

export default ChatSidebar
