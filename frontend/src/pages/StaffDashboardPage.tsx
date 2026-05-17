import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  Bell,
  ClipboardCheck,
  LogOut,
  Menu,
  MessageSquare,
  PanelLeftOpen,
  Search,
  Settings,
  ShieldCheck,
  Ticket,
  X,
} from 'lucide-react'
import { arAPI, chatAPI, ticketsAPI } from '../services/api'
import ChatInput from '../components/chat/ChatInput'
import AttachmentList from '../components/chat/AttachmentList'
import FeedbackToastStack from '../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../hooks/useFeedbackToasts'
import { Chat, ChatMessage, Ticket as TicketType, TicketMessage } from '../types'
import { shortTicketReference } from '../utils/tickets'
import { useAuth } from '../contexts/AuthContext'
import { getSeenTimestamp, markTicketSeenFromMessages } from '../utils/ticketAttention'
import { getErrorDetail } from '../utils/errors'
import mustLogo from '../../images/logo.png'

type StatusFilter = 'assigned' | 'in_progress' | 'resolved'

const navCardClass = 'rounded-[8px] border bg-[#F8F8F8] px-4 py-3.5 text-left transition shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
const mobileSheetClass = 'fixed inset-x-0 bottom-0 z-50 max-h-[78vh] overflow-y-auto border-t border-slate-200 bg-white px-4 py-4 shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition xl:static xl:max-h-none xl:border-l xl:border-t-0 xl:px-4 xl:py-4 xl:shadow-none xl:w-auto xl:max-w-none'

const formatAssignmentArea = (area?: string | null) => {
  if (!area) return 'General'
  if (area === 'admissions_records_alumni_engagement') return 'Admissions, Records & Alumni Engagement'
  return area
    .split('_')
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(' ')
}

const formatAssignmentAreas = (areas?: string[]) =>
  Array.isArray(areas) && areas.length > 0
    ? areas.map((area) => formatAssignmentArea(area)).join(', ')
    : 'General'

const StaffDashboardPage: React.FC = () => {
  const [tickets, setTickets] = useState<TicketType[]>([])
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null)
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isResolving, setIsResolving] = useState(false)
  const [resolutionSummary, setResolutionSummary] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('assigned')
  const [searchTerm, setSearchTerm] = useState('')
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [workflowOpen, setWorkflowOpen] = useState(false)
  const [isCompactTicketLayout, setIsCompactTicketLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 1280 : false
  )
  const [inboxChats, setInboxChats] = useState<Chat[]>([])
  const [selectedInboxChat, setSelectedInboxChat] = useState<Chat | null>(null)
  const [inboxLoading, setInboxLoading] = useState(false)
  const [inboxSending, setInboxSending] = useState(false)
  const [retryInboxMessage, setRetryInboxMessage] = useState<{ content: string; files: File[] } | null>(null)
  const [isRefreshingTicketList, setIsRefreshingTicketList] = useState(false)
  const [ticketsWithNewReply, setTicketsWithNewReply] = useState<number[]>([])
  const [checklist, setChecklist] = useState({
    verifiedIdentity: false,
    crossCheckedRecords: false,
    departmentalApproval: false,
  })
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()

  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const workflowRef = useRef<HTMLDivElement | null>(null)
  const latestStudentReplyAtRef = useRef<string | null>(null)
  const isInboxView = location.pathname === '/app/staff-chat'

  useEffect(() => {
    const updateLayoutMode = () => {
      setIsCompactTicketLayout(window.innerWidth < 1280)
    }

    updateLayoutMode()
    window.addEventListener('resize', updateLayoutMode)
    return () => window.removeEventListener('resize', updateLayoutMode)
  }, [])

  useEffect(() => {
    if (isInboxView) {
      void loadInboxChats()
    } else {
      void loadTickets()
    }
  }, [isInboxView])

  const loadTickets = async (
    preferredStatus: StatusFilter = statusFilter,
    preferredTicketId?: number,
    background = false,
  ) => {
    if (background) {
      setIsRefreshingTicketList(true)
    } else {
      setIsLoading(true)
    }
    try {
      const data = await arAPI.getAssignedTickets()
      setTickets(data)
      await refreshTicketReplyIndicators(data)

      const preferred =
        data.find((ticket) => preferredTicketId != null && ticket.id === preferredTicketId) ||
        data.find((ticket) => ticket.status === preferredStatus) ||
        data[0] ||
        null

      const shouldOpenDetail = !isCompactTicketLayout || preferredTicketId != null
      setSelectedTicket(shouldOpenDetail ? preferred : null)
      if (shouldOpenDetail && preferred) {
        await loadMessages(preferred.id)
      } else {
        setMessages([])
      }
    } catch (error) {
      console.error('Error loading tickets:', error)
    } finally {
      setIsLoading(false)
      setIsRefreshingTicketList(false)
    }
  }

  const refreshTicketReplyIndicators = async (ticketList: TicketType[]) => {
    if (!user) {
      setTicketsWithNewReply([])
      return
    }

    const activeTickets = ticketList.filter((ticket) => ['assigned', 'in_progress'].includes(ticket.status))
    if (activeTickets.length === 0) {
      setTicketsWithNewReply([])
      return
    }

    try {
      const replyFlags = await Promise.all(
        activeTickets.map(async (ticket) => {
          const messages = await arAPI.getTicketConversation(ticket.id)
          const seenTimestamp = getSeenTimestamp(user, ticket.id)
          const latestStudentReply = messages
            .filter((message: TicketMessage) => message.sender_role === 'student')
            .sort((a: TicketMessage, b: TicketMessage) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            .slice(-1)[0]

          if (!latestStudentReply?.created_at) return null
          if (!seenTimestamp) return ticket.id

          return new Date(latestStudentReply.created_at).getTime() > new Date(seenTimestamp).getTime()
            ? ticket.id
            : null
        })
      )

      setTicketsWithNewReply(replyFlags.filter((ticketId): ticketId is number => ticketId !== null))
    } catch (error) {
      console.error('Error loading ticket reply indicators:', error)
      setTicketsWithNewReply([])
    }
  }

  const loadInboxChats = async () => {
    setInboxLoading(true)
    try {
      const fetchedChats = await chatAPI.getChats()
      const normalized = fetchedChats.map((chat) => ({
        ...chat,
        title: chat.title || `Conversation ${chat.id}`,
        messages: chat.messages || [],
      }))
      setInboxChats(normalized)

      const preferred = normalized[0] || null
      setSelectedInboxChat(preferred)

      if (preferred && preferred.id > 0) {
        const messages = await chatAPI.getChatMessages(preferred.id)
        const hydrated = { ...preferred, messages }
        setInboxChats((prev) => prev.map((chat) => (chat.id === preferred.id ? hydrated : chat)))
        setSelectedInboxChat(hydrated)
      }
    } catch (error) {
      console.error('Error loading inbox chats:', error)
    } finally {
      setInboxLoading(false)
    }
  }

  const loadMessages = async (ticketId: number) => {
    try {
      const data = await arAPI.getTicketConversation(ticketId)
      setMessages(data)
      const latestStudentReply = data
        .filter((message: TicketMessage) => message.sender_role === 'student' && message.created_at)
        .sort((a: TicketMessage, b: TicketMessage) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-1)[0]
      latestStudentReplyAtRef.current = latestStudentReply?.created_at || null
      if (user) {
        markTicketSeenFromMessages(user, ticketId, data)
        setTicketsWithNewReply((prev) => prev.filter((id) => id !== ticketId))
      }
    } catch (error) {
      console.error('Error loading messages:', error)
    }
  }

  const handleSelectTicket = async (ticket: TicketType) => {
    setSelectedTicket(ticket)
    await loadMessages(ticket.id)
  }

  const handleBackToTicketList = () => {
    setSelectedTicket(null)
    setMessages([])
    setWorkflowOpen(false)
  }

  const handleSendMessage = async (content: string, files: File[] = []) => {
    if (!selectedTicket) return
    if (selectedTicket.status === 'resolved') {
      showInfo({
        title: 'Ticket already resolved',
        message: 'Resolved tickets can no longer receive new officer replies.',
      })
      return
    }

    setIsSending(true)
    try {
      const wasAssigned = selectedTicket.status === 'assigned'
      const nextStatus = wasAssigned ? 'in_progress' : statusFilter
      await ticketsAPI.addTicketMessage(selectedTicket.id, content, files)
      if (wasAssigned) {
        setStatusFilter('in_progress')
      }
      await loadTickets(nextStatus, selectedTicket.id, true)
      showSuccess(
        wasAssigned
          ? {
              title: 'Reply sent',
              message: 'Your first officer reply was delivered and the ticket moved to in progress.',
            }
          : {
              title: 'Reply sent',
              message: files.length > 0
                ? 'Your message and attachments were added to the student support thread.'
                : 'Your message was added to the student support thread.',
            }
      )
    } catch (error) {
      console.error('Error sending message:', error)
      showError({
        title: 'Reply failed',
        message: getErrorDetail(error, 'The message could not be sent to the ticket thread.'),
      })
    } finally {
      setIsSending(false)
    }
  }

  const handleSelectInboxChat = async (chat: Chat) => {
    setSelectedInboxChat(chat)
    if (chat.messages.length > 0 || chat.id <= 0) return

    try {
      const messages = await chatAPI.getChatMessages(chat.id)
      const hydrated = { ...chat, messages }
      setInboxChats((prev) => prev.map((item) => (item.id === chat.id ? hydrated : item)))
      setSelectedInboxChat(hydrated)
    } catch (error) {
      console.error('Error loading inbox chat messages:', error)
    }
  }

  const withAttachmentNote = (content: string, files?: File[]) => {
    const usableFiles = (files || []).filter((file) => file instanceof File)
    if (usableFiles.length === 0) return content
    return `${content}\n\n[Attached files: ${usableFiles.map((file) => file.name).join(', ')}]`
  }

  const handleSendInboxComposer = async (draft?: string, files: File[] = []) => {
    if (!selectedInboxChat) return

    const content = (draft ?? newMessage).trim() || (files.length > 0 ? 'Please review the attached files.' : '')
    if (!content) return
    const displayContent = withAttachmentNote(content, files)
    const optimisticMessage: ChatMessage = {
      id: Date.now(),
      sender: 'user',
      content: displayContent,
      created_at: new Date().toISOString(),
    }

    const optimisticChat = {
      ...selectedInboxChat,
      messages: [...selectedInboxChat.messages, optimisticMessage],
    }

    setSelectedInboxChat(optimisticChat)
    setInboxChats((prev) => prev.map((chat) => (chat.id === optimisticChat.id ? optimisticChat : chat)))
    setNewMessage('')
    setInboxSending(true)

    try {
      const historyPairs: [string, string][] = []
      for (let i = 0; i < selectedInboxChat.messages.length - 1; i++) {
        const a = selectedInboxChat.messages[i]
        const b = selectedInboxChat.messages[i + 1]
        if (a.sender === 'user' && b.sender === 'bot') {
          historyPairs.push([a.content, b.content])
        }
      }

      const response = await chatAPI.sendMessage(
        content,
        selectedInboxChat.id > 0 ? selectedInboxChat.id : undefined,
        historyPairs,
        files
      )

      const refreshedMessages = await chatAPI.getChatMessages(response.chat_id || selectedInboxChat.id)
      const refreshedChat: Chat = {
        ...optimisticChat,
        id: response.chat_id || optimisticChat.id,
        title: optimisticChat.title || content.slice(0, 50),
        messages: refreshedMessages,
      }

      setSelectedInboxChat(refreshedChat)
      setInboxChats((prev) => {
        const exists = prev.some((chat) => chat.id === refreshedChat.id)
        if (exists) {
          return prev.map((chat) => (chat.id === refreshedChat.id ? refreshedChat : chat))
        }
        return [refreshedChat, ...prev]
      })
      setRetryInboxMessage(null)
      showSuccess({
        title: 'Message sent',
        message: files.length > 0 ? 'Your inbox message and attachments were delivered.' : 'Your inbox message was delivered.',
      })
    } catch (error) {
      console.error('Error sending inbox message:', error)
      setRetryInboxMessage({ content, files })
      showError({
        title: 'Message failed',
        message: getErrorDetail(error, 'The inbox message could not be sent.'),
      })
    } finally {
      setInboxSending(false)
    }
  }

  const handleNewInboxChat = () => {
    setSelectedInboxChat({
      id: 0,
      title: 'New Inquiry',
      created_at: new Date().toISOString(),
      messages: [],
    })
    setNewMessage('')
  }

  const handleResolve = async () => {
    console.info('[resolve] click', {
      ticketId: selectedTicket?.id ?? null,
      status: selectedTicket?.status ?? null,
      summaryLength: resolutionSummary.trim().length,
    })
    if (!selectedTicket) {
      console.warn('[resolve] aborted: no selected ticket')
      return
    }
    if (selectedTicket.status !== 'in_progress') {
      console.warn('[resolve] aborted: ticket not in progress', {
        ticketId: selectedTicket.id,
        status: selectedTicket.status,
      })
      showInfo({
        title: 'Ticket not ready to resolve',
        message: 'Send the first officer reply before resolving this ticket.',
      })
      return
    }
    setIsResolving(true)
    try {
      const resolvedTicketId = selectedTicket.id
      console.info('[resolve] request_start', {
        ticketId: resolvedTicketId,
        summaryLength: resolutionSummary.trim().length,
      })
      await arAPI.resolveTicket(resolvedTicketId, resolutionSummary.trim() || undefined)
      console.info('[resolve] request_success', { ticketId: resolvedTicketId })
      setStatusFilter('resolved')
      await loadTickets('resolved', resolvedTicketId, true)
      setWorkflowOpen(false)
      showSuccess({
        title: 'Ticket resolved',
        message: 'The case was resolved and queued for reinforcement ingestion.',
      })
    } catch (error) {
      console.error('Error resolving ticket:', error)
      console.error('[resolve] request_failed', {
        ticketId: selectedTicket.id,
        error,
      })
      showError({
        title: 'Resolution failed',
        message: getErrorDetail(error, 'The ticket could not be resolved.'),
      })
    } finally {
      setIsResolving(false)
    }
  }

  const filteredTickets = useMemo(() => {
    return tickets.filter((ticket) => {
      const matchesStatus = ticket.status === statusFilter
      const query = searchTerm.trim().toLowerCase()
      if (!query) return matchesStatus

      return (
        matchesStatus &&
        shortTicketReference(ticket.reference_code).toLowerCase().includes(query)
      )
    })
  }, [tickets, statusFilter, searchTerm])

  const statusCounts = useMemo(() => {
    return {
      assigned: tickets.filter((ticket) => ticket.status === 'assigned').length,
      in_progress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
      resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
    }
  }, [tickets])

  const assignedAttentionCount = statusCounts.assigned
  const replyAttentionCount = ticketsWithNewReply.filter((ticketId) => {
    const ticket = tickets.find((item) => item.id === ticketId)
    return ticket?.status === 'in_progress'
  }).length

  const filteredInboxChats = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return inboxChats

    return inboxChats.filter((chat) => chat.title.toLowerCase().includes(query))
  }, [inboxChats, searchTerm])

  useEffect(() => {
    if (!selectedTicket) return
    const stillVisible = filteredTickets.some((ticket) => ticket.id === selectedTicket.id)
    if (stillVisible) return

    const nextTicket = filteredTickets[0] || null
    setSelectedTicket(nextTicket)
    if (nextTicket) {
      void loadMessages(nextTicket.id)
    } else {
      setMessages([])
    }
  }, [filteredTickets, searchTerm, selectedTicket, statusFilter, tickets])

  useEffect(() => {
    if (isInboxView || isCompactTicketLayout || selectedTicket || filteredTickets.length === 0) return
    const nextTicket = filteredTickets[0]
    setSelectedTicket(nextTicket)
    void loadMessages(nextTicket.id)
  }, [filteredTickets, isCompactTicketLayout, isInboxView, selectedTicket])

  useEffect(() => {
    if (isInboxView || !selectedTicket) return

    const poll = window.setInterval(async () => {
      try {
        const data = await arAPI.getTicketConversation(selectedTicket.id)
        const latestStudentReply = data
          .filter((message: TicketMessage) => message.sender_role === 'student' && message.created_at)
          .sort((a: TicketMessage, b: TicketMessage) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .slice(-1)[0]

        if (
          latestStudentReply?.created_at &&
          latestStudentReplyAtRef.current &&
          new Date(latestStudentReply.created_at).getTime() > new Date(latestStudentReplyAtRef.current).getTime()
        ) {
          setMessages(data)
          latestStudentReplyAtRef.current = latestStudentReply.created_at
          if (user) {
            markTicketSeenFromMessages(user, selectedTicket.id, data)
          }
          setTicketsWithNewReply((prev) => prev.filter((id) => id !== selectedTicket.id))
          showInfo({
            title: 'New student reply',
            message: 'A new student message was received in this ticket.',
          })
        } else if (!latestStudentReplyAtRef.current && latestStudentReply?.created_at) {
          latestStudentReplyAtRef.current = latestStudentReply.created_at
        }
      } catch (error) {
        console.error('Error polling ticket conversation:', error)
      }
    }, 15000)

    return () => window.clearInterval(poll)
  }, [isInboxView, selectedTicket, showInfo])

  const statusTone = (status: TicketType['status']) => {
    switch (status) {
      case 'assigned':
        return 'bg-[#D4AF37] text-[#333333]'
      case 'in_progress':
        return 'bg-[#1E6B3B] text-white'
      case 'resolved':
        return 'bg-slate-300 text-[#333333]'
      default:
        return 'bg-slate-100 text-slate-600'
    }
  }

  const actorLabel = (msg: TicketMessage) => {
    if (msg.sender_role === 'student') return 'Student'
    if (msg.sender_role === 'bot') return 'ArASSIST (Automated)'
    return 'Academic Registrar Officer'
  }

  const actorTone = (msg: TicketMessage) => {
    if (msg.sender_role === 'student') return 'text-slate-500'
    if (msg.sender_role === 'bot') return 'text-[#1E6B3B]'
    return 'text-[#8c6500]'
  }

  const inboxActorLabel = (msg: ChatMessage) => (msg.sender === 'user' ? 'You (AR Staff)' : 'ArASSIST (AI Support)')
  const inboxActorTone = (msg: ChatMessage) =>
    msg.sender === 'user' ? 'text-slate-400' : 'text-[#1E6B3B]'

  const bubbleTone = (msg: TicketMessage) => {
    if (msg.sender_role === 'student') return 'border-slate-200 bg-white text-slate-800'
    if (msg.sender_role === 'bot') return 'border-[#D4AF37]/25 bg-[#FEF9E6] text-[#1E6B3B]'
    return 'border-[#e6c96b] bg-[#fff7dd] text-slate-800'
  }

  const formatDate = (value?: string) => {
    if (!value) return 'Unknown'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  const formatTime = (value?: string) => {
    if (!value) return ''
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const sideLinks = [
    { label: 'Tickets', icon: Ticket, to: '/app/staff-dashboard', active: location.pathname === '/app/staff-dashboard' },
    { label: 'Inbox', icon: MessageSquare, to: '/app/staff-chat', active: location.pathname === '/app/staff-chat' },
    {
      label: 'Workflow',
      icon: PanelLeftOpen,
      action: () => {
        setWorkflowOpen(true)
        workflowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
      active: false,
    },
  ]

  const showMobileTicketDetail = !isInboxView && isCompactTicketLayout && !!selectedTicket

  return (
    <div className="staff-workspace flex h-screen flex-col overflow-hidden bg-[linear-gradient(180deg,#FEF9E6_0%,#F5F5F5_55%,#F0F2F5_100%)] text-[#333333]">
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
      {mobileMenuOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-label="Close staff navigation"
        />
      )}

      {workflowOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-950/30 backdrop-blur-sm xl:hidden"
          onClick={() => setWorkflowOpen(false)}
          aria-label="Close workflow panel"
        />
      )}

      <header className="border-b-4 border-[#D4AF37] bg-[#1E6B3B] px-5 py-3 text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] md:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <button
              type="button"
              className="rounded-lg border border-white/15 bg-white/10 p-2 text-white lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open staff navigation"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>

            <div className="flex items-center gap-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#FEF9E6]">Staff workspace</p>
                <p className="mt-1 text-xl font-semibold tracking-[-0.05em] text-white sm:text-2xl md:text-[2.2rem]">ArASSIST</p>
                <p className="text-xs text-[#FEF9E6] sm:text-sm">Academic Support Assistant</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 sm:gap-4">
            <button className="rounded-full p-1.5 text-white transition hover:bg-white/10 hover:text-[#D4AF37]">
              <Bell className="h-4.5 w-4.5" />
            </button>
            <button className="rounded-full p-1.5 text-white transition hover:bg-white/10 hover:text-[#D4AF37]">
              <Settings className="h-4.5 w-4.5" />
            </button>
            <button
              onClick={() => {
                void logout()
              }}
              className="rounded-lg border border-[#D4AF37] px-3.5 py-1.5 text-sm font-semibold text-[#D4AF37] transition hover:bg-[#D4AF37] hover:text-[#1E6B3B]"
            >
              Logout
            </button>
            <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] ring-1 ring-white/15">
              <img src={mustLogo} alt="MUST logo" className="h-6 w-6 object-contain" />
            </div>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[300px] shrink-0 transform flex-col border-r border-[#D4AF37]/20 bg-[#1E6B3B] text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition lg:static lg:z-auto lg:translate-x-0 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-start justify-end px-4 py-4 lg:hidden">
            <button
              type="button"
              className="rounded-full bg-white/12 p-2 text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="border-b border-white/10 px-6 py-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/58">Support desk</p>
            <p className="mt-2 max-w-[220px] text-sm leading-6 text-white/68">
              Respond to student cases, monitor replies, and advance registrar workflows.
            </p>
            <span className="mt-4 inline-flex rounded-full bg-[#D4AF37] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#1E6B3B]">
              Staff support online
            </span>
          </div>

          <nav className="px-4 py-5">
            <div className="space-y-3">
              {sideLinks.map((link) => {
                const Icon = link.icon
                const isTicketNav = link.label === 'Tickets'
                const badges = (
                  <>
                    {assignedAttentionCount > 0 ? (
                      <span className="inline-flex items-center justify-center rounded-full bg-[#D4AF37] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#1E6B3B]">
                        Assigned {assignedAttentionCount}
                      </span>
                    ) : null}
                    {replyAttentionCount > 0 ? (
                      <span className="inline-flex items-center justify-center rounded-full bg-[#1E6B3B] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white ring-1 ring-white/20">
                        Replies {replyAttentionCount}
                      </span>
                    ) : null}
                  </>
                )

                if ('to' in link) {
                  return (
                    <button
                      key={link.label}
                      onClick={() => {
                        setMobileMenuOpen(false)
                        navigate(link.to)
                      }}
                      className={`nav-pill flex w-full items-center gap-3 text-sm ${
                        link.active ? 'nav-pill-active' : 'nav-pill-idle'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="font-medium">{link.label}</span>
                      {isTicketNav ? <span className="ml-auto flex items-center gap-1.5">{badges}</span> : null}
                    </button>
                  )
                }

                return (
                  <button
                    key={link.label}
                    onClick={() => {
                      setMobileMenuOpen(false)
                      link.action()
                    }}
                    className="nav-pill nav-pill-idle flex w-full items-center gap-3 text-sm"
                  >
                    <Icon className="h-4 w-4" />
                    <span className="font-medium">{link.label}</span>
                  </button>
                )
              })}
            </div>
          </nav>

          <div className="mt-auto px-4 pb-4">
            <div className="rounded-[8px] border border-white/10 bg-white/5 p-4">
              <div>
                <p className="text-sm font-semibold text-white">{user?.username}</p>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">{user?.role}</p>
              </div>
              <div className="mt-4 flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.24em] text-white/68">
                <LogOut className="h-5 w-5" />
                <span>Session active</span>
              </div>
            </div>
          </div>
        </aside>

        <div className={`grid min-h-0 flex-1 grid-cols-1 ${isInboxView ? 'xl:grid-cols-[320px_minmax(0,1fr)]' : 'xl:grid-cols-[320px_minmax(0,1fr)_340px]'}`}>
          <section className={`min-h-0 border-r border-slate-200 bg-[#F5F5F5] px-4 py-5 md:px-5 ${showMobileTicketDetail ? 'hidden xl:block' : ''}`}>
            <div className="flex h-full flex-col">
              <div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#1E6B3B]" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={isInboxView ? 'Search inbox...' : 'Search references...'}
                    className="w-full rounded-[8px] border border-slate-200 bg-white px-12 py-3 text-sm text-[#333333] outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/30"
                  />
                </div>

                {isInboxView && (
                  <button
                    type="button"
                    onClick={handleNewInboxChat}
                    className="mt-4 w-full rounded-[8px] bg-[#1E6B3B] px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border hover:border-[#D4AF37]"
                  >
                    New Chat
                  </button>
                )}

                {!isInboxView && (
                  <>
                    <div className="mt-4 grid grid-cols-3 gap-2">
                      {(['assigned', 'in_progress', 'resolved'] as StatusFilter[]).map((status) => (
                        <button
                          key={status}
                          type="button"
                          onClick={() => setStatusFilter(status)}
                          className={`rounded-[8px] px-2 py-3 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                            statusFilter === status
                              ? 'bg-[#1E6B3B] text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
                              : 'bg-white text-[#333333] hover:text-[#1E6B3B]'
                          }`}
                        >
                          <span>{status.replace('_', ' ')}</span>
                          <span className={`ml-1.5 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            statusFilter === status
                              ? 'bg-white/20 text-white'
                              : 'bg-[#1E6B3B] text-white'
                          }`}>
                            {statusCounts[status]}
                          </span>
                        </button>
                      ))}
                    </div>
                    {isRefreshingTicketList ? (
                      <p className="mt-3 text-sm text-slate-500">Refreshing ticket list...</p>
                    ) : null}
                  </>
                )}
              </div>

              <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
                {isInboxView ? (
                  inboxLoading ? (
                    <div className="p-4 text-sm text-slate-500">Loading inbox...</div>
                  ) : filteredInboxChats.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
                      No conversations found.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {filteredInboxChats.map((chat) => (
                        <button
                          key={chat.id}
                          onClick={() => void handleSelectInboxChat(chat)}
                          className={`w-full ${navCardClass} ${
                            selectedInboxChat?.id === chat.id
                              ? 'border-[#D4AF37] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
                              : 'border-slate-100 hover:border-slate-200 hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#FEF9E6] text-[#1E6B3B]">
                              <MessageSquare className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-[#333333]">{chat.title}</p>
                              <p className="mt-1 text-xs text-[#333333]/60">{formatDate(chat.created_at)}</p>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                ) : isLoading ? (
                  <div className="p-4 text-sm text-slate-500">Loading tickets...</div>
                ) : filteredTickets.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
                    No tickets found for this status.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredTickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        onClick={() => void handleSelectTicket(ticket)}
                        className={`w-full ${navCardClass} ${
                          selectedTicket?.id === ticket.id
                            ? 'border-[#D4AF37] border-l-4 border-l-[#D4AF37] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
                            : ticket.status === 'assigned'
                              ? 'border-[#D4AF37]/40 border-l-4 border-l-[#D4AF37] hover:bg-white'
                              : 'border-slate-100 hover:border-slate-200 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-[#1E6B3B]">
                            {shortTicketReference(ticket.reference_code)}
                          </span>
                          <span className={`rounded-md px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] ${statusTone(ticket.status)}`}>
                            {ticket.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className={`mt-2 line-clamp-2 text-sm font-medium ${
                          ticketsWithNewReply.includes(ticket.id) ? 'text-[#1E6B3B]' : 'text-[#333333]'
                        }`}>
                          {ticket.preview_text || 'No student message yet.'}
                        </p>
                        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                          <span className="inline-flex h-6 w-6 rounded-full bg-slate-200" />
                          <span>{ticket.student_identifier || `Student #${ticket.student_id ?? ticket.id}`}</span>
                          {ticketsWithNewReply.includes(ticket.id) ? (
                            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#D4AF37] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#1E6B3B]" />
                              New reply
                            </span>
                          ) : null}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className={`flex min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-[#F0F2F5] ${!isInboxView && isCompactTicketLayout && !selectedTicket ? 'hidden xl:flex' : ''}`}>
            {isInboxView ? (
              !selectedInboxChat ? (
                <div className="flex flex-1 items-center justify-center px-6 py-12">
                  <div className="max-w-xl rounded-[8px] border border-slate-200 bg-white px-10 py-14 text-center shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                    <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[#FEF9E6]">
                      <Bot className="h-10 w-10 text-[#1E6B3B]" />
                    </div>
                    <h3 className="font-sans text-3xl font-semibold text-[#1E6B3B]">Welcome to ArASSIST</h3>
                    <p className="mt-3 text-lg text-[#333333]">
                      Your academic support assistant is ready to help.
                    </p>
                    <p className="mt-2 text-sm uppercase tracking-[0.22em] text-[#1E6B3B]/60">
                      Select a conversation or start a new inquiry
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-200 bg-white/95 px-5 py-4 sm:px-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1E6B3B] text-white">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div>
                          <h2 className="text-2xl font-semibold text-[#1E6B3B]">ArASSIST</h2>
                          <p className="mt-1 text-sm text-[#333333]/70">Academic Support Assistant</p>
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>Started {formatDate(selectedInboxChat.created_at)}</p>
                        <p className="mt-1 font-semibold text-[#1E6B3B]">{selectedInboxChat.title}</p>
                      </div>
                    </div>
                  </div>

                <div className="relative flex-1 overflow-y-auto bg-[#F0F2F5] px-5 py-6 sm:px-6">
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <img
                      src={mustLogo}
                      alt=""
                      aria-hidden="true"
                      className="h-48 w-48 select-none object-contain opacity-[0.05] md:h-64 md:w-64"
                    />
                  </div>
                  {selectedInboxChat.messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 py-12">
                      <div className="max-w-xl rounded-[8px] border border-slate-200 bg-white px-10 py-14 text-center shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-[#FEF9E6]">
                          <Bot className="h-10 w-10 text-[#1E6B3B]" />
                        </div>
                        <h3 className="font-sans text-3xl font-semibold text-[#1E6B3B]">Start a conversation with ArASSIST</h3>
                        <p className="mt-3 text-lg text-[#333333]">
                          Ask for institutional guidance, procedures, and academic support.
                        </p>
                        </div>
                      </div>
                    ) : (
                      <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6">
                        {selectedInboxChat.messages.map((msg) => (
                          <div key={msg.id} className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={msg.sender === 'user' ? 'w-full max-w-[min(58ch,100%)]' : 'w-full max-w-4xl'}>
                              <div className={`mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${inboxActorTone(msg)} ${
                                msg.sender === 'user' ? 'justify-end' : ''
                              }`}>
                                <span>{inboxActorLabel(msg)}</span>
                                <span className="font-normal tracking-normal text-slate-400">
                                  {formatTime(msg.created_at)}
                                </span>
                              </div>
                              <div
                                className={
                                  msg.sender === 'user'
                                    ? 'ml-auto max-w-[min(58ch,100%)] rounded-[20px] border border-[#D4AF37]/20 bg-[rgba(212,175,55,0.2)] px-4 py-3 text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
                                    : 'rounded-[20px] border border-[#D4AF37]/25 bg-[#FEF9E6] px-4 py-3.5 shadow-[0_2px_6px_rgba(0,0,0,0.05)] md:px-5 md:py-4'
                                }
                              >
                                <p className="text-[14px] leading-6 whitespace-pre-wrap break-words sm:text-[15px] sm:leading-7">
                                  {msg.content}
                                </p>
                                <AttachmentList attachments={msg.attachments} tone={msg.sender === 'user' ? 'dark' : 'light'} />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {inboxSending && (
                      <div className="mt-6 flex justify-start">
                        <div className="flex items-start gap-4">
                          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[8px] bg-[#FEF9E6] shadow-[0_2px_6px_rgba(0,0,0,0.05)] ring-1 ring-[#D4AF37]/20">
                            <img src={mustLogo} alt="ArASSIST avatar" className="h-7 w-7 object-contain" />
                          </div>
                          <div className="rounded-[20px] border border-[#D4AF37]/25 bg-[#FEF9E6] px-5 py-4 shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                            <div className="flex gap-1.5">
                              <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" />
                              <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: '0.1s' }} />
                              <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: '0.2s' }} />
                            </div>
                            <p className="mt-3 text-sm text-[#1E6B3B]">ArASSIST is generating a response...</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="border-t border-slate-200 bg-white/90 px-5 py-5">
                    <div className="mx-auto max-w-6xl">
                      {retryInboxMessage ? (
                        <div className="mb-4 flex flex-col gap-3 rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-semibold">Last inbox message did not send</p>
                            <p className="mt-1 text-amber-800">Retry the request after the connection recovers.</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => void handleSendInboxComposer(retryInboxMessage.content, retryInboxMessage.files)}
                            className="rounded-xl bg-amber-500 px-4 py-2 font-semibold text-white transition hover:bg-amber-600"
                          >
                            Retry message
                          </button>
                        </div>
                      ) : null}
                      <ChatInput
                        onSendMessage={(message, files) => void handleSendInboxComposer(message, files || [])}
                        disabled={inboxSending}
                        placeholder="Ask ArASSIST"
                        onAttachmentAccepted={(files) => {
                          if (files.length > 0) {
                            showInfo({
                              title: 'Attachment added',
                              message: `${files.length} file${files.length > 1 ? 's were' : ' was'} attached to your inbox message.`,
                              duration: 2600,
                            })
                          }
                        }}
                        onAttachmentRejected={(message) => {
                          showError({
                            title: 'Attachment rejected',
                            message,
                          })
                        }}
                      />
                      <p className="mt-6 text-center text-xs uppercase tracking-[0.28em] text-[#1E6B3B]/60">
                        Official Assistant of Mbarara University of Science and Technology
                      </p>
                    </div>
                  </div>
                </>
              )
            ) : !selectedTicket ? (
              <div className="hidden flex-1 items-center justify-center text-slate-500 xl:flex">
                Select an assigned ticket to review.
              </div>
            ) : (
              <>
                <div className="border-b border-slate-200 bg-white/95 px-5 py-4 sm:px-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      {isCompactTicketLayout ? (
                        <button
                          type="button"
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-[#333333] shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border-[#D4AF37] hover:text-[#1E6B3B] xl:hidden"
                          onClick={handleBackToTicketList}
                          aria-label="Back to ticket list"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                      ) : null}
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1E6B3B] text-white">
                        <Ticket className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-semibold text-[#1E6B3B]">AR Staff</h2>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      {selectedTicket ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#333333] shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border-[#D4AF37] hover:text-[#1E6B3B] xl:hidden"
                          onClick={() => setWorkflowOpen(true)}
                        >
                          <ClipboardCheck className="h-4 w-4" />
                          <span>Workflow</span>
                        </button>
                      ) : null}
                      <div className="text-right text-xs text-slate-500">
                        <p>Created {formatDate(selectedTicket.created_at)}</p>
                        <p className="mt-1 font-semibold text-[#1E6B3B]">
                          Ref: {shortTicketReference(selectedTicket.reference_code)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="relative flex-1 overflow-y-auto bg-[#F0F2F5] px-5 py-6 sm:px-6">
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <img
                      src={mustLogo}
                      alt=""
                      aria-hidden="true"
                      className="h-48 w-48 select-none object-contain opacity-[0.05] md:h-64 md:w-64"
                    />
                  </div>
                  <div className="mb-3 flex justify-center">
                    <span className="rounded-full bg-[#1E6B3B] px-6 py-2 text-xs font-semibold uppercase tracking-[0.26em] text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                      {new Date(selectedTicket.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  <div className="relative space-y-4">
                    {messages.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
                        No messages yet.
                      </div>
                    ) : (
                      messages.map((msg) => (
                        <div key={msg.id}>
                          <div className={`mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${actorTone(msg)}`}>
                            <span>{actorLabel(msg)}</span>
                            <span className="font-normal tracking-normal text-slate-400">
                              {formatTime(msg.created_at)}
                            </span>
                          </div>
                          <div className={`max-w-[min(58ch,100%)] rounded-[20px] border-l-[3px] px-4 py-3 shadow-[0_2px_6px_rgba(0,0,0,0.05)] ${bubbleTone(msg)} ${
                            msg.sender_role === 'student' ? 'ml-auto' : ''
                          }`}>
                            <p className="text-[14px] leading-6 whitespace-pre-wrap break-words sm:text-[15px] sm:leading-7">
                              {msg.content}
                            </p>
                            <AttachmentList attachments={msg.attachments} />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="border-t border-slate-200 bg-white/90 px-5 py-4">
                  <div className="rounded-[8px] border border-[#D4AF37]/20 bg-white p-2.5 shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                    <ChatInput
                      onSendMessage={(message, files) => void handleSendMessage(message, files || [])}
                      disabled={isSending}
                      placeholder="Type an official response..."
                      onAttachmentAccepted={(files) => {
                        if (files.length > 0) {
                          showInfo({
                            title: 'Attachment added',
                            message: `${files.length} file${files.length > 1 ? 's were' : ' was'} attached to this officer reply.`,
                            duration: 2600,
                          })
                        }
                      }}
                      onAttachmentRejected={(message) => {
                        showError({
                          title: 'Attachment rejected',
                          message,
                        })
                      }}
                    />
                  </div>
                </div>
              </>
            )}
          </section>

          {!isInboxView && (
          <aside
            ref={workflowRef}
            className={`${mobileSheetClass} ${
              workflowOpen ? 'translate-y-0 xl:translate-y-0' : 'translate-y-full xl:translate-y-0'
            }`}
          >
            {selectedTicket ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between xl:hidden">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400">Ticket Workflow</p>
                  <button
                    type="button"
                    className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                    onClick={() => setWorkflowOpen(false)}
                    aria-label="Close workflow panel"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div>
                  <p className="hidden text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 xl:block">Ticket Workflow</p>
                  <div className="mt-3 rounded-[8px] bg-[#EAF7F0] p-4">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Status</p>
                        <p className="mt-1.5 text-base font-semibold text-[#1E6B3B]">{selectedTicket.status.replace('_', ' ')}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Opened Date</p>
                        <p className="mt-1.5 text-base text-slate-900">{formatDate(selectedTicket.created_at)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Assigned To</p>
                        <p className="mt-1.5 text-base text-slate-900">{user?.username || 'Officer'}</p>
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Area of Specialisation</p>
                        <p className="mt-1.5 text-base text-slate-900">{formatAssignmentAreas(user?.assignment_areas)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-[1.1rem] font-semibold text-[#1E6B3B]">Official Actions</h2>
                  <div className="mt-3 space-y-2.5">
                    <p className="rounded-[8px] border border-slate-200 bg-[#FEF9E6] px-3 py-3 text-sm text-[#333333]">
                      Sending the first officer reply automatically moves an assigned ticket to in progress.
                    </p>
                    <button
                      onClick={handleResolve}
                      disabled={selectedTicket.status !== 'in_progress' || isResolving}
                      className="w-full rounded-[8px] border border-transparent bg-[#1E6B3B] px-3 py-3.5 text-sm font-semibold uppercase tracking-[0.14em] text-white transition hover:border-[#D4AF37] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {isResolving ? 'Resolving...' : 'Resolve'}
                    </button>
                  </div>
                </div>

                <div>
                  <h2 className="text-[1.1rem] font-semibold text-[#1E6B3B]">Resolution Process</h2>
                  <div className="mt-3 border-t border-slate-200 pt-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Actions Taken</p>
                    <div className="mt-3 space-y-3">
                      {[
                        ['verifiedIdentity', 'Verified Identity'],
                        ['crossCheckedRecords', 'Cross-checked Records'],
                        ['departmentalApproval', 'Departmental Approval'],
                      ].map(([key, label]) => (
                        <label key={key} className="flex items-center gap-3 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            checked={checklist[key as keyof typeof checklist]}
                            onChange={(e) =>
                              setChecklist((prev) => ({
                                ...prev,
                                [key]: e.target.checked,
                              }))
                            }
                            className="h-5 w-5 rounded border-slate-300 text-[#1E6B3B] focus:ring-[#D4AF37]"
                          />
                          <span>{label}</span>
                        </label>
                      ))}
                    </div>

                    <div className="mt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Resolution Summary</p>
                      <textarea
                        value={resolutionSummary}
                        onChange={(e) => setResolutionSummary(e.target.value)}
                        placeholder="Summarize final resolution for student..."
                        className="mt-2.5 min-h-[100px] w-full rounded-[8px] border border-slate-200 border-l-4 border-l-[#D4AF37] bg-[#EAF7F0] px-3.5 py-3.5 text-sm text-[#333333] outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/30"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[8px] bg-[#FEF9E6] px-3.5 py-3.5 text-[11px] text-[#333333]">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Resolution summaries are archived for quality control and may be audited by the Academic Registrar.
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </aside>
          )}
        </div>
      </div>
    </div>
  )
}

export default StaffDashboardPage
