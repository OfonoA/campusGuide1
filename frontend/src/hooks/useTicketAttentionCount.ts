import { useEffect, useMemo, useState } from 'react'
import { adminAPI, arAPI, ticketsAPI } from '../services/api'
import { Ticket, TicketMessage, User } from '../types'
import { getSeenTimestamp } from '../utils/ticketAttention'

const POLL_MS = 30000

const isActiveTicket = (status: Ticket['status']) => !['resolved', 'closed'].includes(status)

const hasNewerIncomingMessage = (
  messages: TicketMessage[],
  seenTimestamp: string | null,
  incomingRole: TicketMessage['sender_role'],
) => {
  const latestIncoming = messages
    .filter((message) => message.sender_role === incomingRole)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .slice(-1)[0]

  if (!latestIncoming?.created_at) return false
  if (!seenTimestamp) return true
  return new Date(latestIncoming.created_at).getTime() > new Date(seenTimestamp).getTime()
}

export const useTicketAttentionCount = (user: User | null) => {
  const [count, setCount] = useState(0)

  const role = user?.role
  const userId = user?.id

  useEffect(() => {
    if (!user || !role || !userId) {
      setCount(0)
      return
    }

    let cancelled = false

    const loadAttentionCount = async () => {
      try {
        if (role === 'admin') {
          const tickets = await adminAPI.getTickets()
          if (!cancelled) {
            setCount(tickets.filter((ticket) => ticket.status === 'open').length)
          }
          return
        }

        const tickets = role === 'ar_staff'
          ? await arAPI.getAssignedTickets()
          : await ticketsAPI.getTickets()

        const activeTickets = tickets.filter((ticket) => isActiveTicket(ticket.status))
        if (activeTickets.length === 0) {
          if (!cancelled) setCount(0)
          return
        }

        const perTicketAttention = await Promise.all(
          activeTickets.map(async (ticket) => {
            if (role === 'ar_staff' && ticket.status === 'assigned') {
              return true
            }

            const seenTimestamp = getSeenTimestamp(user, ticket.id)
            const messages = role === 'ar_staff'
              ? await arAPI.getTicketConversation(ticket.id)
              : await ticketsAPI.getTicketMessages(ticket.id)

            return role === 'ar_staff'
              ? hasNewerIncomingMessage(messages, seenTimestamp, 'student')
              : hasNewerIncomingMessage(messages, seenTimestamp, 'ar_staff')
          })
        )

        if (!cancelled) {
          setCount(perTicketAttention.filter(Boolean).length)
        }
      } catch (error) {
        if (!cancelled) {
          setCount(0)
        }
      }
    }

    void loadAttentionCount()
    const intervalId = window.setInterval(() => {
      void loadAttentionCount()
    }, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [role, user, userId])

  return useMemo(() => count, [count])
}
