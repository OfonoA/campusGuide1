import React from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import {
  LayoutDashboard,
  MessageSquare,
  Users,
  FileText,
  LogOut,
  GraduationCap,
  HelpCircle
} from 'lucide-react'

interface SidebarProps {
  mobileOpen?: boolean
  onNavigate?: () => void
}

const Sidebar: React.FC<SidebarProps> = ({ mobileOpen = false, onNavigate }) => {
  const { user, logout } = useAuth()
  const location = useLocation()

  const navigation = [
    { name: 'Chat', href: '/app/chat', icon: MessageSquare },
    { name: 'Tickets', href: '/app/tickets', icon: HelpCircle },
  ]

  if (user?.role === 'ar_staff') {
    navigation.splice(0, navigation.length,
      { name: 'Chat', href: '/app/staff-chat', icon: MessageSquare },
      { name: 'Assigned Tickets', href: '/app/staff-dashboard', icon: Users }
    )
  }

  if (user?.role === 'admin') {
    navigation.splice(0, navigation.length,
      { name: 'Dashboard', href: '/app/admin/dashboard', icon: LayoutDashboard },
      { name: 'Ticket Inbox', href: '/app/admin/inbox', icon: HelpCircle },
      { name: 'Users', href: '/app/admin/users', icon: Users },
      { name: 'Documents', href: '/app/admin/documents', icon: FileText }
    )
  }

  return (
    <div
      className={[
        "fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-white/10 bg-[linear-gradient(180deg,#17204d_0%,#24306d_50%,#1d2758_100%)] text-white shadow-[0_26px_70px_rgba(15,23,42,0.34)]",
        "transform transition-transform duration-200 ease-out lg:translate-x-0 lg:static lg:inset-auto",
        mobileOpen ? "translate-x-0" : "-translate-x-full",
      ].join(" ")}
    >
      <div className="border-b border-white/10 p-6">
        <div className="flex items-center space-x-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-[1.1rem] bg-white/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)] backdrop-blur">
            <GraduationCap className="h-6 w-6 text-accent-300" />
          </div>
          <div>
            <h1 className="font-serif text-xl font-semibold tracking-[-0.03em] text-white sm:text-2xl">ArASSIST</h1>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/58">MUST Academic Support</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-2 p-4">
        {navigation.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.href
          
          return (
            <NavLink
              key={item.name}
              to={item.href}
              onClick={onNavigate}
              className={`nav-pill flex items-center space-x-3 ${
                isActive
                  ? 'nav-pill-active'
                  : 'nav-pill-idle'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="font-medium">{item.name}</span>
            </NavLink>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">{user?.username}</p>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">{user?.role}</p>
            </div>
            <button
              onClick={() => {
                void logout()
                onNavigate?.()
              }}
              className="rounded-full p-2 text-white/55 transition-colors hover:bg-white/10 hover:text-white"
              title="Logout"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/6 px-3 py-3 text-xs text-white/68">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
              System online
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Sidebar
