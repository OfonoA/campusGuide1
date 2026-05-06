import React from 'react'
import { Search, Bell, Settings, Menu } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'

interface HeaderProps {
  onToggleSidebar?: () => void
}

const Header: React.FC<HeaderProps> = ({ onToggleSidebar }) => {
  const { user } = useAuth()

  return (
    <header className="border-b border-white/70 bg-white/68 backdrop-blur-xl shadow-[0_10px_36px_rgba(15,23,42,0.06)]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 md:gap-4 md:px-6">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 lg:hidden"
          aria-label="Open navigation"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="hidden min-w-[240px] max-w-xl flex-1 lg:block">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search tickets, staff, or accounts..."
              className="w-full rounded-2xl border border-white/80 bg-white/82 py-3 pl-10 pr-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] focus:border-primary-500 focus:outline-none focus:ring-4 focus:ring-primary-100"
            />
          </div>
        </div>

        <div className="ml-auto flex items-center space-x-2 md:space-x-4">
          <button className="relative rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <Bell className="h-5 w-5" />
            <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-accent-500"></span>
          </button>

          <button className="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600">
            <Settings className="h-5 w-5" />
          </button>

          <div className="flex items-center space-x-3 border-l border-slate-200 pl-2 md:pl-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-ink">{user?.username}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">{user?.role}</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-600 shadow-[0_12px_24px_rgba(44,52,143,0.22)]">
              <span className="text-white text-sm font-semibold">
                {user?.username?.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
