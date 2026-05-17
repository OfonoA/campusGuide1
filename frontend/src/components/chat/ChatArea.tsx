import React, { useState, useRef, useEffect } from 'react'
import { Chat, ChatMessage as ChatMessageType } from '../../types'
import { chatAPI, feedbackAPI } from '../../services/api'
import ChatMessage from './ChatMessage'
import ChatInput from './ChatInput'
import FeedbackToastStack from '../feedback/FeedbackToastStack'
import { AlertCircle, Bot } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import { getErrorDetail } from '../../utils/errors'
import mustLogo from '../../../images/logo.png'

interface ChatAreaProps {
  chat: Chat | null
  onChatUpdate: (chat: Chat) => void
}

const ChatArea: React.FC<ChatAreaProps> = ({ chat, onChatUpdate }) => {
  const [isLoading, setIsLoading] = useState(false)
  const [feedbackById, setFeedbackById] = useState<Record<number, 'up' | 'down'>>({})
  const [ticketNotice, setTicketNotice] = useState<string | null>(null)
  const [retryMessage, setRetryMessage] = useState<{ content: string; files: File[] } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { user } = useAuth()
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [chat?.messages])

  useEffect(() => {
    setTicketNotice(null)
  }, [chat?.id])

  const withAttachmentNote = (content: string, files?: File[]) => {
    const usableFiles = (files || []).filter((file) => file instanceof File)
    if (usableFiles.length === 0) return content
    return `${content}\n\n[Attached files: ${usableFiles.map((file) => file.name).join(', ')}]`
  }

  const handleSendMessage = async (content: string, files: File[] = []) => {
    if (!chat) return
    const displayContent = withAttachmentNote(content, files)

    const userMessage: ChatMessageType = {
      id: Date.now(),
      sender: 'user',
      content: displayContent,
      created_at: new Date().toISOString(),
    }

    const updatedChat = {
      ...chat,
      messages: [...chat.messages, userMessage],
    }
    onChatUpdate(updatedChat)

    setIsLoading(true)

    try {
      if (chat.id > 0) {
        const active = await chatAPI.getActiveTicket(chat.id)
        if (active?.active) {
          const notice = `This inquiry is now handled under ticket ${active.ticket_reference}. Please use the ticket chat.`
          setTicketNotice(notice)
          onChatUpdate({
            ...updatedChat,
            messages: [
              ...updatedChat.messages,
              {
                id: Date.now() + 1,
                sender: 'bot',
                content: notice,
                created_at: new Date().toISOString(),
              },
            ],
          })
          setIsLoading(false)
          showInfo({
            title: 'Ticket already open',
            message: `This inquiry is already being handled under ticket ${active.ticket_reference}.`,
          })
          return
        }
      }

      const historyPairs: [string, string][] = []
      for (let i = 0; i < chat.messages.length - 1; i++) {
        const a = chat.messages[i]
        const b = chat.messages[i + 1]
        if (a.sender === 'user' && b.sender === 'bot') {
          historyPairs.push([a.content, b.content])
        }
      }

      const response = await chatAPI.sendMessage(
        content,
        chat.id > 0 ? chat.id : undefined,
        historyPairs,
        files,
      )

      if (response?.ticket_reference) {
        const notice =
          `Your inquiry has been referred to an officer in the Academic Registrar's Department. ` +
          `Your ticket reference is ${response.ticket_reference}. Please continue in the ticket chat.`

        setTicketNotice(notice)
        onChatUpdate({
          ...updatedChat,
          id: response.chat_id || chat.id,
          title: chat.title || content.slice(0, 50) + (content.length > 50 ? '...' : ''),
          messages: [
            ...updatedChat.messages,
            {
              id: Date.now() + 2,
              sender: 'bot',
              content: notice,
              created_at: new Date().toISOString(),
            },
          ],
        })
        setIsLoading(false)
        showSuccess({
          title: 'Ticket created',
          message: `Your inquiry has been escalated under ${response.ticket_reference}. Continue in the ticket chat.`,
        })
        return
      }

      // Show the bot response immediately with a typing effect for better perceived speed.
      const typedBotMessage: ChatMessageType = {
        id: Date.now() + 2,
        sender: 'bot',
        content: response.response || "I'm sorry, I'm having trouble connecting right now. Please try again later.",
        created_at: new Date().toISOString(),
        typing_effect: true,
      }

      const immediateChat = {
        ...updatedChat,
        id: response.chat_id || chat.id,
        messages: [...updatedChat.messages, typedBotMessage],
        title: chat.title || content.slice(0, 50) + (content.length > 50 ? '...' : ''),
      }
      onChatUpdate(immediateChat)

      const freshMessages = await chatAPI.getChatMessages(response.chat_id || chat.id)
      onChatUpdate({
        ...immediateChat,
        messages: freshMessages,
      })
      setRetryMessage(null)
      showSuccess({
        title: 'Message sent',
        message: files.length > 0 ? 'Your message and attachments were sent to ArASSIST.' : 'Your message was sent to ArASSIST.',
      })
    } catch (error) {
      console.error('Error sending message:', error)
      
      // Add error message
      const errorMessage: ChatMessageType = {
        id: Date.now() + 1,
        sender: 'bot',
        content: "I'm sorry, I'm having trouble connecting right now. Please try again later.",
        created_at: new Date().toISOString(),
      }

      const errorChat = {
        ...updatedChat,
        messages: [...updatedChat.messages, errorMessage],
      }
      onChatUpdate(errorChat)
      setRetryMessage({ content, files })
      showError({
        title: 'Message failed',
        message: getErrorDetail(error, 'ArASSIST could not receive your message right now.'),
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleFeedback = async (messageId: number, isHelpful: boolean) => {
    try {
      await feedbackAPI.sendFeedback(messageId, isHelpful, false)
      setFeedbackById((prev) => ({
        ...prev,
        [messageId]: isHelpful ? 'up' : 'down',
      }))
      showSuccess({
        title: 'Feedback submitted',
        message: isHelpful ? 'Thanks. Your helpfulness feedback was recorded.' : 'Your feedback was recorded for review.',
      })
    } catch (error) {
      console.error('Feedback error:', error)
      showError({
        title: 'Feedback failed',
        message: getErrorDetail(error, 'Your feedback could not be submitted.'),
      })
    }
  }

  const handleEscalate = async (messageId: number) => {
    try {
      const response = await feedbackAPI.sendFeedback(messageId, false, true)
      if (response?.ticket_reference && chat) {
        setTicketNotice(
          `Your inquiry has been referred to an officer in the Academic Registrar's Department. ` +
          `Your ticket reference is ${response.ticket_reference}. Please continue in the ticket chat.`
        )
        const infoMessage: ChatMessageType = {
          id: Date.now(),
          sender: 'bot',
          content:
            "Your inquiry has been referred to an officer in the Academic Registrar's Department. " +
            `Your ticket reference is ${response.ticket_reference}. Please continue in the ticket chat.`,
          created_at: new Date().toISOString(),
        }
        onChatUpdate({
          ...chat,
          messages: [...chat.messages, infoMessage],
        })
        showSuccess({
          title: 'Escalation submitted',
          message: `An officer ticket was created with reference ${response.ticket_reference}.`,
        })
      }
    } catch (error) {
      console.error('Escalation error:', error)
      showError({
        title: 'Escalation failed',
        message: getErrorDetail(error, 'Your request could not be referred to an officer.'),
      })
    }
  }

  const shouldShowEscalate = (foundAnswer: boolean | null | undefined, messageId: number) => {
    if (user?.role === 'ar_staff') return false
    if (feedbackById[messageId] === 'down') return true
    return foundAnswer === false
  }

  if (!chat) {
    return (
      <div className="flex h-full items-center justify-center px-6 py-12">
        <div className="max-w-xl rounded-[8px] border border-[#E6B422]/30 bg-white px-10 py-14 text-center shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-[8px] bg-[#FEF9E6]">
            <Bot className="h-10 w-10 text-[#1E6B3B]" />
          </div>
          <p className="eyebrow-label" style={{ color: '#1E6B3B' }}>Student assistant</p>
          <h3 className="section-heading mt-3 text-[#1E6B3B]">Welcome to ArASSIST</h3>
          <p className="mt-3 text-lg text-[#333333]">Your academic support assistant is ready to help.</p>
          <p className="mt-2 text-sm uppercase tracking-[0.22em] text-[#1E6B3B]/70">
            Select a conversation or start a new inquiry
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
      {ticketNotice && (
        <div className="flex items-center gap-3 border-b border-[#E6B422] bg-[#FEF9E6] px-5 py-4 text-sm font-semibold uppercase tracking-[0.12em] text-[#1E6B3B] md:px-10">
          <AlertCircle className="h-5 w-5 shrink-0 text-[#1E6B3B]" />
          <span>{ticketNotice}</span>
        </div>
      )}

      <div className="chat-scroll-area relative flex-1 overflow-y-auto overflow-x-hidden px-5 py-8 md:px-10 md:py-10">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <img
            src={mustLogo}
            alt=""
            aria-hidden="true"
            className="h-48 w-48 select-none object-contain opacity-[0.05] md:h-64 md:w-64"
          />
        </div>
        <div className="relative mx-auto flex w-full max-w-6xl flex-col gap-6">
        {chat.messages.length === 0 ? (
          <div className="rounded-[8px] border border-dashed border-[#E6B422]/40 bg-white px-8 py-20 text-center">
            <Bot className="mx-auto h-14 w-14 text-[#1E6B3B]/40" />
            <p className="mt-4 text-lg font-medium text-[#333333]">Start a conversation with ArASSIST</p>
            <p className="mt-2 text-sm text-[#333333]/70">Ask about academic procedures, fees, offices, regulations, or deadlines.</p>
          </div>
        ) : (
          chat.messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onFeedback={handleFeedback}
              onEscalate={handleEscalate}
              feedbackState={feedbackById[message.id] || null}
              showEscalate={shouldShowEscalate(message.found_answer, message.id)}
            />
          ))
        )}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex justify-start">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-[8px] bg-[#FEF9E6] shadow-[0_2px_6px_rgba(0,0,0,0.05)] ring-1 ring-[#E6B422]/20">
                <img src={mustLogo} alt="ArASSIST avatar" className="h-7 w-7 object-contain" />
              </div>
              <div className="rounded-[20px] border border-[#E6B422]/30 bg-[#FEF9E6] px-5 py-4 shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                <div className="flex gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-[#1E6B3B] animate-bounce"></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-[#1E6B3B] animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                  <div className="h-2.5 w-2.5 rounded-full bg-[#1E6B3B] animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
        </div>
      </div>

      <div className="px-4 pb-4 pt-2 md:px-6 md:pb-5">
        <div className="mx-auto max-w-6xl rounded-[2rem] border border-white/85 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.1)]">
          <div className="px-4 py-4 md:px-6">
            {retryMessage ? (
              <div className="mb-4 flex flex-col gap-3 rounded-[1.2rem] border border-amber-200 bg-amber-50/92 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-semibold">Last message did not send</p>
                  <p className="mt-1 text-amber-800">Retry the request after your connection stabilizes.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSendMessage(retryMessage.content, retryMessage.files)}
                  className="rounded-xl bg-amber-500 px-4 py-2 font-semibold text-white transition hover:bg-amber-600"
                >
                  Retry message
                </button>
              </div>
            ) : null}
            <ChatInput
              onSendMessage={handleSendMessage}
              disabled={isLoading || !!ticketNotice}
              placeholder="Ask ArASSIST"
              onAttachmentAccepted={(files) => {
                if (files.length > 0) {
                  showInfo({
                    title: 'Attachment added',
                    message: `${files.length} file${files.length > 1 ? 's were' : ' was'} attached to your message.`,
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
            <p className="mt-4 text-center text-[11px] uppercase tracking-[0.24em] text-slate-400">
              Official Assistant of Mbarara University of Science and Technology
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ChatArea
