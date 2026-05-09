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
  const { user, logout } = useAuth()
  const userInitial = user?.username?.charAt(0)?.toUpperCase()

  return (
    <div className="student-workspace h-screen overflow-hidden bg-[linear-gradient(180deg,#FEF9E6_0%,#F5F5F5_55%,#F0F2F5_100%)] text-[#333333]">
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <div className="flex h-full flex-col">
        <header className="border-b border-[#E6B422] bg-[#1E6B3B] px-5 py-3 text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] md:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button
                type="button"
                className="rounded-lg border border-[#E6B422] bg-white/10 p-2 text-[#FAFAFA] lg:hidden"
                onClick={() => setMobileSidebarOpen(true)}
                aria-label="Open menu"
              >
                <Menu className="h-4.5 w-4.5" />
              </button>
              <div className="flex items-center gap-6">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#FEF9E6]">Student workspace</p>
                  <p className="mt-1 text-xl font-semibold tracking-[-0.05em] text-white sm:text-2xl md:text-[2.2rem]">ArASSIST</p>
                  <p className="text-xs text-[#FEF9E6] sm:text-sm">Academic Support Assistant</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 sm:gap-4">
              <button className="rounded-full p-1.5 text-[#FEF9E6] transition hover:bg-white/10 hover:text-[#E6B422]">
                <Bell className="h-4.5 w-4.5" />
              </button>
              <button className="rounded-full p-1.5 text-[#FEF9E6] transition hover:bg-white/10 hover:text-[#E6B422]">
                <Settings className="h-4.5 w-4.5" />
              </button>
              <button
                onClick={() => {
                  void logout()
                }}
                className="rounded-lg border border-[#E6B422] px-3.5 py-1.5 text-sm font-semibold text-[#E6B422] transition hover:bg-[#E6B422] hover:text-[#1E6B3B]"
              >
                Logout
              </button>
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#E6B422] text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                {userInitial || <UserCircle2 className="h-5 w-5" />}
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
