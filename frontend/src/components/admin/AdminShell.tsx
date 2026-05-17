import React, { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { Bell, FileDown, Settings, LogOut, Users, Inbox, Ticket, Menu, X, BarChart3 } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useTicketAttentionCount } from '../../hooks/useTicketAttentionCount'
import mustLogo from '../../../images/logo.png'

interface AdminShellProps {
  title: string
  subtitle: string
  children: React.ReactNode
  headerAction?: React.ReactNode
  titleIcon?: React.ReactNode
  theme?: 'admin' | 'staff'
  workspaceLabel?: string
  hidePageHeader?: boolean
  fullWidth?: boolean
}

const AdminShell: React.FC<AdminShellProps> = ({
  title,
  subtitle,
  children,
  headerAction,
  titleIcon,
  theme = 'admin',
  workspaceLabel,
  hidePageHeader = false,
  fullWidth = false,
}) => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const { user, logout } = useAuth()
  const ticketAttentionCount = useTicketAttentionCount(user)
  const isStaffTheme = theme === 'staff'

  const palette = isStaffTheme
    ? {
        headerBg: '#1E6B3B',
        headerBorder: '#D4AF37',
        badgeText: '#1E6B3B',
        hoverAccent: '#D4AF37',
        asideBg: '#1E6B3B',
        asideBorder: '#D4AF37',
        titleColor: '#1E6B3B',
        badgeBg: '#D4AF37',
        statusDot: '#1E6B3B',
        subtitleTag: 'Staff workspace',
      }
    : {
        headerBg: '#1E6B3B',
        headerBorder: '#B8860B',
        badgeText: '#1E6B3B',
        hoverAccent: '#B8860B',
        asideBg: '#1E6B3B',
        asideBorder: '#B8860B',
        titleColor: '#1E6B3B',
        badgeBg: '#B8860B',
        statusDot: '#1E6B3B',
        subtitleTag: 'Admin',
      }

  const resolvedWorkspaceLabel = workspaceLabel || (isStaffTheme ? 'Staff workspace' : 'Administration')
  const resolvedHeaderBadgeLabel = workspaceLabel || palette.subtitleTag

  const sideLinks = [
    { label: 'Tickets', to: '/app/admin/inbox', icon: Ticket, badge: ticketAttentionCount },
    { label: 'Inbox', to: '/app/admin/chat', icon: Inbox },
    { label: 'Users', to: '/app/admin/users', icon: Users },
    { label: 'Documents', to: '/app/admin/documents', icon: FileDown },
    { label: 'Performance', to: '/app/admin/performance', icon: BarChart3 },
    { label: 'Analytics', to: '/app/admin/analytics', icon: BarChart3 },
  ]

  return (
    <div className="admin-workspace flex h-screen flex-col overflow-hidden bg-[linear-gradient(180deg,#FEF9E6_0%,#F5F5F5_55%,#F0F2F5_100%)] text-[#333333]">
      {mobileSidebarOpen && (
        <button
          type="button"
          aria-label="Close navigation"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <header className="border-b-4 px-5 py-3 text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] md:px-8" style={{ borderBottomColor: palette.headerBorder, backgroundColor: palette.headerBg }}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="rounded-lg border border-white/20 bg-white/10 p-2 text-white lg:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open menu"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
            <div className="flex items-center gap-6">
              <div>
                <div className="inline-flex rounded-full bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: palette.badgeText }}>
                  {resolvedHeaderBadgeLabel}
                </div>
                <p className="mt-1 text-xl font-semibold tracking-[-0.05em] text-white sm:text-2xl md:text-[2.2rem]">ArASSIST</p>
                <p className="text-xs text-[#F0F2F5] sm:text-sm">Academic Support Assistant</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button className="rounded-full p-1.5 text-white transition hover:bg-white/10" style={{ ['--tw-text-opacity' as any]: 1 }}>
              <Bell className="h-4.5 w-4.5" />
            </button>
            <button className="rounded-full p-1.5 text-white transition hover:bg-white/10">
              <Settings className="h-4.5 w-4.5" />
            </button>
            <button
              onClick={() => {
                void logout()
              }}
              className="rounded-lg border px-3.5 py-1.5 text-sm font-semibold transition"
              style={{ borderColor: palette.headerBorder, color: palette.headerBorder }}
            >
              Logout
            </button>
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] ring-1 ring-white/20">
              <img src={mustLogo} alt="MUST logo" className="h-6 w-6 object-contain" />
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[300px] shrink-0 transform flex-col text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition lg:static lg:z-auto lg:translate-x-0 ${
            mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ borderRight: `1px solid ${palette.asideBorder}33`, backgroundColor: palette.asideBg }}
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
            <div className="mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-white">
              <span className="inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette.statusDot }}></span>
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
                      <span className="ml-auto inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold text-[#333333]" style={{ backgroundColor: palette.badgeBg }}>
                        {link.badge}
                      </span>
                    ) : null}
                  </NavLink>
                )
              })}
            </div>
          </nav>

          <div className="mt-auto px-4 pb-4">
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div>
                <p className="text-sm font-semibold text-white">{user?.username}</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">{user?.role}</p>
              </div>
              <div className="mt-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.24em] text-white/68">
                <LogOut className="h-5 w-5" />
                <span>Session active</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-h-0 flex-1 overflow-y-auto px-5 py-6 md:px-8 md:py-7">
            <div className={fullWidth ? '' : 'mx-auto max-w-[1120px]'}>
              {!hidePageHeader ? (
                <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
                  <div className="page-title-container">
                    <p className="eyebrow-label" style={{ color: palette.titleColor }}>{resolvedWorkspaceLabel}</p>
                    <h1 className="page-title mt-3">
                      {titleIcon ? <span className="page-title-icon">{titleIcon}</span> : null}
                      <span>{title}</span>
                    </h1>
                    <p className="page-subtitle">{subtitle}</p>
                  </div>
                  {headerAction}
                </div>
              ) : null}
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}

export default AdminShell
