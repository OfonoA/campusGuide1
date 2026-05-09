import React, { useState } from 'react'
import { X, MessageSquare, User } from 'lucide-react'
import { Ticket, TicketMessage } from '../../types'
import { shortTicketReference } from '../../utils/tickets'

interface TicketDetailModalProps {
  ticket: Ticket | null
  messages: TicketMessage[]
  onClose: () => void
  onUpdateStatus: (ticketId: number, status: Ticket['status']) => void
  onSendMessage: (ticketId: number, message: string) => void
}

const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  messages,
  onClose,
  onUpdateStatus,
  onSendMessage,
}) => {
  const [newMessage, setNewMessage] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  if (!ticket) return null

  const handleSendMessage = async () => {
    if (!newMessage.trim()) return

    setIsLoading(true)
    try {
      await onSendMessage(ticket.id, newMessage.trim())
      setNewMessage('')
    } catch (error) {
      console.error('Error sending message:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const getStatusColor = (status: Ticket['status']) => {
    switch (status) {
      case 'open':
        return 'bg-[#f3efe2] text-[#6f5311]'
      case 'assigned':
        return 'bg-[#e8f1ec] text-[#0A4B33]'
      case 'in_progress':
        return 'bg-[#fff1c7] text-[#8c6500]'
      case 'resolved':
        return 'bg-[#e7f5ec] text-[#1E6B3B]'
      default:
        return 'bg-slate-100 text-slate-700'
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-[1.8rem] border border-white/70 bg-white/92 backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-slate-200 p-6">
          <div className="flex items-center space-x-4">
            <div>
              <p className="eyebrow-label">Ticket detail</p>
              <h2 className="mt-2 text-xl font-semibold text-ink">
                Ticket #{shortTicketReference(ticket.reference_code)}
              </h2>
              <div className="mt-2 flex items-center space-x-3">
                <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(ticket.status)}`}>
                  {ticket.status.replace('_', ' ').toUpperCase()}
                </span>
                <span className="text-sm text-slate-500">
                  Created {formatDate(ticket.created_at)}
                </span>
              </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            <select
              value={ticket.status}
              onChange={(e) => onUpdateStatus(ticket.id, e.target.value as Ticket['status'])}
              className="rounded-2xl border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="in_progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
            
            <button
              onClick={onClose}
              className="rounded-xl p-2 transition-colors hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-[linear-gradient(180deg,#f7f9fd_0%,#eef3fa_100%)] p-6">
          <div className="space-y-4">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex items-start space-x-3 ${
                  message.sender_role === 'student' ? 'flex-row-reverse space-x-reverse' : ''
                }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  message.sender_role === 'student' ? 'bg-primary-600' : 'bg-slate-200'
                }`}>
                  {message.sender_role === 'student' ? (
                    <User className="w-4 h-4 text-white" />
                  ) : (
                    <MessageSquare className="w-4 h-4 text-slate-600" />
                  )}
                </div>
                
                <div className={`flex-1 max-w-lg ${
                  message.sender_role === 'student' ? 'text-right' : ''
                }`}>
                  <div className={`rounded-[1.2rem] px-4 py-3 shadow-sm ${
                    message.sender_role === 'student'
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-100 text-ink'
                  }`}>
                    <p className="text-sm">{message.content}</p>
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    {formatDate(message.created_at)} • {message.sender_role}
                  </p>
                </div>
              </div>
            ))}

            {messages.length === 0 && (
              <div className="py-8 text-center">
                <MessageSquare className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                <p className="text-slate-500">No messages yet</p>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-slate-200 p-6">
          <div className="flex space-x-3">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              placeholder="Type your response..."
              className="flex-1 rounded-2xl border border-slate-300 px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary-500"
              onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
            />
            <button
              onClick={handleSendMessage}
              disabled={!newMessage.trim() || isLoading}
              className="rounded-[1.1rem] bg-primary-600 px-6 py-2.5 text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isLoading ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TicketDetailModal
