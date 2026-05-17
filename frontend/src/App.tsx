import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { AppFeedbackProvider } from './contexts/AppFeedbackContext'
import { ThemeProvider } from './contexts/ThemeContext'
import ProtectedRoute from './components/auth/ProtectedRoute'
import Layout from './components/layout/Layout'
import RoleRoute from './components/auth/RoleRoute'
import { useAuth } from './contexts/AuthContext'

// Pages
const LoginPage = lazy(() => import('./pages/auth/LoginPage'))
const SignupPage = lazy(() => import('./pages/auth/SignupPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const StaffDashboardPage = lazy(() => import('./pages/StaffDashboardPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const TicketsPage = lazy(() => import('./pages/TicketsPage'))
const AdminInboxPage = lazy(() => import('./pages/admin/AdminInboxPage'))
const AdminChatPage = lazy(() => import('./pages/admin/AdminChatPage'))
const AdminUsersPage = lazy(() => import('./pages/admin/AdminUsersPage'))
const AdminDocumentsPage = lazy(() => import('./pages/admin/AdminDocumentsPage'))
const AdminAnalyticsPage = lazy(() => import('./pages/admin/AdminAnalyticsPage'))
const AdminPerformancePage = lazy(() => import('./pages/admin/AdminPerformancePage'))

const RouteFallback = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
  </div>
)

const AppIndexRedirect = () => {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return <RouteFallback />
  }

  if (user?.role === 'admin') {
    return <Navigate to="/app/admin/inbox" replace />
  }

  if (user?.role === 'ar_staff') {
    return <Navigate to="/app/staff-dashboard" replace />
  }

  return <Navigate to="/app/chat" replace />
}

function App() {
  return (
    <ThemeProvider>
      <AppFeedbackProvider>
        <AuthProvider>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
            {/* Public routes */}
            <Route path="/" element={<LoginPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            
            {/* Protected routes */}
            <Route path="/app" element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }>
              <Route index element={<AppIndexRedirect />} />
              <Route path="chat" element={<RoleRoute role="student"><ChatPage /></RoleRoute>} />
              <Route path="tickets" element={<RoleRoute role="student"><TicketsPage /></RoleRoute>} />

              <Route path="staff-dashboard" element={<RoleRoute role="ar_staff"><StaffDashboardPage /></RoleRoute>} />
              <Route path="staff-chat" element={<RoleRoute role="ar_staff"><StaffDashboardPage /></RoleRoute>} />

              <Route path="admin" element={<RoleRoute role="admin"><Navigate to="/app/admin/inbox" replace /></RoleRoute>} />
              <Route path="admin/dashboard" element={<RoleRoute role="admin"><DashboardPage /></RoleRoute>} />
              <Route path="admin/inbox" element={<RoleRoute role="admin"><AdminInboxPage /></RoleRoute>} />
              <Route path="admin/chat" element={<RoleRoute role="admin"><AdminChatPage /></RoleRoute>} />
              <Route path="admin/users" element={<RoleRoute role="admin"><AdminUsersPage /></RoleRoute>} />
              <Route path="admin/documents" element={<RoleRoute role="admin"><AdminDocumentsPage /></RoleRoute>} />
              <Route path="admin/analytics" element={<RoleRoute role="admin"><AdminAnalyticsPage /></RoleRoute>} />
              <Route path="admin/performance" element={<RoleRoute role="admin"><AdminPerformancePage /></RoleRoute>} />
            </Route>
            
            {/* Fallback - redirect to login */}
            <Route path="*" element={<Navigate to="/login" replace />} />
            </Routes>
          </Suspense>
        </AuthProvider>
      </AppFeedbackProvider>
    </ThemeProvider>
  )
}

export default App
