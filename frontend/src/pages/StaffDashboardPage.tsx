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

const navCardClass = 'rounded-[1.2rem] border bg-white px-4 py-3.5 text-left transition'
const mobileSheetClass = 'fixed inset-x-0 bottom-0 z-50 max-h-[78vh] overflow-y-auto border-t border-slate-200 bg-white px-4 py-4 shadow-[0_-18px_48px_rgba(15,23,42,0.16)] transition xl:static xl:max-h-none xl:border-l xl:border-t-0 xl:px-4 xl:py-4 xl:shadow-none xl:w-auto xl:max-w-none'

const StaffDashboardPage: React.FC = () => {
  const [tickets, setTickets] = useState<TicketType[]>([])
  const [selectedTicket, setSelectedTicket] = useState<TicketType | null>(null)
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
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
    if (!selectedTicket) return
    if (selectedTicket.status !== 'in_progress') {
      showInfo({
        title: 'Ticket not ready to resolve',
        message: 'Send the first officer reply before resolving this ticket.',
      })
      return
    }
    try {
      const resolvedTicketId = selectedTicket.id
      await arAPI.resolveTicket(resolvedTicketId, resolutionSummary.trim() || undefined)
      setStatusFilter('resolved')
      await loadTickets('resolved', resolvedTicketId, true)
      setWorkflowOpen(false)
      showSuccess({
        title: 'Ticket resolved',
        message: 'The case was resolved and queued for reinforcement ingestion.',
      })
    } catch (error) {
      console.error('Error resolving ticket:', error)
      showError({
        title: 'Resolution failed',
        message: getErrorDetail(error, 'The ticket could not be resolved.'),
      })
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
        return 'bg-accent-400 text-accent-900'
      case 'in_progress':
        return 'bg-primary-100 text-primary-700'
      case 'resolved':
        return 'bg-[#e9e4fb] text-primary-700'
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
    if (msg.sender_role === 'bot') return 'text-primary-700'
    return 'text-[#8c6500]'
  }

  const inboxActorLabel = (msg: ChatMessage) => (msg.sender === 'user' ? 'You (AR Staff)' : 'ArASSIST (AI Support)')
  const inboxActorTone = (msg: ChatMessage) =>
    msg.sender === 'user' ? 'text-slate-400' : 'text-primary-700'

  const bubbleTone = (msg: TicketMessage) => {
    if (msg.sender_role === 'student') return 'border-slate-200 bg-white text-slate-800'
    if (msg.sender_role === 'bot') return 'border-primary-600 bg-[#f8f8ff] text-primary-800'
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
    { label: 'Tickets', icon: Ticket, action: () => navigate('/app/staff-dashboard'), active: location.pathname === '/app/staff-dashboard' },
    { label: 'Inbox', icon: MessageSquare, action: () => navigate('/app/staff-chat'), active: location.pathname === '/app/staff-chat' },
    {
      label: 'Workflow',
      icon: ClipboardCheck,
      action: () => {
        setWorkflowOpen(true)
        workflowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      },
      active: false,
    },
  ]

  const showMobileTicketDetail = !isInboxView && isCompactTicketLayout && !!selectedTicket

  return (
    <div className="h-screen overflow-hidden bg-[#f6f7fc] text-slate-900">
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

      <header className="border-b border-slate-200 bg-white/95 px-5 py-4 backdrop-blur md:px-8">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <button
              type="button"
              className="rounded-2xl border border-slate-200 bg-white p-2.5 text-slate-600 shadow-sm lg:hidden"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open staff navigation"
            >
              <Menu className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-8">
              <div>
                <p className="text-xl font-semibold tracking-tight text-primary-700 sm:text-2xl md:text-3xl">ArASSIST</p>
                <p className="text-sm text-slate-500">Academic Support Assistant</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-5">
            <button className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-primary-700">
              <Bell className="h-5 w-5" />
            </button>
            <button className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-primary-700">
              <Settings className="h-5 w-5" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-white shadow ring-1 ring-primary-100">
              <img src={mustLogo} alt="MUST logo" className="h-7 w-7 object-contain" />
            </div>
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-81px)]">
        <aside
          className={`fixed inset-y-[81px] left-0 z-50 flex w-[280px] transform flex-col border-r border-slate-200 bg-[#f3f5fb] transition lg:static lg:translate-x-0 ${
            mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-start justify-end px-6 py-4 lg:block">
            <button
              type="button"
              className="rounded-full p-2 text-slate-400 transition hover:bg-white hover:text-slate-600 lg:hidden"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close sidebar"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-4 py-4">
            <div className="space-y-2">
              {sideLinks.map((link) => {
                const Icon = link.icon
                const isTicketNav = link.label === 'Tickets'
                return (
                  <button
                    key={link.label}
                    onClick={link.action}
                    className={`flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
                      link.active
                        ? 'bg-white text-primary-700 shadow-[0_10px_22px_rgba(15,23,42,0.06)]'
                        : 'text-slate-500 hover:bg-white/80 hover:text-primary-700'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-sm font-medium">{link.label}</span>
                    {isTicketNav ? (
                      <span className="ml-auto flex items-center gap-1.5">
                        {assignedAttentionCount > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-full bg-primary-700 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
                            Assigned {assignedAttentionCount}
                          </span>
                        ) : null}
                        {replyAttentionCount > 0 ? (
                          <span className="inline-flex items-center justify-center rounded-full bg-accent-400 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-accent-900">
                            Replies {replyAttentionCount}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-auto px-4 pb-4">
            <button
              onClick={() => {
                void logout()
              }}
              className="flex items-center gap-3 px-4 py-3 text-sm font-semibold uppercase tracking-[0.24em] text-slate-600 transition hover:text-primary-700"
            >
              <LogOut className="h-5 w-5" />
              <span>Logout</span>
            </button>
          </div>
        </aside>

        <div className={`grid min-h-0 flex-1 grid-cols-1 ${isInboxView ? 'xl:grid-cols-[320px_minmax(0,1fr)]' : 'xl:grid-cols-[320px_minmax(0,1fr)_340px]'}`}>
          <section className={`min-h-0 border-r border-slate-200 bg-[#f8f8fd] px-4 py-5 md:px-5 ${showMobileTicketDetail ? 'hidden xl:block' : ''}`}>
            <div className="flex h-full flex-col">
              <div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder={isInboxView ? 'Search inbox...' : 'Search references...'}
                    className="w-full rounded-2xl border border-slate-200 bg-white px-12 py-3 text-sm text-slate-700 outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
                  />
                </div>

                {isInboxView && (
                  <button
                    type="button"
                    onClick={handleNewInboxChat}
                    className="mt-4 w-full rounded-2xl bg-primary-700 px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_12px_20px_rgba(51,51,153,0.18)] transition hover:bg-primary-800"
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
                          className={`rounded-2xl px-2 py-3 text-xs font-semibold uppercase tracking-[0.16em] transition ${
                            statusFilter === status
                              ? 'bg-primary-700 text-white shadow-[0_12px_20px_rgba(51,51,153,0.18)]'
                              : 'bg-white text-slate-500 hover:text-primary-700'
                          }`}
                        >
                          <span>{status.replace('_', ' ')}</span>
                          <span className={`ml-1.5 inline-flex min-w-6 items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            statusFilter === status
                              ? 'bg-white/20 text-white'
                              : 'bg-slate-100 text-slate-600'
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
                              ? 'border-primary-200 shadow-[0_16px_28px_rgba(15,23,42,0.06)]'
                              : 'border-slate-100 hover:border-slate-200 hover:shadow-[0_14px_24px_rgba(15,23,42,0.04)]'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700">
                              <MessageSquare className="h-4 w-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-slate-900">{chat.title}</p>
                              <p className="mt-1 text-xs text-slate-400">{formatDate(chat.created_at)}</p>
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
                            ? 'border-primary-200 shadow-[0_16px_28px_rgba(15,23,42,0.06)]'
                            : 'border-slate-100 hover:border-slate-200 hover:shadow-[0_14px_24px_rgba(15,23,42,0.04)]'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-primary-700">
                            {shortTicketReference(ticket.reference_code)}
                          </span>
                          <span className={`rounded-md px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.16em] ${statusTone(ticket.status)}`}>
                            {ticket.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className={`mt-2 line-clamp-2 text-sm font-medium ${
                          ticketsWithNewReply.includes(ticket.id) ? 'text-accent-900' : 'text-slate-900'
                        }`}>
                          {ticket.preview_text || 'No student message yet.'}
                        </p>
                        <div className="mt-2 flex items-center gap-3 text-xs text-slate-500">
                          <span className="inline-flex h-6 w-6 rounded-full bg-slate-200" />
                          <span>{ticket.student_identifier || `Student #${ticket.student_id ?? ticket.id}`}</span>
                          {ticketsWithNewReply.includes(ticket.id) ? (
                            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent-400 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-accent-900 shadow-sm ring-1 ring-accent-500/40">
                              <span className="h-1.5 w-1.5 rounded-full bg-accent-900" />
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

          <section className={`flex min-h-0 flex-col overflow-hidden border-r border-slate-200 bg-[#f4f5fa] ${!isInboxView && isCompactTicketLayout && !selectedTicket ? 'hidden xl:flex' : ''}`}>
            {isInboxView ? (
              !selectedInboxChat ? (
                <div className="flex flex-1 items-center justify-center px-6 py-12">
                  <div className="max-w-xl rounded-[2rem] border border-slate-200 bg-white px-10 py-14 text-center shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
                    <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
                      <Bot className="h-10 w-10 text-primary-700" />
                    </div>
                    <h3 className="font-sans text-3xl font-semibold text-slate-950">Welcome to ArASSIST</h3>
                    <p className="mt-3 text-lg text-slate-600">
                      Your academic support assistant is ready to help.
                    </p>
                    <p className="mt-2 text-sm uppercase tracking-[0.22em] text-slate-400">
                      Select a conversation or start a new inquiry
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-b border-slate-200 bg-white/95 px-5 py-4 sm:px-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-700 text-white">
                          <MessageSquare className="h-4 w-4" />
                        </div>
                        <div>
                          <h2 className="text-2xl font-semibold text-primary-700">ArASSIST</h2>
                          <p className="mt-1 text-sm text-slate-500">Academic Support Assistant</p>
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>Started {formatDate(selectedInboxChat.created_at)}</p>
                        <p className="mt-1 font-semibold text-primary-700">{selectedInboxChat.title}</p>
                      </div>
                    </div>
                  </div>

                <div className="flex-1 overflow-y-auto bg-[#f6f7fc] px-5 py-6 sm:px-6">
                  {selectedInboxChat.messages.length === 0 ? (
                    <div className="flex h-full items-center justify-center px-6 py-12">
                      <div className="max-w-xl rounded-[2rem] border border-slate-200 bg-white px-10 py-14 text-center shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
                        <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
                          <Bot className="h-10 w-10 text-primary-700" />
                        </div>
                        <h3 className="font-sans text-3xl font-semibold text-slate-950">Start a conversation with ArASSIST</h3>
                        <p className="mt-3 text-lg text-slate-600">
                          Ask for institutional guidance, procedures, and academic support.
                        </p>
                        </div>
                      </div>
                    ) : (
                      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
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
                                    ? 'ml-auto max-w-[min(58ch,100%)] rounded-[1.2rem] border-l-[3px] border-primary-600 bg-primary-700 px-4 py-3 text-white shadow-[0_16px_28px_rgba(51,51,153,0.2)]'
                                    : 'rounded-[1.2rem] border border-slate-200 border-l-[3px] border-l-primary-600 bg-white px-4 py-3.5 shadow-[0_14px_28px_rgba(15,23,42,0.04)] md:px-5 md:py-4'
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
                          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
                            <img src={mustLogo} alt="ArASSIST avatar" className="h-7 w-7 object-contain" />
                          </div>
                          <div className="rounded-[1.5rem] border border-slate-200 bg-white px-5 py-4 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
                            <div className="flex gap-1.5">
                              <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" />
                              <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: '0.1s' }} />
                              <div className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: '0.2s' }} />
                            </div>
                            <p className="mt-3 text-sm text-slate-500">ArASSIST is generating a response...</p>
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
                      <p className="mt-6 text-center text-xs uppercase tracking-[0.28em] text-slate-400">
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
                          className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-primary-200 hover:text-primary-700 xl:hidden"
                          onClick={handleBackToTicketList}
                          aria-label="Back to ticket list"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </button>
                      ) : null}
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-700 text-white">
                        <Ticket className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-2xl font-semibold text-primary-700">AR Staff</h2>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      {selectedTicket ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 shadow-sm transition hover:border-primary-200 hover:text-primary-700 xl:hidden"
                          onClick={() => setWorkflowOpen(true)}
                        >
                          <ClipboardCheck className="h-4 w-4" />
                          <span>Workflow</span>
                        </button>
                      ) : null}
                      <div className="text-right text-xs text-slate-500">
                        <p>Created {formatDate(selectedTicket.created_at)}</p>
                        <p className="mt-1 font-semibold text-primary-700">
                          Ref: {shortTicketReference(selectedTicket.reference_code)}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto bg-[#f6f7fc] px-5 py-6 sm:px-6">
                  <div className="mb-3 flex justify-center">
                    <span className="rounded-full bg-white px-6 py-2 text-xs font-semibold uppercase tracking-[0.26em] text-slate-500 shadow-sm">
                      {new Date(selectedTicket.created_at).toLocaleDateString('en-US', {
                        weekday: 'long',
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>

                  <div className="space-y-4">
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
                          <div className={`max-w-[min(58ch,100%)] rounded-[1.2rem] border-l-[3px] px-4 py-3 shadow-sm ${bubbleTone(msg)} ${
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
                  <div className="rounded-[1.35rem] border border-slate-200 bg-white p-2.5 shadow-[0_18px_36px_rgba(15,23,42,0.06)]">
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
                  <div className="mt-3 rounded-[1rem] bg-[#f6f6fb] p-4">
                    <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Status</p>
                        <p className="mt-1.5 text-base font-semibold text-primary-700">{selectedTicket.status.replace('_', ' ')}</p>
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
                        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Department</p>
                        <p className="mt-1.5 text-base text-slate-900">Registrar-Gen</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div>
                  <h2 className="text-[1.1rem] font-semibold text-slate-950">Official Actions</h2>
                  <div className="mt-3 space-y-2.5">
                    <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-600">
                      Sending the first officer reply automatically moves an assigned ticket to in progress.
                    </p>
                    <button
                      onClick={handleResolve}
                      disabled={selectedTicket.status !== 'in_progress'}
                      className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3.5 text-sm font-semibold uppercase tracking-[0.14em] text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Resolve
                    </button>
                  </div>
                </div>

                <div>
                  <h2 className="text-[1.1rem] font-semibold text-slate-950">Resolution Process</h2>
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
                            className="h-5 w-5 rounded border-slate-300 text-primary-700 focus:ring-primary-500"
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
                        className="mt-2.5 min-h-[100px] w-full rounded-[1rem] border border-slate-200 bg-[#f6f6fb] px-3.5 py-3.5 text-sm text-slate-700 outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
                      />
                    </div>
                  </div>
                </div>

                <div className="rounded-[1rem] bg-[#fff3d8] px-3.5 py-3.5 text-[11px] text-[#7a5800]">
                  <div className="flex items-start gap-3">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    <p>
                      Resolution summaries are archived for quality control and may be audited by the Dean of Students.
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
