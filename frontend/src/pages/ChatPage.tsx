import React, { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Chat } from '../types'
import { chatAPI } from '../services/api'
import ChatArea from '../components/chat/ChatArea'
import StudentShell from '../components/student/StudentShell'

const ChatPage: React.FC = () => {
  const [chats, setChats] = useState<Chat[]>([])
  const [activeChat, setActiveChat] = useState<Chat | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  useEffect(() => {
    loadChats()
  }, [searchParams.toString()])

  const loadChats = async () => {
    try {
      const fetchedChats = await chatAPI.getChats()
      const normalized = fetchedChats.map(chat => ({
        ...chat,
        title: chat.title || `Conversation ${chat.id}`,
        messages: chat.messages || [],
      }))
      setChats(normalized)

      const requestedChatId = Number(searchParams.get('chat'))
      const wantsNewChat = searchParams.get('new') === '1'

      if (wantsNewChat) {
        setActiveChat({
          id: 0,
          title: 'New Inquiry',
          created_at: new Date().toISOString(),
          messages: [],
        })
        return
      }

      if (normalized.length > 0) {
        const selected = requestedChatId
          ? normalized.find((chat) => chat.id === requestedChatId) || normalized[0]
          : normalized[0]

        setActiveChat(selected)

        if (selected.id > 0) {
          loadChatMessages(selected.id)
        }
      } else {
        setActiveChat(null)
      }
    } catch (error) {
      console.error('Error loading chats:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadChatMessages = async (chatId: number) => {
    try {
      const messages = await chatAPI.getChatMessages(chatId)
      setChats(prev => prev.map(chat => 
        chat.id === chatId 
          ? { ...chat, messages }
          : chat
      ))
      setActiveChat(prev => prev && prev.id === chatId ? { ...prev, messages } : prev)
    } catch (error) {
      console.error('Error loading chat messages:', error)
    }
  }

  const handleChatSelect = async (chatId: number) => {
    setSearchParams({ chat: String(chatId) })
    const chat = chats.find(c => c.id === chatId)
    if (chat) {
      setActiveChat(chat)
      if (chat.messages.length === 0) {
        await loadChatMessages(chatId)
      }
    }
  }

  const handleNewChat = async () => {
    navigate('/app/chat?new=1')
    const newChat: Chat = {
      id: 0,
      title: 'New Inquiry',
      created_at: new Date().toISOString(),
      messages: [],
    }
    setActiveChat(newChat)
  }

  const handleChatUpdate = (updatedChat: Chat) => {
    setChats(prev => {
      const existing = prev.find(c => c.id === updatedChat.id)
      if (existing) {
        return prev.map(c => c.id === updatedChat.id ? updatedChat : c)
      } else {
        return [updatedChat, ...prev]
      }
    })
    
    if (!activeChat || activeChat.id === updatedChat.id || activeChat.id === 0) {
      setActiveChat(updatedChat)
    }
  }

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-600"></div>
      </div>
    )
  }

  return (
    <StudentShell
      chats={chats}
      activeChatId={activeChat?.id || null}
      onChatSelect={handleChatSelect}
      onNewChat={handleNewChat}
    >
      <ChatArea
        chat={activeChat}
        onChatUpdate={handleChatUpdate}
      />
    </StudentShell>
  )
}

export default ChatPage
