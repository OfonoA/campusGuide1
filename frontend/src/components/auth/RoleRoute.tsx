import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { queuePersistentFeedback } from '../../utils/appFeedback'

interface RoleRouteProps {
  role: 'student' | 'ar_staff' | 'admin'
  children: React.ReactNode
}

const RoleRoute: React.FC<RoleRouteProps> = ({ role, children }) => {
  const { user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (user.role !== role) {
    const destination =
      user.role === 'admin'
        ? '/app/admin/inbox'
        : user.role === 'ar_staff'
          ? '/app/staff-dashboard'
          : '/app/chat'

    queuePersistentFeedback({
      tone: 'info',
      title: 'Access limited',
      message: 'That page is restricted for your account. You were redirected to an allowed page.',
    })

    return <Navigate to={destination} replace />
  }

  return <>{children}</>
}

export default RoleRoute
