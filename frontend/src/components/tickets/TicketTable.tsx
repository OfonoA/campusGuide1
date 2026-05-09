import React from 'react'
import { Ticket } from '../../types'
import { shortTicketReference } from '../../utils/tickets'

interface TicketTableProps {
  tickets: Ticket[]
  onViewTicket: (ticketId: number) => void
}

const TicketTable: React.FC<TicketTableProps> = ({ tickets, onViewTicket }) => {
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
    const date = new Date(dateString)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="overflow-hidden rounded-[1.6rem] border border-white/75 bg-white/84 backdrop-blur shadow-[0_22px_54px_rgba(15,23,42,0.08)]">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80">
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                TICKET REF
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                STATUS
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                CREATED DATE
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                LAST MESSAGE
              </th>
              <th className="px-6 py-4 text-left text-xs font-medium uppercase tracking-wider text-slate-500">
                ACTIONS
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {tickets.map((ticket) => (
              <tr key={ticket.id} className="transition-colors hover:bg-slate-50/80">
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm font-medium text-ink">
                    #{shortTicketReference(ticket.reference_code)}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(ticket.status)}`}>
                    {ticket.status.replace('_', ' ').toUpperCase()}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span className="text-sm text-ink">
                    {formatDate(ticket.created_at)}
                  </span>
                </td>
                <td className="px-6 py-4">
                  <div className="text-sm text-ink max-w-xs">
                    <p className="truncate">Conversation #{ticket.conversation_id}</p>
                    <p className="text-xs text-slate-500 mt-1">
                      From: Student #{ticket.student_id}
                    </p>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <button
                    onClick={() => onViewTicket(ticket.id)}
                    className="text-primary-700 hover:text-primary-800 text-sm font-medium transition-colors"
                  >
                    View {'>'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {tickets.length === 0 && (
        <div className="py-12 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
            <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-medium text-ink">No tickets found</h3>
          <p className="text-slate-500">Get started by creating a new ticket or adjust your filters.</p>
        </div>
      )}
    </div>
  )
}

export default TicketTable
