import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Bell, FileDown, Settings, LogOut, Users, Inbox, Ticket, Menu, X } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTicketAttentionCount } from '../../hooks/useTicketAttentionCount'
import mustLogo from '../../../images/logo.png'

interface AdminShellProps {
  title: string
  subtitle: string
  children: React.ReactNode
  headerAction?: React.ReactNode
}

const AdminShell: React.FC<AdminShellProps> = ({ title, subtitle, children, headerAction }) => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const { user, logout } = useAuth()
  const ticketAttentionCount = useTicketAttentionCount(user)

  const sideLinks = [
    { label: 'Tickets', to: '/app/admin/inbox', icon: Ticket, badge: ticketAttentionCount },
    { label: 'Inbox', to: '/app/admin/chat', icon: Inbox },
    { label: 'Users', to: '/app/admin/users', icon: Users },
    { label: 'Documents', to: '/app/admin/documents', icon: FileDown },
  ]

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[linear-gradient(180deg,#f8fbff_0%,#eef3fa_56%,#e7edf7_100%)] text-slate-900">
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

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
                <p className="eyebrow-label">Administration workspace</p>
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
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-white shadow ring-1 ring-success-100">
              <img src={mustLogo} alt="MUST logo" className="h-7 w-7 object-contain" />
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[300px] shrink-0 transform flex-col border-r border-white/10 bg-[linear-gradient(180deg,#17204d_0%,#24306d_50%,#1d2758_100%)] text-white shadow-[0_24px_70px_rgba(15,23,42,0.34)] transition lg:static lg:z-auto lg:translate-x-0 ${
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-start justify-end px-4 py-4 lg:hidden">
            <button
              type="button"
              className="rounded-full bg-white/12 p-2 text-white shadow"
              onClick={() => setMobileSidebarOpen(false)}
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="border-b border-white/10 px-6 py-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/58">Control center</p>
            <p className="mt-2 max-w-[220px] text-sm leading-6 text-white/68">
              Monitor tickets, staff activity, and archival records from one place.
            </p>
            <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-200/85">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-300"></span>
              MUST system online
            </div>
          </div>

          <nav className="px-4 py-5">
            <div className="space-y-3">
              {sideLinks.map((link) => {
                const Icon = link.icon
                return (
                  <NavLink
                    key={link.label}
                    to={link.to}
                    onClick={() => setMobileSidebarOpen(false)}
                    className={({ isActive }) =>
                      `nav-pill flex items-center gap-3 text-sm ${
                        isActive
                          ? 'nav-pill-active'
                          : 'nav-pill-idle'
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" />
                    <span className="font-medium">{link.label}</span>
                    {link.badge ? (
                      <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full bg-accent-400 px-2 py-0.5 text-xs font-semibold text-accent-900">
                        {link.badge}
                      </span>
                    ) : null}
                  </NavLink>
                )
              })}
            </div>
          </nav>

          <div className="mt-auto px-4 pb-4">
            <div className="rounded-[1.4rem] border border-white/10 bg-white/6 p-4 backdrop-blur-sm">
              <div>
                <p className="text-sm font-semibold text-white">{user?.username}</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">{user?.role}</p>
              </div>
              <button
                onClick={() => {
                  void logout()
                }}
                className="mt-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.24em] text-white/68 transition hover:text-white"
              >
                <LogOut className="h-5 w-5" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-7">
            <div className="mx-auto max-w-[1120px]">
              <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="eyebrow-label">Administration</p>
                  <h1 className="display-title mt-3 text-slate-950">{title}</h1>
                  <p className="mt-2 text-base text-slate-600 sm:text-lg">{subtitle}</p>
                </div>
                {headerAction}
              </div>

              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default AdminShell
