import React, { useEffect, useMemo, useState } from 'react'
import { adminAPI, ticketsAPI } from '../../services/api'
import { Ticket, TicketMessage, User } from '../../types'
import AdminShell from '../../components/admin/AdminShell'
import AttachmentList from '../../components/chat/AttachmentList'
import FeedbackToastStack from '../../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import { Ban, CheckSquare, Clock3, Filter, MessageSquare, Search, TrendingUp, X } from 'lucide-react'
import { shortTicketReference } from '../../utils/tickets'
import { getErrorDetail } from '../../utils/errors'

interface AdminTicket extends Ticket {
  assigned_to?: number | null
  student_username?: string | null
  ar_assigned_username?: string | null
  resolved_at?: string | null
  false_generated?: boolean
  exclude_from_ingestion?: boolean
  recommended_officer_id?: number | null
  recommended_officer_username?: string | null
  recommendation_score?: number | null
  recommendation_reason?: string | null
  recommendation_created_at?: string | null
  auto_assigned?: boolean
  assignment_reviewed?: boolean
}

type TicketFilter = 'all' | 'open' | 'assigned' | 'in_progress' | 'resolved' | 'closed'
type AssignmentMode = 'recommend' | 'auto_review' | 'auto_assign'

const panelClass = 'overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
const panelHeaderClass = 'flex flex-col items-stretch justify-between gap-4 px-5 py-5 sm:px-6 lg:flex-row lg:items-center lg:gap-5'
const modalShellClass = 'w-full overflow-hidden border-t-4 border-t-[#1E6B3B] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] sm:max-w-5xl sm:rounded-[8px]'

const AdminInboxPage: React.FC = () => {
  const [tickets, setTickets] = useState<AdminTicket[]>([])
  const [staff, setStaff] = useState<User[]>([])
  const [assignments, setAssignments] = useState<Record<number, number>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<TicketFilter>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [selectedTicket, setSelectedTicket] = useState<AdminTicket | null>(null)
  const [messages, setMessages] = useState<TicketMessage[]>([])
  const [isMessagesLoading, setIsMessagesLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isRefreshingTickets, setIsRefreshingTickets] = useState(false)
  const [isResolvingFalseTicketId, setIsResolvingFalseTicketId] = useState<number | null>(null)
  const [isAcceptingRecommendationId, setIsAcceptingRecommendationId] = useState<number | null>(null)
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>('recommend')
  const [isSavingAssignmentMode, setIsSavingAssignmentMode] = useState(false)
  const [isReviewingAssignmentId, setIsReviewingAssignmentId] = useState<number | null>(null)
  const pageSize = 10
  const { toasts, dismissToast, showSuccess, showError } = useFeedbackToasts()

  const loadData = async (background = false) => {
    if (background) {
      setIsRefreshingTickets(true)
    } else {
      setIsLoading(true)
    }
    setLoadError(null)
    try {
      const [ticketData, usersData] = await Promise.all([
        adminAPI.getTickets(),
        adminAPI.listUsers(),
      ])
      setTickets(ticketData)
      setStaff(usersData.filter((user) => user.role === 'ar_staff'))
      const modeData = await adminAPI.getAssignmentMode()
      setAssignmentMode(modeData.mode)
    } catch (error) {
      console.error('Error loading admin inbox:', error)
      setLoadError('Could not load tickets. Check that the admin API is running and the current account has admin access.')
    } finally {
      setIsLoading(false)
      setIsRefreshingTickets(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const handleAssign = async (ticketId: number) => {
    const officerId = assignments[ticketId]
    if (!officerId) return
    const officer = staff.find((member) => member.id === officerId)
    const currentTicket = tickets.find((ticket) => ticket.id === ticketId)

    try {
      await adminAPI.assignTicket(ticketId, officerId)
      await loadData(true)
      setLoadError(null)
      showSuccess({
        title: 'Ticket assigned',
        message: `${shortTicketReference(currentTicket?.reference_code || `Ticket ${ticketId}`)} is now assigned to ${officer?.username || 'the selected officer'}.`,
      })
    } catch (error) {
      console.error('Error assigning ticket:', error)
      setLoadError('Ticket assignment failed. Refresh the page and verify that the selected officer still exists.')
      showError({
        title: 'Assignment failed',
        message: getErrorDetail(error, 'The ticket could not be assigned.'),
      })
    }
  }

  const openConversation = async (ticket: AdminTicket) => {
    setSelectedTicket(ticket)
    setIsMessagesLoading(true)
    try {
      const data = await ticketsAPI.getTicketMessages(ticket.id)
      setMessages(data)
    } catch (error) {
      console.error('Error loading ticket conversation:', error)
      setMessages([])
    } finally {
      setIsMessagesLoading(false)
    }
  }

  const closeConversation = () => {
    setSelectedTicket(null)
    setMessages([])
  }

  const handleResolveFalseTicket = async (ticket: AdminTicket) => {
    const confirmed = window.confirm(
      `Mark ticket ${shortTicketReference(ticket.reference_code)} as falsely generated and exclude it from ingestion?`
    )
    if (!confirmed) return

    const note = window.prompt(
      'Optional admin note for the audit trail:',
      'Marked as falsely/unintentionally generated.'
    )

    setIsResolvingFalseTicketId(ticket.id)
    try {
      await adminAPI.resolveFalseTicket(ticket.id, note || undefined)
      await loadData(true)
      setLoadError(null)
      if (selectedTicket?.id === ticket.id) {
        setSelectedTicket((current) =>
          current
            ? {
                ...current,
                status: 'resolved',
                false_generated: true,
                exclude_from_ingestion: true,
              }
            : current
        )
      }
      showSuccess({
        title: 'Ticket excluded',
        message: `${shortTicketReference(ticket.reference_code)} was marked as false and will not be ingested.`,
      })
    } catch (error) {
      console.error('Error resolving false ticket:', error)
      showError({
        title: 'Action failed',
        message: getErrorDetail(error, 'The ticket could not be marked as false.'),
      })
    } finally {
      setIsResolvingFalseTicketId(null)
    }
  }

  const handleAcceptRecommendation = async (ticket: AdminTicket) => {
    if (!ticket.recommended_officer_id) return

    setIsAcceptingRecommendationId(ticket.id)
    try {
      await adminAPI.acceptRecommendation(ticket.id)
      await loadData(true)
      setLoadError(null)
      if (selectedTicket?.id === ticket.id) {
        setSelectedTicket((current) =>
          current
            ? {
                ...current,
                status: 'assigned',
                assigned_to: current.recommended_officer_id ?? current.assigned_to,
                ar_assigned_username: current.recommended_officer_username ?? current.ar_assigned_username,
              }
            : current
        )
      }
      showSuccess({
        title: 'Recommendation accepted',
        message: `${shortTicketReference(ticket.reference_code)} was assigned to ${ticket.recommended_officer_username || 'the recommended officer'}.`,
      })
    } catch (error) {
      console.error('Error accepting recommendation:', error)
      showError({
        title: 'Recommendation failed',
        message: getErrorDetail(error, 'The recommendation could not be accepted.'),
      })
    } finally {
      setIsAcceptingRecommendationId(null)
    }
  }

  const handleAssignmentModeChange = async (mode: AssignmentMode) => {
    if (mode === assignmentMode) return
    setIsSavingAssignmentMode(true)
    try {
      const data = await adminAPI.updateAssignmentMode(mode)
      setAssignmentMode(data.mode)
      showSuccess({
        title: 'Assignment mode updated',
        message:
          data.mode === 'auto_review'
            ? 'New tickets will now auto-assign to the recommended officer and await admin review.'
            : data.mode === 'auto_assign'
              ? 'New tickets will now auto-assign to the recommended officer without waiting for admin review.'
              : 'New tickets will stay open with recommendation only.',
      })
    } catch (error) {
      console.error('Error updating assignment mode:', error)
      showError({
        title: 'Mode update failed',
        message: getErrorDetail(error, 'The assignment mode could not be updated.'),
      })
    } finally {
      setIsSavingAssignmentMode(false)
    }
  }

  const handleMarkAssignmentReviewed = async (ticket: AdminTicket) => {
    setIsReviewingAssignmentId(ticket.id)
    try {
      await adminAPI.markAssignmentReviewed(ticket.id)
      await loadData(true)
      if (selectedTicket?.id === ticket.id) {
        setSelectedTicket((current) => (current ? { ...current, assignment_reviewed: true } : current))
      }
      showSuccess({
        title: 'Assignment reviewed',
        message: `${shortTicketReference(ticket.reference_code)} was marked as reviewed.`,
      })
    } catch (error) {
      console.error('Error marking assignment reviewed:', error)
      showError({
        title: 'Review update failed',
        message: getErrorDetail(error, 'The automated assignment could not be marked as reviewed.'),
      })
    } finally {
      setIsReviewingAssignmentId(null)
    }
  }

  const filteredTickets = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return tickets.filter((ticket) => {
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'resolved'
            ? ticket.status === 'resolved' || ticket.status === 'closed'
          : ticket.status === statusFilter

      const matchesQuery =
        !query ||
        shortTicketReference(ticket.reference_code).toLowerCase().includes(query) ||
        (ticket.student_username || '').toLowerCase().includes(query)

      return matchesStatus && matchesQuery
    })
  }, [searchTerm, statusFilter, tickets])

  const totalPages = Math.max(1, Math.ceil(filteredTickets.length / pageSize))

  const paginatedTickets = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredTickets.slice(start, start + pageSize)
  }, [currentPage, filteredTickets])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, statusFilter])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const metrics = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10)
    const resolvedToday = tickets.filter((ticket) => {
      if (ticket.status !== 'resolved' && ticket.status !== 'closed') return false
      return ((ticket.resolved_at || ticket.created_at || '').slice(0, 10)) === todayKey
    }).length

    return {
      open: tickets.filter((ticket) => ticket.status === 'open').length,
      assigned: tickets.filter((ticket) => ticket.status === 'assigned').length,
      inProgress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
      resolvedToday,
    }
  }, [tickets])

  const statusTone = (status: string) => {
    if (status === 'resolved' || status === 'closed') return 'bg-slate-300 text-[#333333]'
    if (status === 'in_progress') return 'bg-[#1E6B3B] text-white'
    return 'bg-[#D4AF37] text-[#333333]'
  }

  const formatDate = (value: string) =>
    new Date(value).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })

  const cards = [
    { label: 'Open Tickets', value: metrics.open, icon: TrendingUp, accent: 'border-l-[4px] border-[#1E6B3B]', meta: '', metaClass: 'text-slate-400' },
    { label: 'Assigned Tickets', value: metrics.assigned, icon: CheckSquare, accent: '', meta: '', metaClass: 'text-slate-400' },
    { label: 'In Progress', value: metrics.inProgress, icon: Clock3, accent: '', meta: '', metaClass: 'text-slate-400' },
    {
      label: 'Resolved Today',
      value: metrics.resolvedToday,
      icon: CheckSquare,
      accent: '',
      meta: metrics.resolvedToday === 0 ? 'No resolutions yet' : `${metrics.resolvedToday} resolved today`,
      metaClass: 'text-xs text-slate-500',
    },
  ]

  return (
    <AdminShell
      title="Admin Operations"
      subtitle="Ticket assignment and support oversight"
      theme="staff"
      workspaceLabel="ADMIN WORKSPACE"
      fullWidth
    >
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="space-y-5">
        <div className="grid gap-4 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.label}
                className="metric-card border-t-4 border-t-[#1E6B3B]"
              >
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {card.label}
                </p>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div className="flex items-end gap-3">
                    <span className="text-[2.1rem] font-semibold leading-none text-[#D4AF37]">
                      {card.value}
                    </span>
                    {card.meta ? (
                      <span className={`${card.metaClass}`}>{card.meta}</span>
                    ) : null}
                  </div>
                  <Icon className="h-5 w-5 text-[#1E6B3B]" />
                </div>
              </div>
            )
          })}
        </div>

        <section className={panelClass}>
          <div className={panelHeaderClass}>
            <div>
              <h2 className="text-[1.7rem] font-semibold text-[#1E6B3B]">Ticket Inbox</h2>
              {isRefreshingTickets ? (
                <p className="mt-1 text-sm text-slate-500">Refreshing ticket list...</p>
              ) : null}
              <p className="mt-1 text-sm text-slate-500">
                Assignment mode:{' '}
                <span className="font-semibold text-slate-700">
                  {assignmentMode === 'auto_review'
                    ? 'Auto-Assign + Review'
                    : assignmentMode === 'auto_assign'
                      ? 'Full Auto-Assign'
                      : 'Recommendation Only'}
                </span>
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
              <div className="inline-flex rounded-[8px] border border-slate-200 bg-[#1E6B3B] p-1 shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                <button
                  type="button"
                  onClick={() => void handleAssignmentModeChange('recommend')}
                  disabled={isSavingAssignmentMode}
                  className={`rounded-[8px] px-3 py-2 text-sm font-semibold transition ${
                    assignmentMode === 'recommend' ? 'bg-[#D4AF37] text-[#333333]' : 'text-white hover:bg-white/10'
                  } disabled:opacity-50`}
                >
                  Recommendation Only
                </button>
                <button
                  type="button"
                  onClick={() => void handleAssignmentModeChange('auto_review')}
                  disabled={isSavingAssignmentMode}
                  className={`rounded-[8px] px-3 py-2 text-sm font-semibold transition ${
                    assignmentMode === 'auto_review' ? 'bg-[#D4AF37] text-[#333333]' : 'text-white hover:bg-white/10'
                  } disabled:opacity-50`}
                >
                  Auto-Assign + Review
                </button>
                <button
                  type="button"
                  onClick={() => void handleAssignmentModeChange('auto_assign')}
                  disabled={isSavingAssignmentMode}
                  className={`rounded-[8px] px-3 py-2 text-sm font-semibold transition ${
                    assignmentMode === 'auto_assign' ? 'bg-[#D4AF37] text-[#333333]' : 'text-white hover:bg-white/10'
                  } disabled:opacity-50`}
                >
                  Full Auto-Assign
                </button>
              </div>
              <div className="relative min-w-0 flex-1 sm:min-w-[260px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#1E6B3B]" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search reference..."
                  className="w-full rounded-[8px] border border-slate-200 bg-[#F5F5F5] px-12 py-2.5 text-sm text-[#333333] outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/30"
                />
              </div>
              <div className="inline-flex items-center gap-2 rounded-[8px] border border-slate-200 bg-white px-4 py-2.5 text-sm text-[#1E6B3B] transition hover:bg-[#F5F5F5]">
                <Filter className="h-4 w-4" />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as TicketFilter)}
                  className="bg-transparent text-sm font-medium text-slate-700 outline-none"
                >
                  <option value="all">All</option>
                  <option value="open">Open</option>
                  <option value="assigned">Assigned</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
            </div>
          </div>

          <div className="hidden grid-cols-[1fr_1.2fr_0.9fr_1.35fr_1.2fr_0.9fr_0.9fr_1fr] gap-5 bg-[#F0F2F5] px-7 py-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1E6B3B] lg:grid">
            <div>Reference</div>
            <div>Student</div>
            <div>Status</div>
            <div>Recommendation</div>
            <div>Assigned Officer</div>
            <div>Created</div>
            <div>Resolved</div>
            <div>Actions</div>
          </div>

          {isLoading ? (
            <div className="px-7 py-8 text-sm text-slate-500">Loading tickets...</div>
          ) : loadError ? (
            <div className="px-7 py-8 text-sm text-rose-600">{loadError}</div>
          ) : filteredTickets.length === 0 ? (
            <div className="px-7 py-8 text-sm text-slate-500">No tickets found.</div>
          ) : (
            paginatedTickets.map((ticket, idx) => (
              <React.Fragment key={ticket.id}>
                <div
                  className={`hidden grid-cols-[1fr_1.2fr_0.9fr_1.35fr_1.2fr_0.9fr_0.9fr_1fr] gap-5 border-b border-slate-100 px-7 py-6 lg:grid ${
                    ticket.status === 'open' ? 'bg-[#F5F5F5] border-l-4 border-l-[#D4AF37]' : 'bg-[#F5F5F5]'
                  }`}
                >
                  <div className="text-base font-semibold leading-tight text-[#1E6B3B]">
                    {shortTicketReference(ticket.reference_code)}
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#FEF9E6] text-xs font-semibold text-[#1E6B3B]">
                      {(ticket.student_username || `S${ticket.student_id}`).slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-[1.05rem] font-semibold leading-tight text-slate-900">
                        {ticket.student_username || `Student #${ticket.student_id}`}
                      </p>
                    </div>
                  </div>

                  <div>
                    <span className={`inline-flex rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] shadow-sm ${statusTone(ticket.status)}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                    {ticket.false_generated ? (
                      <span className="mt-2 inline-flex rounded-md bg-rose-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                        False Ticket
                      </span>
                    ) : null}
                    {ticket.auto_assigned ? (
                      <span className={`mt-2 inline-flex rounded-md px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        ticket.assignment_reviewed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {ticket.assignment_reviewed ? 'Auto-Assigned Reviewed' : 'Auto-Assigned Pending Review'}
                      </span>
                    ) : null}
                  </div>

                  <div>
                    {ticket.recommended_officer_username ? (
                      <div className="rounded-[8px] border border-[#D4AF37]/20 bg-[#FEF9E6] p-3 shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1E6B3B]">
                          System Recommendation
                        </p>
                        <div className="mt-2 space-y-2">
                          <p className="text-sm font-semibold text-slate-900">
                            {ticket.recommended_officer_username}
                          </p>
                          <p className="text-xs text-slate-500">
                            {ticket.recommendation_reason || 'Recommendation available'}
                          </p>
                          {typeof ticket.recommendation_score === 'number' ? (
                            <p className="text-[11px] font-medium text-[#D4AF37]">
                              Active load {ticket.recommendation_score.toFixed(0)}
                            </p>
                          ) : null}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {ticket.status === 'open' && ticket.recommended_officer_id ? (
                            <button
                              onClick={() => void handleAcceptRecommendation(ticket)}
                              disabled={isAcceptingRecommendationId === ticket.id || (ticket.auto_assigned && !ticket.assignment_reviewed)}
                              className="rounded-[8px] bg-[#D4AF37] px-3 py-2 text-xs font-semibold text-[#333333] transition hover:bg-[#c49c27] disabled:opacity-50"
                            >
                              Accept Recommendation
                            </button>
                          ) : null}
                          {ticket.auto_assigned && !ticket.assignment_reviewed ? (
                            <button
                              onClick={() => void handleMarkAssignmentReviewed(ticket)}
                              disabled={isReviewingAssignmentId === ticket.id}
                              className="rounded-[8px] border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                            >
                              Mark Reviewed
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm italic text-slate-500">No recommendation</p>
                    )}
                  </div>

                  <div>
                    {ticket.status === 'open' || ticket.status === 'assigned' ? (
                      <select
                        className="w-full rounded-[8px] border border-slate-200 bg-[#F5F5F5] px-4 py-2.5 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-[#D4AF37]/20"
                        value={assignments[ticket.id] || ticket.assigned_to || ''}
                        onChange={(e) => setAssignments((prev) => ({ ...prev, [ticket.id]: Number(e.target.value) }))}
                      >
                        <option value="">Unassigned</option>
                        {staff.map((member) => (
                          <option key={member.id} value={member.id}>
                            {member.username}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-sm italic text-slate-700">
                        {ticket.ar_assigned_username || 'Unassigned'}
                      </p>
                    )}
                  </div>

                  <div className="text-sm text-slate-700">{formatDate(ticket.created_at)}</div>
                  <div className="text-sm text-slate-500">
                    {(ticket.status === 'resolved' || ticket.status === 'closed') && ticket.resolved_at ? formatDate(ticket.resolved_at) : '—'}
                  </div>

                  <div>
                    {ticket.status === 'open' || ticket.status === 'assigned' ? (
                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          onClick={() => void openConversation(ticket)}
                          className="text-sm font-semibold text-[#1E6B3B] hover:text-[#D4AF37]"
                        >
                          {ticket.status === 'open' ? 'View' : 'Review'}
                        </button>
                        <button
                          onClick={() => handleAssign(ticket.id)}
                          disabled={!(assignments[ticket.id] || ticket.assigned_to)}
                          className="rounded-[8px] bg-[#1E6B3B] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border hover:border-[#D4AF37] disabled:opacity-50"
                        >
                          {ticket.status === 'assigned' ? 'Reassign' : 'Assign'}
                        </button>
                        {!ticket.false_generated ? (
                          <button
                            onClick={() => void handleResolveFalseTicket(ticket)}
                            disabled={isResolvingFalseTicketId === ticket.id}
                            className="rounded-[8px] border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            False Ticket
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => void openConversation(ticket)}
                          className="text-sm font-semibold text-[#1E6B3B] hover:text-[#D4AF37]"
                        >
                          Review
                        </button>
                        {!ticket.false_generated && ticket.status !== 'resolved' && ticket.status !== 'closed' ? (
                          <button
                            onClick={() => void handleResolveFalseTicket(ticket)}
                            disabled={isResolvingFalseTicketId === ticket.id}
                            className="rounded-[8px] border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            False Ticket
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>

                <div className={`border-b border-slate-100 px-5 py-5 lg:hidden ${ticket.status === 'open' ? 'border-l-4 border-l-[#D4AF37] bg-[#F5F5F5]' : 'bg-[#F5F5F5]'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-base font-semibold text-[#1E6B3B]">
                        {shortTicketReference(ticket.reference_code)}
                      </p>
                      <p className="mt-1 text-sm font-medium text-slate-900">
                        {ticket.student_username || `Student #${ticket.student_id}`}
                      </p>
                    </div>
                    <span className={`inline-flex rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] shadow-sm ${statusTone(ticket.status)}`}>
                      {ticket.status.replace('_', ' ')}
                    </span>
                  </div>
                  {ticket.false_generated ? (
                    <div className="mt-2">
                      <span className="inline-flex rounded-md bg-rose-100 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-rose-700">
                        False Ticket
                      </span>
                    </div>
                  ) : null}
                  {ticket.auto_assigned ? (
                    <div className="mt-2">
                      <span className={`inline-flex rounded-md px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${
                        ticket.assignment_reviewed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                      }`}>
                        {ticket.assignment_reviewed ? 'Auto-Assigned Reviewed' : 'Auto-Assigned Pending Review'}
                      </span>
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 text-sm text-slate-600 sm:grid-cols-2">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Assigned Officer</p>
                      {ticket.status === 'open' || ticket.status === 'assigned' ? (
                        <select
                          className="mt-1.5 w-full rounded-[8px] border border-slate-200 bg-[#F5F5F5] px-4 py-2.5 text-sm text-slate-700 outline-none focus:ring-4 focus:ring-[#D4AF37]/20"
                          value={assignments[ticket.id] || ticket.assigned_to || ''}
                          onChange={(e) => setAssignments((prev) => ({ ...prev, [ticket.id]: Number(e.target.value) }))}
                        >
                          <option value="">Unassigned</option>
                          {staff.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.username}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <p className="mt-1.5">{ticket.ar_assigned_username || 'Unassigned'}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Created</p>
                      <p className="mt-1.5">{formatDate(ticket.created_at)}</p>
                    </div>
                    {(ticket.status === 'resolved' || ticket.status === 'closed') ? (
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Resolved</p>
                        <p className="mt-1.5">{ticket.resolved_at ? formatDate(ticket.resolved_at) : '—'}</p>
                      </div>
                    ) : null}
                    <div className="sm:col-span-2">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Recommendation</p>
                      {ticket.recommended_officer_username ? (
                        <div className="mt-1.5 rounded-[8px] border border-[#D4AF37]/20 bg-[#FEF9E6] p-3 shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#1E6B3B]">
                            System Recommendation
                          </p>
                          <div className="mt-2 space-y-2">
                            <p className="font-medium text-slate-900">{ticket.recommended_officer_username}</p>
                            <p className="text-xs text-slate-500">{ticket.recommendation_reason || 'Recommendation available'}</p>
                            {typeof ticket.recommendation_score === 'number' ? (
                              <p className="text-xs font-medium text-[#D4AF37]">
                                Active load {ticket.recommendation_score.toFixed(0)}
                              </p>
                            ) : null}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {ticket.status === 'open' && ticket.recommended_officer_id ? (
                              <button
                                onClick={() => void handleAcceptRecommendation(ticket)}
                                disabled={isAcceptingRecommendationId === ticket.id || (ticket.auto_assigned && !ticket.assignment_reviewed)}
                                className="rounded-[8px] bg-[#D4AF37] px-3 py-2 text-xs font-semibold text-[#333333] transition hover:bg-[#c49c27] disabled:opacity-50"
                              >
                                Accept Recommendation
                              </button>
                            ) : null}
                            {ticket.auto_assigned && !ticket.assignment_reviewed ? (
                              <button
                                onClick={() => void handleMarkAssignmentReviewed(ticket)}
                                disabled={isReviewingAssignmentId === ticket.id}
                                className="rounded-[8px] border border-emerald-200 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                              >
                                Mark Reviewed
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1.5 text-slate-500">No recommendation</p>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <button
                      onClick={() => void openConversation(ticket)}
                      className="text-sm font-semibold text-[#1E6B3B] hover:text-[#D4AF37]"
                    >
                      {ticket.status === 'open' ? 'View' : 'Review'}
                    </button>
                    {ticket.status === 'open' || ticket.status === 'assigned' ? (
                      <button
                        onClick={() => handleAssign(ticket.id)}
                        disabled={!(assignments[ticket.id] || ticket.assigned_to)}
                        className="rounded-[8px] bg-[#1E6B3B] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border hover:border-[#D4AF37] disabled:opacity-50"
                      >
                        {ticket.status === 'assigned' ? 'Reassign' : 'Assign'}
                      </button>
                    ) : null}
                    {!ticket.false_generated && ticket.status !== 'resolved' && ticket.status !== 'closed' ? (
                      <button
                        onClick={() => void handleResolveFalseTicket(ticket)}
                        disabled={isResolvingFalseTicketId === ticket.id}
                        className="rounded-[8px] border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        False Ticket
                      </button>
                    ) : null}
                  </div>
                </div>
              </React.Fragment>
            ))
          )}

          <div className="flex flex-col gap-3 px-5 py-5 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p>
              Showing {filteredTickets.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
              {Math.min(currentPage * pageSize, filteredTickets.length)} of {filteredTickets.length} tickets
            </p>
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                className="text-slate-400 disabled:opacity-40"
              >
                ‹
              </button>
              {Array.from({ length: totalPages }, (_, idx) => idx + 1).slice(0, 5).map((page) => (
                <button
                  key={page}
                  type="button"
                  onClick={() => setCurrentPage(page)}
                  className={`rounded-[8px] px-3 py-2 ${
                    currentPage === page ? 'bg-[#1E6B3B] text-white' : 'text-slate-700 hover:text-[#D4AF37]'
                  }`}
                >
                  {page}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                className="text-slate-400 disabled:opacity-40"
              >
                ›
              </button>
            </div>
          </div>
        </section>
      </div>

      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 px-0 py-0 backdrop-blur-sm sm:items-center sm:px-4 sm:py-6">
          <div className={`flex max-h-[92vh] min-h-[70vh] flex-col ${modalShellClass} sm:min-h-0 sm:max-h-[88vh]`}>
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4 sm:px-7 sm:py-5">
              <div>
                <h3 className="text-[1.6rem] font-semibold text-slate-950">
                  Ticket {shortTicketReference(selectedTicket.reference_code)}
                </h3>
                <p className="mt-1 text-sm text-slate-500">
                  {selectedTicket.student_username || `Student #${selectedTicket.student_id}`}
                  {selectedTicket.ar_assigned_username ? ` • ${selectedTicket.ar_assigned_username}` : ''}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] shadow-sm ${statusTone(selectedTicket.status)}`}>
                    {selectedTicket.status.replace('_', ' ')}
                  </span>
                  {selectedTicket.recommended_officer_username ? (
                    <span className="inline-flex rounded-md bg-[#FEF9E6] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#1E6B3B]">
                      Recommended: {selectedTicket.recommended_officer_username}
                    </span>
                  ) : null}
                  {selectedTicket.auto_assigned ? (
                    <span className={`inline-flex rounded-md px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] ${
                      selectedTicket.assignment_reviewed ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {selectedTicket.assignment_reviewed ? 'Auto-Assigned Reviewed' : 'Auto-Assigned Pending Review'}
                    </span>
                  ) : null}
                  {selectedTicket.false_generated ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-rose-700">
                      <Ban className="h-3.5 w-3.5" />
                      False Ticket
                    </span>
                  ) : null}
                  {selectedTicket.exclude_from_ingestion ? (
                    <span className="inline-flex rounded-md bg-amber-100 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                      Excluded From Ingestion
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {selectedTicket.status === 'open' && selectedTicket.recommended_officer_id ? (
                  <button
                    type="button"
                    onClick={() => void handleAcceptRecommendation(selectedTicket)}
                    disabled={isAcceptingRecommendationId === selectedTicket.id || (selectedTicket.auto_assigned && !selectedTicket.assignment_reviewed)}
                    className="rounded-[8px] bg-[#D4AF37] px-3 py-2 text-sm font-semibold text-[#333333] transition hover:bg-[#c49c27] disabled:opacity-50"
                  >
                    Accept Recommendation
                  </button>
                ) : null}
                {selectedTicket.auto_assigned && !selectedTicket.assignment_reviewed ? (
                  <button
                    type="button"
                    onClick={() => void handleMarkAssignmentReviewed(selectedTicket)}
                    disabled={isReviewingAssignmentId === selectedTicket.id}
                    className="rounded-[8px] border border-emerald-200 px-3 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50"
                  >
                    Mark Reviewed
                  </button>
                ) : null}
                {!selectedTicket.false_generated && selectedTicket.status !== 'resolved' && selectedTicket.status !== 'closed' ? (
                  <button
                    type="button"
                    onClick={() => void handleResolveFalseTicket(selectedTicket)}
                    disabled={isResolvingFalseTicketId === selectedTicket.id}
                    className="rounded-[8px] border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                  >
                    Resolve as False
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={closeConversation}
                  className="rounded-full p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Close conversation"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto bg-[#F0F2F5] px-5 py-5 sm:px-7 sm:py-6">
              {isMessagesLoading ? (
                <div className="text-sm text-slate-500">Loading conversation...</div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-14 text-center text-slate-500">
                  <MessageSquare className="mb-3 h-10 w-10 text-slate-300" />
                  <p>No messages found for this ticket.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {messages.map((message) => {
                    const isOfficer = message.sender_role === 'ar_staff'
                    const isBot = message.sender_role === 'bot'
                    return (
                      <div key={message.id} className={isOfficer ? 'flex justify-end' : 'flex justify-start'}>
                        <div className="max-w-[min(760px,100%)]">
                          <div className={`mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${
                            isOfficer ? 'justify-end text-[#1E6B3B]' : isBot ? 'text-[#1E6B3B]' : 'text-slate-500'
                          }`}>
                            <span>{message.sender_alias || message.sender_role}</span>
                            <span className="font-normal tracking-normal text-slate-400">
                              {new Date(message.created_at).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                          <div className={`rounded-[8px] px-5 py-4 shadow-[0_2px_6px_rgba(0,0,0,0.05)] ${
                            isOfficer
                              ? 'bg-[#1E6B3B] text-white'
                              : isBot
                                ? 'border border-[#D4AF37]/25 bg-[#FEF9E6] text-[#1E6B3B]'
                                : 'border border-slate-200 bg-white text-slate-800'
                          }`}>
                            <p className="text-sm leading-7 whitespace-pre-wrap break-words">
                              {message.content}
                            </p>
                            <AttachmentList attachments={message.attachments} tone={isOfficer ? 'dark' : 'light'} />
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </AdminShell>
  )
}

export default AdminInboxPage
