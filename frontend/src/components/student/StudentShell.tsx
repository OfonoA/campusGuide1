import React, { useState } from 'react'
import { Bell, Menu, Settings, UserCircle2, X } from 'lucide-react'
import { Chat } from '../../types'
import ChatSidebar from '../chat/ChatSidebar'
import { useAuth } from '../../contexts/AuthContext'

interface StudentShellProps {
  chats: Chat[]
  activeChatId?: number | null
  onChatSelect: (chatId: number) => void | Promise<void>
  onNewChat: () => void | Promise<void>
  children: React.ReactNode
}

const StudentShell: React.FC<StudentShellProps> = ({
  chats,
  activeChatId = null,
  onChatSelect,
  onNewChat,
  children,
}) => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const { user } = useAuth()
  const userInitial = user?.username?.charAt(0)?.toUpperCase()

  return (
    <div className="h-screen overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef3fa_56%,#e7edf7_100%)] text-slate-900">
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <div className="flex h-full flex-col">
        <header className="border-b border-white/65 bg-white/72 px-5 py-4 backdrop-blur-xl shadow-[0_10px_36px_rgba(15,23,42,0.06)] md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <button
                type="button"
                className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm lg:hidden"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="flex items-center gap-8">
                <div>
                  <p className="eyebrow-label">Student workspace</p>
                  <p className="mt-2 font-serif text-2xl font-semibold tracking-[-0.05em] text-primary-700 sm:text-3xl md:text-[2.7rem]">ArASSIST</p>
                  <p className="text-sm text-slate-500">Academic Support Assistant</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-5">
              <button className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-primary-700">
                <Bell className="h-5 w-5" />
              </button>
              <button className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-primary-700">
                <Settings className="h-5 w-5" />
              </button>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-700 text-white shadow-[0_14px_28px_rgba(44,52,143,0.22)]">
                {userInitial || <UserCircle2 className="h-6 w-6" />}
              </div>
            </div>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
        <div className={`fixed inset-y-0 left-0 z-50 w-[320px] transform transition lg:static lg:z-auto lg:h-full lg:translate-x-0 ${
          mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}>
          <div className="absolute right-4 top-4 lg:hidden">
            <button
              type="button"
              className="rounded-full bg-white/12 p-2 text-white shadow"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <ChatSidebar
            chats={chats}
            activeChatId={activeChatId}
            onChatSelect={async (chatId) => {
              setMobileSidebarOpen(false)
              await onChatSelect(chatId)
            }}
            onNewChat={() => {
              setMobileSidebarOpen(false)
              void onNewChat()
            }}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <main className="min-h-0 flex-1 overflow-hidden">
            {children}
          </main>
        </div>
        </div>
      </div>
    </div>
  )
}

export default StudentShell
