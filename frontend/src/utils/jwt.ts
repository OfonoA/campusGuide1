export function parseJwt(token: string): any {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null

    // JWT payload uses base64url, not standard base64.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    return JSON.parse(atob(padded))
  } catch {
    return null
  }
}
