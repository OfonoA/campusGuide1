import React, { useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import Header from './Header'
import { useAuth } from '../../contexts/AuthContext'

const Layout: React.FC = () => {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)
  const location = useLocation()
  const { user } = useAuth()

  const useStudentWorkspaceShell =
    user?.role === 'student' &&
    (location.pathname === '/app/chat' || location.pathname === '/app/tickets')
  const useStaffWorkspaceShell =
    user?.role === 'ar_staff' &&
    (location.pathname === '/app/staff-dashboard' || location.pathname === '/app/staff-chat')
  const useAdminWorkspaceShell =
    user?.role === 'admin' &&
    (
      location.pathname === '/app/admin/dashboard' ||
      location.pathname === '/app/admin/inbox' ||
      location.pathname === '/app/admin/chat' ||
      location.pathname === '/app/admin/users' ||
      location.pathname === '/app/admin/documents'
    )

  if (useStudentWorkspaceShell || useStaffWorkspaceShell || useAdminWorkspaceShell) {
    return (
      <div className="min-h-screen bg-[linear-gradient(180deg,#f8fbff_0%,#eef3fa_56%,#e7edf7_100%)]">
        <Outlet />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex bg-[linear-gradient(180deg,#f8fbff_0%,#eef3fa_56%,#e7edf7_100%)]">
      {mobileSidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-slate-950/40 backdrop-blur-sm lg:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}
      <Sidebar
        mobileOpen={mobileSidebarOpen}
        onNavigate={() => setMobileSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col">
        <Header onToggleSidebar={() => setMobileSidebarOpen((prev) => !prev)} />
        <main className="flex-1 overflow-auto p-3 sm:p-4 md:p-8">
          <div className="max-w-7xl mx-auto h-full">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

export default Layout
