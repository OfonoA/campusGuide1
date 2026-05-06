import { TicketMessage, User } from '../types'

type SeenMap = Record<string, string>

const buildStorageKey = (user: User) => `ticket-seen:${user.role}:${user.id}`

const readSeenMap = (user: User): SeenMap => {
  try {
    const raw = window.localStorage.getItem(buildStorageKey(user))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as SeenMap : {}
  } catch {
    return {}
  }
}

const writeSeenMap = (user: User, next: SeenMap) => {
  try {
    window.localStorage.setItem(buildStorageKey(user), JSON.stringify(next))
  } catch {
    // Ignore storage errors and keep the UI functional.
  }
}

export const getSeenTimestamp = (user: User, ticketId: number): string | null => {
  const seenMap = readSeenMap(user)
  return seenMap[String(ticketId)] || null
}

export const markTicketSeen = (user: User, ticketId: number, timestamp: string) => {
  if (!timestamp) return
  const seenMap = readSeenMap(user)
  const key = String(ticketId)
  const previous = seenMap[key]
  if (previous && new Date(previous).getTime() >= new Date(timestamp).getTime()) {
    return
  }
  seenMap[key] = timestamp
  writeSeenMap(user, seenMap)
}

export const markTicketSeenFromMessages = (user: User, ticketId: number, messages: TicketMessage[]) => {
  const latestTimestamp = messages
    .map((message) => message.created_at)
    .filter(Boolean)
    .sort()
    .slice(-1)[0]

  if (latestTimestamp) {
    markTicketSeen(user, ticketId, latestTimestamp)
  }
}
