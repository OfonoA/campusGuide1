import React, { createContext, useContext, useReducer, useEffect, useRef, useCallback } from 'react'
import { User, AuthState } from '../types'
import { authAPI } from '../services/api'
import { parseJwt } from '../utils/jwt'
import { queuePersistentFeedback } from '../utils/appFeedback'
import {
  clearAuthSession,
  getAuthToken,
  getRefreshToken,
  migrateLegacyAuthSession,
  setAuthSession,
} from '../utils/authStorage'

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  signup: (username: string, password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const normalizeRole = (role?: string): User['role'] => {
  if (!role) return 'student'
  if (role === 'staff' || role === 'ar') return 'ar_staff'
  if (role === 'ar_staff' || role === 'admin' || role === 'student') return role
  return 'student'
}

type AuthAction =
  | { type: 'LOGIN_START' }
  | { type: 'AUTH_SUCCESS'; payload: { user: User; token: string; refreshToken: string | null } }
  | { type: 'LOGIN_FAILURE' }
  | { type: 'LOGOUT' }
  | { type: 'SET_LOADING'; payload: boolean }

const authReducer = (state: AuthState, action: AuthAction): AuthState => {
  switch (action.type) {
    case 'LOGIN_START':
      return { ...state, isLoading: true }
    case 'AUTH_SUCCESS':
      return {
        ...state,
        user: action.payload.user,
        token: action.payload.token,
        refreshToken: action.payload.refreshToken,
        isAuthenticated: true,
        isLoading: false,
      }
    case 'LOGIN_FAILURE':
      return {
        ...state,
        user: null,
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      }
    case 'LOGOUT':
      return {
        ...state,
        user: null,
        token: null,
        refreshToken: null,
        isAuthenticated: false,
        isLoading: false,
      }
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload }
    default:
      return state
  }
}

const initialState: AuthState = {
  user: null,
  token: getAuthToken(),
  refreshToken: getRefreshToken(),
  isAuthenticated: false,
  isLoading: true,
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState)
  const refreshTimeoutRef = useRef<number | null>(null)

  const clearRefreshTimeout = useCallback(() => {
    if (refreshTimeoutRef.current !== null) {
      window.clearTimeout(refreshTimeoutRef.current)
      refreshTimeoutRef.current = null
    }
  }, [])

  const clearAuthState = useCallback((reason?: 'logout' | 'session_expired') => {
    clearRefreshTimeout()
    clearAuthSession()
    if (reason === 'logout') {
      queuePersistentFeedback({
        tone: 'info',
        title: 'Logout completed',
        message: 'You have been signed out successfully.',
      })
    }
    if (reason === 'session_expired') {
      queuePersistentFeedback({
        tone: 'error',
        title: 'Session expired',
        message: 'Your session ended. Sign in again to continue.',
      })
    }
    dispatch({ type: 'LOGOUT' })
  }, [clearRefreshTimeout, dispatch])

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken()
    try {
      if (refreshToken) {
        await authAPI.logout(refreshToken)
      }
    } catch (error) {
      console.error('Error logging out:', error)
    } finally {
      clearAuthState('logout')
    }
  }, [clearAuthState])

  const refreshAccessToken = useCallback(async () => {
    const refreshToken = getRefreshToken()
    if (!refreshToken) {
      clearAuthState('session_expired')
      return
    }

    try {
      const response = await authAPI.refresh(refreshToken)
      const token = response.token
      const nextRefreshToken = response.refresh_token || refreshToken

      if (!token) {
        throw new Error('Missing token in refresh response')
      }

      setAuthSession(token, nextRefreshToken)

      const payload = parseJwt(token)
      if (!payload) throw new Error('Invalid token payload')

      const user: User = {
        id: payload.user_id || 0,
        username: payload.username || payload.sub || 'user',
        role: normalizeRole(payload.role),
      }

      dispatch({
        type: 'AUTH_SUCCESS',
        payload: { user, token, refreshToken: nextRefreshToken },
      })
    } catch (error) {
      clearAuthState('session_expired')
    }
  }, [clearAuthState])

  const scheduleTokenRefresh = useCallback(
    (token?: string | null) => {
      clearRefreshTimeout()
      if (!token) return
      const payload = parseJwt(token)
      if (!payload?.exp) return

      const expiresAt = payload.exp * 1000
      const delay = expiresAt - Date.now() - 60_000

      if (delay <= 0) {
        void refreshAccessToken()
        return
      }

      refreshTimeoutRef.current = window.setTimeout(() => {
        void refreshAccessToken()
      }, delay)
    },
    [clearRefreshTimeout, refreshAccessToken]
  )

  useEffect(() => {
    scheduleTokenRefresh(state.token)
    return clearRefreshTimeout
  }, [state.token, scheduleTokenRefresh, clearRefreshTimeout])

  useEffect(() => {
    const initialize = async () => {
      migrateLegacyAuthSession()
      const token = getAuthToken()
      if (!token) {
        dispatch({ type: 'SET_LOADING', payload: false })
        return
      }

      try {
        await authAPI.checkAuth()
        const payload = parseJwt(token)
        if (!payload) throw new Error('Invalid token')

        const user: User = {
          id: payload.user_id || 0,
          username: payload.username || payload.sub || 'user',
          role: normalizeRole(payload.role),
        }

        dispatch({
          type: 'AUTH_SUCCESS',
          payload: { user, token, refreshToken: getRefreshToken() },
        })
      } catch (error) {
        const refreshToken = getRefreshToken()
        if (refreshToken) {
          await refreshAccessToken()
        } else {
          clearAuthState('session_expired')
        }
      } finally {
        dispatch({ type: 'SET_LOADING', payload: false })
      }
      }

      void initialize()
  }, [refreshAccessToken, clearAuthState, dispatch])

  const login = async (username: string, password: string) => {
    dispatch({ type: 'LOGIN_START' })
    try {
      const response = await authAPI.login(username, password)
      const token = response.token || response.access_token
      if (!token) {
        throw new Error('No token received from server')
      }
      const payload = parseJwt(token)
      if (!payload) throw new Error('Invalid token payload')

      const refreshToken = response.refresh_token || null
      const user: User = {
        id: payload.user_id || 0,
        username: payload.username || payload.sub || username,
        role: normalizeRole(payload.role),
      }

      setAuthSession(token, refreshToken)

      dispatch({
        type: 'AUTH_SUCCESS',
        payload: { user, token, refreshToken },
      })
    } catch (error) {
      dispatch({ type: 'LOGIN_FAILURE' })
      throw error
    }
  }

  const signup = async (username: string, password: string) => {
    dispatch({ type: 'LOGIN_START' })
    try {
      const response = await authAPI.signup(username, password)
      const token = response.token || response.access_token
      if (!token) throw new Error('No token received from server')
      const payload = parseJwt(token)
      if (!payload) throw new Error('Invalid token payload')

      const refreshToken = response.refresh_token || null
      const user: User = {
        id: payload.user_id || 0,
        username: payload.username || payload.sub || username,
        role: normalizeRole(payload.role),
      }

      setAuthSession(token, refreshToken)

      dispatch({
        type: 'AUTH_SUCCESS',
        payload: { user, token, refreshToken },
      })
    } catch (error) {
      dispatch({ type: 'LOGIN_FAILURE' })
      throw error
    }
  }

  return (
    <AuthContext.Provider value={{ ...state, login, logout, signup }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
