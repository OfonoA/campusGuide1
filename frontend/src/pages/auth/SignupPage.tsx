import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Eye, EyeOff, AlertCircle, ArrowRight, Lock, User, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import AuthShell from '../../components/auth/AuthShell'

const SignupPage: React.FC = () => {
  const [formData, setFormData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
  })
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  
  const { signup } = useAuth()
  const navigate = useNavigate()

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    setError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.username || !formData.password || !formData.confirmPassword) {
      setError('Please fill in all fields')
      return
    }
    
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }
    
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters')
      return
    }

    setIsLoading(true)
    try {
      await signup(formData.username, formData.password)
      navigate('/app/chat')
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Signup failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title="Create Account"
      subtitle="Set up your institutional support access and start using ArASSIST."
      footerPrompt={(
        <p className="text-sm text-[#333333]/70">
          Already have an account?{' '}
          <Link to="/login" className="font-semibold text-[#0A4B33] transition hover:text-[#D4AF37]">
            Sign In
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
          <label htmlFor="password" className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0A4B33]/72">
            Password
          </label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0A4B33]/60" />
            <input
              id="password"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={formData.password}
              onChange={handleChange}
              className="w-full rounded-[8px] border border-[#D4AF37]/25 bg-[#F8F8F8] py-3.5 pl-11 pr-14 text-base text-[#333333] outline-none transition focus:border-[#D4AF37] focus:ring-4 focus:ring-[#D4AF37]/15"
              placeholder="Create a secure password"
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
          <p className="text-xs text-[#333333]/65">Minimum 6 characters.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="confirmPassword" className="block text-[11px] font-semibold uppercase tracking-[0.2em] text-[#0A4B33]/72">
            Confirm Password
          </label>
          <div className="relative">
            <ShieldCheck className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#0A4B33]/60" />
            <input
              id="confirmPassword"
              name="confirmPassword"
              type={showConfirmPassword ? 'text' : 'password'}
              value={formData.confirmPassword}
              onChange={handleChange}
              className="w-full rounded-[8px] border border-[#D4AF37]/25 bg-[#F8F8F8] py-3.5 pl-11 pr-14 text-base text-[#333333] outline-none transition focus:border-[#D4AF37] focus:ring-4 focus:ring-[#D4AF37]/15"
              placeholder="Re-enter your password"
              disabled={isLoading}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-2 text-[#0A4B33]/55 transition hover:bg-[#FEF9E6] hover:text-[#0A4B33]"
              aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
            >
              {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="flex w-full items-center justify-center gap-2.5 rounded-[8px] border border-transparent bg-[#0A4B33] px-5 py-3.5 text-lg font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border-[#D4AF37] hover:bg-[#0D5C45] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isLoading ? 'Creating Account...' : 'Create Account'}
          {!isLoading && <ArrowRight className="h-5 w-5" />}
        </button>
      </form>
    </AuthShell>
  )
}

export default SignupPage
