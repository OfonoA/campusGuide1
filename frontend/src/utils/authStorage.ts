const AUTH_TOKEN_KEY = 'authToken'
const REFRESH_TOKEN_KEY = 'refreshToken'

const canUseBrowserStorage = () => typeof window !== 'undefined'

export const getAuthToken = () => {
  if (!canUseBrowserStorage()) return null
  return window.sessionStorage.getItem(AUTH_TOKEN_KEY)
}

export const getRefreshToken = () => {
  if (!canUseBrowserStorage()) return null
  return window.sessionStorage.getItem(REFRESH_TOKEN_KEY)
}

export const setAuthSession = (token: string, refreshToken?: string | null) => {
  if (!canUseBrowserStorage()) return
  window.sessionStorage.setItem(AUTH_TOKEN_KEY, token)
  if (refreshToken) {
    window.sessionStorage.setItem(REFRESH_TOKEN_KEY, refreshToken)
  } else {
    window.sessionStorage.removeItem(REFRESH_TOKEN_KEY)
  }
}

export const clearAuthSession = () => {
  if (!canUseBrowserStorage()) return
  window.sessionStorage.removeItem(AUTH_TOKEN_KEY)
  window.sessionStorage.removeItem(REFRESH_TOKEN_KEY)
}

export const migrateLegacyAuthSession = () => {
  if (!canUseBrowserStorage()) return

  const sessionToken = window.sessionStorage.getItem(AUTH_TOKEN_KEY)
  const sessionRefreshToken = window.sessionStorage.getItem(REFRESH_TOKEN_KEY)

  if (sessionToken || sessionRefreshToken) return

  const legacyToken = window.localStorage.getItem(AUTH_TOKEN_KEY)
  const legacyRefreshToken = window.localStorage.getItem(REFRESH_TOKEN_KEY)

  if (legacyToken) {
    window.sessionStorage.setItem(AUTH_TOKEN_KEY, legacyToken)
  }

  if (legacyRefreshToken) {
    window.sessionStorage.setItem(REFRESH_TOKEN_KEY, legacyRefreshToken)
  }

  if (legacyToken || legacyRefreshToken) {
    window.localStorage.removeItem(AUTH_TOKEN_KEY)
    window.localStorage.removeItem(REFRESH_TOKEN_KEY)
  }
}
