import React, { useEffect, useState } from 'react'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, ArrowRight, Lock, User } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useAppFeedback } from '../../contexts/AppFeedbackContext'
import { parseJwt } from '../../utils/jwt'
import { getAuthToken } from '../../utils/authStorage'
import AuthShell from '../../components/auth/AuthShell'

const LoginPage: React.FC = () => {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  const { login, isAuthenticated, token } = useAuth()
  const { showError, showSuccess } = useAppFeedback()
  const navigate = useNavigate()
  const location = useLocation()
  
  const from = location.state?.from?.pathname || ''

  const normalizeRole = (role?: string) => {
    if (!role) return 'student'
    if (role === 'staff' || role === 'ar') return 'ar_staff'
    if (role === 'ar_staff' || role === 'admin' || role === 'student') return role
    return 'student'
  }

  const getRoleLanding = (token: string | null) => {
    const payload = token ? parseJwt(token) : null
    const role = normalizeRole(payload?.role)
    if (role === 'admin') return '/app/admin/inbox'
    if (role === 'ar_staff') return '/app/staff-dashboard'
    return '/app/chat'
  }

  useEffect(() => {
    if (!isAuthenticated) return
    const fallback = getRoleLanding(token || getAuthToken())
    const target = from || fallback
    navigate(target, { replace: true })
  }, [from, isAuthenticated, navigate, token])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.username || !formData.password) {
      setError('Please fill in all fields')
      return
    }

    setIsLoading(true)
    try {
      await login(formData.username, formData.password)
      showSuccess({
        title: 'Login successful',
        message: 'Welcome back. Redirecting you to your workspace.',
        duration: 2600,
      })
    } catch (err: any) {
      const status = err?.response?.status
      const detail = err?.response?.data?.detail
      if (status === 401) {
        const message = detail || 'Invalid username or password.'
        setError(message)
        showError({
          title: 'Login failed',
          message,
        })
      } else if (!err?.response) {
        const message = 'Unable to reach the server. Please check your internet connection and try again.'
        setError(message)
        showError({
          title: 'Login failed',
          message,
        })
      } else {
        const message = detail || 'Login failed. Please try again.'
        setError(message)
        showError({
          title: 'Login failed',
          message,
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title="Sign In"
      subtitle="Enter your credentials to access support."
      footerPrompt={(
        <p className="text-sm text-[#333333]/70">
          New to ArASSIST?{' '}
          <Link to="/signup" className="font-semibold text-[#0A4B33] transition hover:text-[#D4AF37]">
            Create Account
          </Link>
        </p>
      )}
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="username" className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0A4B33]/72">
            Username
          </label>
          <div className="relative">
            <User className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0A4B33]/60" />
            <input
              id="username"
              name="username"
              type="text"
              value={formData.username}
              onChange={handleChange}
              className="w-full rounded-[8px] border border-[#D4AF37]/25 bg-[#F8F8F8] py-3.5 pl-11 pr-4 text-base text-[#333333] outline-none transition focus:border-[#D4AF37] focus:ring-4 focus:ring-[#D4AF37]/15"
              placeholder="e.g. sarah.namara"
              disabled={isLoading}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="password" className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0A4B33]/72">
              Password
            </label>
            <a href="#" className="text-sm font-semibold text-[#0A4B33] transition hover:text-[#D4AF37]">
              Forgot Password?
            </a>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0A4B33]/60" />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange}
              className="w-full rounded-[8px] border border-[#D4AF37]/25 bg-[#F8F8F8] py-3.5 pl-11 pr-14 text-base text-[#333333] outline-none transition focus:border-[#D4AF37] focus:ring-4 focus:ring-[#D4AF37]/15"
              placeholder="Enter password"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#0A4B33]/55 transition hover:bg-[#FEF9E6] hover:text-[#0A4B33]"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <label className="flex items-center gap-3 text-sm text-[#333333]">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-[#D4AF37]/40 text-[#0A4B33] focus:ring-[#D4AF37]"
          />
          <span>Remember this device for 30 days</span>
        </label>

        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2.5 rounded-[8px] border border-transparent bg-[#0A4B33] px-5 py-3.5 text-lg font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border-[#D4AF37] hover:bg-[#0D5C45] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Signing In...' : 'Sign In'}
          {!isLoading && <ArrowRight className="h-5 w-5" />}
        </button>
      </form>
    </AuthShell>
  )
}

export default LoginPage
