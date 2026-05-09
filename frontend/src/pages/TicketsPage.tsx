import React, { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { chatAPI, ticketsAPI } from '../services/api'
import { Chat, Ticket, TicketMessage } from '../types'
import { ArrowLeft, MessageSquare, ShieldAlert } from 'lucide-react'
import ChatInput from '../components/chat/ChatInput'
import AttachmentList from '../components/chat/AttachmentList'
import { shortTicketReference } from '../utils/tickets'
import StudentShell from '../components/student/StudentShell'
import FeedbackToastStack from '../components/feedback/FeedbackToastStack'
import { useAuth } from '../contexts/AuthContext'
import { useFeedbackToasts } from '../hooks/useFeedbackToasts'
import { markTicketSeenFromMessages } from '../utils/ticketAttention'
import { getErrorDetail } from '../utils/errors'
import mustLogo from '../../images/logo.png'

const TicketsPage: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [isCompactTicketLayout, setIsCompactTicketLayout] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 1024 : false
  )
  const navigate = useNavigate()
  const { user } = useAuth()
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()
  const latestOfficerReplyAtRef = useRef<string | null>(null)

  useEffect(() => {
    const updateLayoutMode = () => {
      setIsCompactTicketLayout(window.innerWidth < 1024)
    }

    updateLayoutMode()
    window.addEventListener('resize', updateLayoutMode)
    return () => window.removeEventListener('resize', updateLayoutMode)
  }, [])

  useEffect(() => {
    loadChats()
    loadTickets()
  }, [isCompactTicketLayout])

  const loadChats = async () => {
    try {
      const fetchedChats = await chatAPI.getChats()
      setChats(
        fetchedChats.map((chat) => ({
          ...chat,
          title: chat.title || `Conversation ${chat.id}`,
          messages: chat.messages || [],
        }))
      )
    } catch (error) {
      console.error('Error loading chats:', error)
    }
  }

  const loadTickets = async () => {
    try {
      const data = await ticketsAPI.getTickets()
      setTickets(data)
      if (data.length > 0 && !isCompactTicketLayout) {
        setSelectedTicket(data[0])
        loadMessages(data[0].id)
      } else if (isCompactTicketLayout) {
        setSelectedTicket(null)
        setMessages([])
      }
    } catch (error) {
      console.error('Error loading tickets:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadMessages = async (ticketId: number) => {
    try {
      const data = await ticketsAPI.getTicketMessages(ticketId)
      setMessages(data)
      const latestOfficerReply = data
        .filter((message: TicketMessage) => message.sender_role === 'ar_staff' && message.created_at)
        .sort((a: TicketMessage, b: TicketMessage) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
        .slice(-1)[0]
      latestOfficerReplyAtRef.current = latestOfficerReply?.created_at || null
      if (user) {
        markTicketSeenFromMessages(user, ticketId, data)
      }
    } catch (error) {
      console.error('Error loading ticket messages:', error)
    }
  }

  const handleSelectTicket = async (ticket: Ticket) => {
    setSelectedTicket(ticket)
    await loadMessages(ticket.id)
  }

  const handleBackToTicketList = () => {
    setSelectedTicket(null)
    setMessages([])
    latestOfficerReplyAtRef.current = null
  }

  const handleSendMessage = async (content: string, files: File[] = []) => {
    if (!selectedTicket) return
    if (selectedTicket.status === 'resolved') {
      showInfo({
        title: 'Ticket already resolved',
        message: 'This case is closed for messaging. Start a new request if you still need help.',
      })
      return
    }

    setIsSending(true)
    try {
      await ticketsAPI.addTicketMessage(selectedTicket.id, content, files)
      await loadMessages(selectedTicket.id)
      showSuccess({
        title: 'Message sent',
        message: files.length > 0
          ? 'Your update and attachments were sent to Academic Registrar support.'
          : 'Your update was sent to Academic Registrar support.',
      })
    } catch (error) {
      console.error('Error sending message:', error)
      showError({
        title: 'Message failed',
        message: getErrorDetail(error, 'Your message could not be delivered to the ticket thread.'),
      })
    } finally {
      setIsSending(false)
    }
  }

  const formatDate = (value: string) => new Date(value).toLocaleString()
  const formatShortDate = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })
  }
  const formatTime = (value: string) => {
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return ''
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const statusTone = (status: Ticket['status']) => {
    switch (status) {
      case 'in_progress':
        return 'bg-[#0A4B33] text-white'
      case 'resolved':
        return 'bg-slate-300 text-[#333333]'
      case 'assigned':
        return 'bg-[#E6B422] text-[#1E6B3B]'
      default:
        return 'bg-slate-100 text-slate-600'
    }
  }

  const actorLabel = (msg: TicketMessage) => {
    if (msg.sender_role === 'student') return 'You (Student)'
    if (msg.sender_role === 'bot') return 'ArASSIST (AI Support)'
    return 'Academic Registrar Officer'
  }

  const actorTone = (msg: TicketMessage) => {
    if (msg.sender_role === 'student') return 'text-slate-400'
    if (msg.sender_role === 'bot') return 'text-[#1E6B3B]'
    return 'text-[#8c6500]'
  }

  const bubbleTone = (msg: TicketMessage) => {
    if (msg.sender_role === 'student') {
      return 'border-[#E6B422]/30 bg-[rgba(230,180,34,0.2)] text-[#1E6B3B]'
    }
    if (msg.sender_role === 'bot') {
      return 'border-[#E6B422]/25 bg-[#FEF9E6] text-[#1E6B3B]'
    }
    return 'border-[#e6c96b] bg-[#fff7dd] text-slate-800'
  }

  const showMobileTicketDetail = isCompactTicketLayout && !!selectedTicket

  useEffect(() => {
    if (!selectedTicket) return

    const poll = window.setInterval(async () => {
      try {
        const data = await ticketsAPI.getTicketMessages(selectedTicket.id)
        const latestOfficerReply = data
          .filter((message: TicketMessage) => message.sender_role === 'ar_staff' && message.created_at)
          .sort((a: TicketMessage, b: TicketMessage) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
          .slice(-1)[0]

        if (
          latestOfficerReply?.created_at &&
          latestOfficerReplyAtRef.current &&
          new Date(latestOfficerReply.created_at).getTime() > new Date(latestOfficerReplyAtRef.current).getTime()
        ) {
          setMessages(data)
          latestOfficerReplyAtRef.current = latestOfficerReply.created_at
          if (user) {
            markTicketSeenFromMessages(user, selectedTicket.id, data)
          }
          showInfo({
            title: 'New officer reply',
            message: 'Academic Registrar support sent a new reply in this ticket.',
          })
        } else if (!latestOfficerReplyAtRef.current && latestOfficerReply?.created_at) {
          latestOfficerReplyAtRef.current = latestOfficerReply.created_at
        }
      } catch (error) {
        console.error('Error polling ticket messages:', error)
      }
    }, 15000)

    return () => window.clearInterval(poll)
  }, [selectedTicket, showInfo, user])

  return (
    <StudentShell
      chats={chats}
      activeChatId={null}
      onChatSelect={(chatId) => {
        navigate(`/app/chat?chat=${chatId}`)
      }}
      onNewChat={() => {
        navigate('/app/chat?new=1')
      }}
    >
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="h-full overflow-hidden px-5 py-6 md:px-10 md:py-8">
        <div className="flex h-full flex-col gap-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-1 flex-wrap items-center gap-4 text-slate-500">
              <div>
                <p className="eyebrow-label">Student cases</p>
                <span className="mt-1 block font-serif text-[2.2rem] font-semibold tracking-[-0.05em] text-slate-950">My Tickets</span>
              </div>
              <div className="inline-flex max-w-full items-center gap-3 rounded-full border border-white/75 bg-white/72 px-4 py-2 shadow-[0_18px_34px_rgba(15,23,42,0.06)] backdrop-blur">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#1E6B3B] text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                  <ShieldAlert className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#1E6B3B]">Human Intervention Required</p>
                  <p className="truncate text-sm text-slate-600">
                    Moved from AI support to human support for final verification by the Academic Registrar&apos;s Office.
                  </p>
                </div>
              </div>
            </div>

            {selectedTicket && (
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="text-slate-500">
                  Ticket Reference: <span className="font-semibold text-slate-800">{shortTicketReference(selectedTicket.reference_code)}</span>
                </span>
                <span className={`rounded-md px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${statusTone(selectedTicket.status)}`}>
                  {selectedTicket.status.replace('_', ' ')}
                </span>
              </div>
            )}
          </div>

          <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className={`dashboard-panel overflow-hidden ${showMobileTicketDetail ? 'hidden lg:block' : ''}`}>
              <div className="border-b border-white/65 bg-white/36 px-5 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Open Cases</p>
                <p className="mt-2 text-sm text-slate-500">{tickets.length} total ticket{tickets.length === 1 ? '' : 's'} in your queue</p>
              </div>
              <div className="max-h-full overflow-y-auto px-4 pb-4">
                {isLoading ? (
                  <div className="p-4 text-sm text-slate-500">Loading tickets...</div>
                ) : tickets.length === 0 ? (
                  <div className="p-6 text-sm text-slate-500">No tickets yet.</div>
                ) : (
                  <div className="space-y-3 pt-4">
                    {tickets.map((ticket) => (
                      <button
                        key={ticket.id}
                        onClick={() => handleSelectTicket(ticket)}
                        className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                          selectedTicket?.id === ticket.id
                            ? 'border-[#E6B422]/30 border-l-4 border-l-[#E6B422] bg-[#FEF9E6] shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
                            : 'border-white/70 bg-white/78 hover:border-slate-200 hover:bg-white'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className="text-sm font-semibold text-[#1E6B3B]">
                            {shortTicketReference(ticket.reference_code)}
                          </span>
                          <span className={`rounded px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] ${statusTone(ticket.status)}`}>
                            {ticket.status.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="mt-2 line-clamp-2 text-sm text-slate-700">
                          {ticket.status === 'resolved' ? 'Issue resolved' : 'Academic Registrar Support'}
                        </p>
                        <p className="mt-2 text-xs text-slate-400">{formatShortDate(ticket.created_at)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className={`dashboard-panel flex min-h-0 flex-1 flex-col overflow-hidden ${isCompactTicketLayout && !selectedTicket ? 'hidden lg:flex' : ''}`}>
              {!selectedTicket ? (
                <div className="hidden flex-1 items-center justify-center px-8 text-center text-slate-500 lg:flex">
                  <div>
                    <p className="section-heading text-slate-900">Select a ticket</p>
                    <p className="mt-3 text-sm leading-6 text-slate-500">Open a case from the left column to review the conversation and send updates.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="border-b border-white/70 bg-white/62 px-5 py-5 backdrop-blur sm:px-6">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex items-start gap-3">
                        {isCompactTicketLayout ? (
                          <button
                            type="button"
                            onClick={handleBackToTicketList}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-[#E6B422] hover:text-[#1E6B3B] lg:hidden"
                            aria-label="Back to ticket list"
                          >
                            <ArrowLeft className="h-4 w-4" />
                          </button>
                        ) : null}
                        <div className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl bg-white shadow ring-1 ring-[#E6B422]/30">
                          <img src={mustLogo} alt="Staff avatar" className="h-6 w-6 object-contain" />
                        </div>
                        <div>
                          <h2 className="section-heading text-[#1E6B3B]">AR Staff</h2>
                          <p className="mt-1 text-sm text-slate-500">Official replies from registrar support appear here.</p>
                        </div>
                      </div>
                      <div className="text-right text-xs text-slate-500">
                        <p>Created {formatDate(selectedTicket.created_at)}</p>
                        <p className="mt-1 font-semibold text-[#1E6B3B]">Ref: {shortTicketReference(selectedTicket.reference_code)}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#FEF9E6_0%,#F5F5F5_55%,#F0F2F5_100%)] px-5 py-6 sm:px-6">
                    {messages.length === 0 ? (
                      <div className="rounded-[1.8rem] border border-dashed border-white/70 bg-white/58 px-8 py-16 text-center text-slate-500">
                        <MessageSquare className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                        <p className="font-medium text-slate-600">No messages yet</p>
                        <p className="mt-2 text-sm text-slate-400">Updates between you and the registrar team will appear here.</p>
                      </div>
                    ) : (
                      <div className="space-y-5">
                        {messages.map((msg) => (
                          <div key={msg.id}>
                            <div className={`mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${actorTone(msg)}`}>
                              {msg.sender_role !== 'student' ? (
                                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
                                  <img
                                    src={mustLogo}
                                    alt={msg.sender_role === 'bot' ? 'ArASSIST avatar' : 'Staff avatar'}
                                    className="h-5 w-5 object-contain"
                                  />
                                </span>
                              ) : null}
                              <span>{actorLabel(msg)}</span>
                              <span className="font-normal tracking-normal text-slate-400">{formatTime(msg.created_at)}</span>
                            </div>
                            <div className={`max-w-[min(62ch,100%)] rounded-[1.45rem] border-l-[3px] px-4 py-3.5 shadow-[0_14px_28px_rgba(15,23,42,0.05)] ${bubbleTone(msg)} ${
                              msg.sender_role === 'student' ? 'ml-auto' : ''
                            }`}>
                              <p className="text-[14px] leading-6 whitespace-pre-wrap break-words sm:text-[15px] sm:leading-7">
                                {msg.content}
                              </p>
                              <AttachmentList attachments={msg.attachments} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-white/70 bg-white/68 px-5 py-5 backdrop-blur">
                    {selectedTicket.status === 'resolved' ? (
                      <div className="text-sm text-slate-500">This ticket is resolved. Messaging is disabled.</div>
                    ) : (
                      <ChatInput
                        onSendMessage={(message, files) => void handleSendMessage(message, files || [])}
                        disabled={isSending}
                        placeholder="Write an update for Academic Registrar support..."
                        onAttachmentAccepted={(files) => {
                          if (files.length > 0) {
                            showInfo({
                              title: 'Attachment added',
                              message: `${files.length} file${files.length > 1 ? 's were' : ' was'} attached to this ticket update.`,
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
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </StudentShell>
  )
}

export default TicketsPage
