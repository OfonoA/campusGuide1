import React, { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, MessageSquare, Search, ShieldCheck } from 'lucide-react'
import AdminShell from '../../components/admin/AdminShell'
import ChatInput from '../../components/chat/ChatInput'
import AttachmentList from '../../components/chat/AttachmentList'
import FeedbackToastStack from '../../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import { chatAPI } from '../../services/api'
import { Chat, ChatMessage } from '../../types'
import { getErrorDetail } from '../../utils/errors'

const AdminChatPage: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([])
  const [selectedChat, setSelectedChat] = useState<Chat | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [isSending, setIsSending] = useState(false)
  const [retryMessage, setRetryMessage] = useState<{ content: string; files: File[] } | null>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()

  useEffect(() => {
    void loadChats()
  }, [])

  useEffect(() => {
    if (location.state && (location.state as { newChat?: boolean }).newChat) {
      handleNewChat()
      navigate(location.pathname, { replace: true })
    }
  }, [location.pathname, location.state, navigate])

  const loadChats = async () => {
    setIsLoading(true)
    try {
      const fetchedChats = await chatAPI.getChats()
      const normalized = fetchedChats.map((chat) => ({
        ...chat,
        title: chat.title || `Conversation ${chat.id}`,
        messages: chat.messages || [],
      }))
      setChats(normalized)

      if (normalized.length > 0) {
        const preferred = normalized[0]
        setSelectedChat(preferred)

        if (preferred.id > 0) {
          const messages = await chatAPI.getChatMessages(preferred.id)
          const hydrated = { ...preferred, messages }
          setChats((prev) => prev.map((chat) => (chat.id === preferred.id ? hydrated : chat)))
          setSelectedChat(hydrated)
        }
      } else {
        setSelectedChat(null)
      }
    } catch (error) {
      console.error('Error loading admin inbox chats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelectChat = async (chat: Chat) => {
    setSelectedChat(chat)
    if (chat.messages.length > 0 || chat.id <= 0) return

    try {
      const messages = await chatAPI.getChatMessages(chat.id)
      const hydrated = { ...chat, messages }
      setChats((prev) => prev.map((item) => (item.id === chat.id ? hydrated : item)))
      setSelectedChat(hydrated)
    } catch (error) {
      console.error('Error loading admin chat messages:', error)
    }
  }

  const handleNewChat = () => {
    setSelectedChat({
      id: 0,
      title: 'New Chat',
      created_at: new Date().toISOString(),
      messages: [],
    })
    setNewMessage('')
  }

  const withAttachmentNote = (content: string, files?: File[]) => {
    const usableFiles = (files || []).filter((file) => file instanceof File)
    if (usableFiles.length === 0) return content
    return `${content}\n\n[Attached files: ${usableFiles.map((file) => file.name).join(', ')}]`
  }

  const handleSendMessage = async (draft?: string, files: File[] = []) => {
    if (!selectedChat) return

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
      ...selectedChat,
      messages: [...selectedChat.messages, optimisticMessage],
    }

    setSelectedChat(optimisticChat)
    setChats((prev) => prev.map((chat) => (chat.id === optimisticChat.id ? optimisticChat : chat)))
    setNewMessage('')
    setIsSending(true)

    try {
      const historyPairs: [string, string][] = []
      for (let i = 0; i < selectedChat.messages.length - 1; i++) {
        const a = selectedChat.messages[i]
        const b = selectedChat.messages[i + 1]
        if (a.sender === 'user' && b.sender === 'bot') {
          historyPairs.push([a.content, b.content])
        }
      }

      const response = await chatAPI.sendMessage(
        content,
        selectedChat.id > 0 ? selectedChat.id : undefined,
        historyPairs,
        files
      )

      const refreshedMessages = await chatAPI.getChatMessages(response.chat_id || selectedChat.id)
      const refreshedChat: Chat = {
        ...optimisticChat,
        id: response.chat_id || optimisticChat.id,
        title: optimisticChat.title || content.slice(0, 50),
        messages: refreshedMessages,
      }

      setSelectedChat(refreshedChat)
      setChats((prev) => {
        const exists = prev.some((chat) => chat.id === refreshedChat.id)
        if (exists) {
          return prev.map((chat) => (chat.id === refreshedChat.id ? refreshedChat : chat))
        }
        return [refreshedChat, ...prev]
      })
      setRetryMessage(null)
      showSuccess({
        title: 'Message sent',
        message: files.length > 0 ? 'Your admin message and attachments were delivered.' : 'Your admin message was delivered.',
      })
    } catch (error) {
      console.error('Error sending admin chat message:', error)
      setRetryMessage({ content, files })
      showError({
        title: 'Message failed',
        message: getErrorDetail(error, 'The admin message could not be sent.'),
      })
    } finally {
      setIsSending(false)
    }
  }

  const filteredChats = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    if (!query) return chats
    return chats.filter((chat) => chat.title.toLowerCase().includes(query))
  }, [chats, searchTerm])

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

  const actorLabel = (msg: ChatMessage) => (msg.sender === 'user' ? 'You (Admin)' : 'ArASSIST (AI Support)')
  const actorTone = (msg: ChatMessage) => (msg.sender === 'user' ? 'text-slate-400' : 'text-primary-700')

  return (
    <AdminShell title="Inbox" subtitle="Chat with ArASSIST for administrative guidance.">
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="grid min-h-[calc(100vh-240px)] grid-cols-1 overflow-hidden rounded-[1.6rem] border border-white/75 bg-white/86 shadow-[0_24px_60px_rgba(15,23,42,0.08)] xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="min-h-0 border-r border-white/70 bg-[linear-gradient(180deg,#f8f9fd_0%,#f0f4fb_100%)] px-4 py-5 md:px-5">
          <div className="flex h-full flex-col">
            <div>
              <div className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">Admin workspace</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">Use this inbox for internal guidance and policy lookup with ArASSIST.</p>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search inbox..."
                  className="w-full rounded-2xl border border-slate-200 bg-white px-12 py-3 text-sm text-slate-700 outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
                />
              </div>

              <button
                type="button"
                onClick={handleNewChat}
                className="mt-4 w-full rounded-2xl bg-primary-700 px-4 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white shadow-[0_12px_20px_rgba(51,51,153,0.18)] transition hover:bg-primary-800"
              >
                New Chat
              </button>
            </div>

            <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
              {isLoading ? (
                <div className="p-4 text-sm text-slate-500">Loading inbox...</div>
              ) : filteredChats.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-500">
                  No conversations found.
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredChats.map((chat) => (
                    <button
                      key={chat.id}
                      onClick={() => void handleSelectChat(chat)}
                      className={`w-full rounded-[1.2rem] border bg-white px-4 py-3.5 text-left transition ${
                        selectedChat?.id === chat.id
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
              )}
            </div>
          </div>
        </section>

        <section className="flex min-h-0 flex-col overflow-hidden bg-[linear-gradient(180deg,#f7f9fd_0%,#eef3fa_100%)]">
          {!selectedChat ? (
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
                    <p>Started {formatDate(selectedChat.created_at)}</p>
                    <p className="mt-1 font-semibold text-primary-700">{selectedChat.title}</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto bg-[#f6f7fc] px-5 py-6 sm:px-6">
                {selectedChat.messages.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-6 py-12">
                    <div className="max-w-xl rounded-[2rem] border border-slate-200 bg-white px-10 py-14 text-center shadow-[0_20px_50px_rgba(15,23,42,0.06)]">
                      <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
                        <Bot className="h-10 w-10 text-primary-700" />
                      </div>
                      <h3 className="font-sans text-3xl font-semibold text-slate-950">Start a conversation with ArASSIST</h3>
                      <p className="mt-3 text-lg text-slate-600">
                        Ask for institutional guidance, procedures, and administrative support.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
                    {selectedChat.messages.map((msg) => (
                      <div key={msg.id} className={`flex w-full ${msg.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={msg.sender === 'user' ? 'w-full max-w-[min(58ch,100%)]' : 'w-full max-w-4xl'}>
                          <div className={`mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${actorTone(msg)} ${
                            msg.sender === 'user' ? 'justify-end' : ''
                          }`}>
                            <span>{actorLabel(msg)}</span>
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

                {isSending && (
                  <div className="mt-6 flex justify-start">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-primary-700 shadow-sm ring-1 ring-slate-200">
                        <ShieldCheck className="h-5 w-5" />
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
                  {retryMessage ? (
                    <div className="mb-4 flex flex-col gap-3 rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="font-semibold">Last admin message did not send</p>
                        <p className="mt-1 text-amber-800">Retry the request after the network connection recovers.</p>
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
                    onSendMessage={(message, files) => void handleSendMessage(message, files || [])}
                    disabled={isSending}
                    placeholder="Ask ArASSIST"
                    onAttachmentAccepted={(files) => {
                      if (files.length > 0) {
                        showInfo({
                          title: 'Attachment added',
                          message: `${files.length} file${files.length > 1 ? 's were' : ' was'} attached to this admin message.`,
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
          )}
        </section>
      </div>
    </AdminShell>
  )
}

export default AdminChatPage
