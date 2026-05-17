import React, { useEffect, useMemo, useState } from 'react'
import { BarChart3, CalendarRange, Download, FileText, Loader2, Users, X } from 'lucide-react'
import AdminShell from '../../components/admin/AdminShell'
import FeedbackToastStack from '../../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import {
  adminAPI,
  AdminPerformanceDetailResponse,
  AdminPerformanceOverviewResponse,
  AdminPerformanceRow,
  AdminPerformanceTicketDetail,
} from '../../services/api'

type RangeKey = '7' | '30' | '90' | 'custom'
type SortKey =
  | 'staff_username'
  | 'assigned'
  | 'not_started'
  | 'in_progress'
  | 'resolved_30d'
  | 'avg_response_time_hours'
  | 'avg_resolution_time_days'
  | 'sla_breaches'

const cardClass = 'rounded-[8px] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'

const formatHours = (value: number | null | undefined) => (value == null ? '-' : `${value.toFixed(1)} hrs`)
const formatDays = (value: number | null | undefined) => (value == null ? '-' : `${value.toFixed(1)} days`)
const formatPercent = (value: number | null | undefined) => (value == null ? '-' : `${Math.round(value)}%`)
const formatDate = (value: string | null | undefined) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date)
}

const statusBadgeClass = (status: string) => {
  const normalized = status.toLowerCase()
  if (normalized === 'assigned') return 'bg-[#F5EDD6] text-[#B8860B]'
  if (normalized === 'in_progress') return 'bg-[#E0F0EA] text-[#1E6B3B]'
  if (normalized === 'resolved') return 'bg-[#E0F0EA] text-[#1E6B3B]'
  return 'bg-[#F0F2F5] text-[#666666]'
}

const statusLabel = (status: string) => {
  if (status === 'in_progress') return 'IN PROGRESS'
  return status.replace('_', ' ').toUpperCase()
}

const statCardItems = (overview: AdminPerformanceOverviewResponse | null) => [
  { label: 'Total Tickets', value: overview?.stats.total_tickets ?? 0, tone: 'Tickets in selected range' },
  {
    label: 'Avg Response Time',
    value: formatHours(overview?.stats.avg_response_time_hours),
    tone: 'Average first staff response',
  },
  {
    label: 'Avg Resolution Time',
    value: formatDays(overview?.stats.avg_resolution_time_days),
    tone: 'Average ticket resolution speed',
  },
  {
    label: 'Response Target Compliance',
    value: formatPercent(overview?.stats.sla_compliance_percent),
    tone: 'Tickets resolved within target time',
  },
]

const rangeLabels: Record<RangeKey, string> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  custom: 'Custom',
}

const AdminPerformancePage: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('7')
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [startDate, setStartDate] = useState('2026-05-01')
  const [endDate, setEndDate] = useState('2026-05-09')
  const [overview, setOverview] = useState<AdminPerformanceOverviewResponse | null>(null)
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null)
  const [detail, setDetail] = useState<AdminPerformanceDetailResponse | null>(null)
  const [isOverviewLoading, setIsOverviewLoading] = useState(true)
  const [isDetailLoading, setIsDetailLoading] = useState(false)
  const { toasts, dismissToast, showError, showInfo } = useFeedbackToasts()

  useEffect(() => {
    let isMounted = true

    const loadOverview = async () => {
      if (range === 'custom' && (!startDate || !endDate)) {
        if (isMounted) {
          setOverview(null)
          setSelectedStaffId(null)
          setDetail(null)
          setIsOverviewLoading(false)
        }
        return
      }

      setIsOverviewLoading(true)
      try {
        const response = await adminAPI.getPerformanceOverview(
          range,
          range === 'custom' ? startDate : undefined,
          range === 'custom' ? endDate : undefined,
        )
        if (!isMounted) return
        setOverview(response)
      } catch (error: any) {
        if (!isMounted) return
        setOverview(null)
        showError({
          title: 'Performance data unavailable',
          message: error?.response?.data?.detail || 'We could not load staff analytics right now.',
        })
      } finally {
        if (isMounted) {
          setIsOverviewLoading(false)
        }
      }
    }

    setSelectedStaffId(null)
    setDetail(null)
    void loadOverview()

    return () => {
      isMounted = false
    }
  }, [range, startDate, endDate, showError])

  useEffect(() => {
    let isMounted = true

    const loadDetail = async () => {
      if (selectedStaffId == null) {
        setDetail(null)
        return
      }

      if (range === 'custom' && (!startDate || !endDate)) {
        setDetail(null)
        return
      }

      setIsDetailLoading(true)
      try {
        const response = await adminAPI.getPerformanceDetail(
          selectedStaffId,
          range,
          range === 'custom' ? startDate : undefined,
          range === 'custom' ? endDate : undefined,
        )
        if (!isMounted) return
        setDetail(response)
      } catch (error: any) {
        if (!isMounted) return
        setDetail(null)
        showError({
          title: 'Ticket detail unavailable',
          message: error?.response?.data?.detail || 'We could not load the staff ticket breakdown.',
        })
      } finally {
        if (isMounted) {
          setIsDetailLoading(false)
        }
      }
    }

    void loadDetail()

    return () => {
      isMounted = false
    }
  }, [selectedStaffId, range, startDate, endDate, showError])

  const rows = useMemo(() => {
    const baseRows = [...(overview?.rows || [])]
    if (!sortKey) return baseRows

    baseRows.sort((left, right) => {
      const a = left[sortKey]
      const b = right[sortKey]

      if (typeof a === 'string' && typeof b === 'string') {
        return sortDirection === 'asc' ? a.localeCompare(b) : b.localeCompare(a)
      }

      const numericA = a ?? -1
      const numericB = b ?? -1
      if (numericA < numericB) return sortDirection === 'asc' ? -1 : 1
      if (numericA > numericB) return sortDirection === 'asc' ? 1 : -1
      return 0
    })

    return baseRows
  }, [overview, sortDirection, sortKey])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
      return
    }
    setSortKey(key)
    setSortDirection('asc')
  }

  const handleRangeChange = (nextRange: RangeKey) => {
    setRange(nextRange)
    if (nextRange === 'custom') {
      showInfo({
        title: 'Custom range selected',
        message: 'Pick a start and end date to load staff analytics for that period.',
      })
      return
    }

    showInfo({
      title: 'Range updated',
      message: `Performance analytics refreshed for ${rangeLabels[nextRange].toLowerCase()}.`,
      duration: 2200,
    })
  }

  const handleExport = (format: 'CSV' | 'PDF') => {
    const runExport = async () => {
      if (range === 'custom' && (!startDate || !endDate)) {
        showError({
          title: 'Date range required',
          message: 'Select both custom dates before exporting this report.',
        })
        return
      }

      try {
        if (format === 'CSV') {
          await adminAPI.exportPerformanceCsv(
            range,
            range === 'custom' ? startDate : undefined,
            range === 'custom' ? endDate : undefined,
          )
        } else {
          await adminAPI.exportPerformancePdf(
            range,
            range === 'custom' ? startDate : undefined,
            range === 'custom' ? endDate : undefined,
          )
        }

        showInfo({
          title: `${format} export ready`,
          message: `Your ${format} report has started downloading.`,
          duration: 2200,
        })
      } catch (error: any) {
        showError({
          title: `${format} export failed`,
          message: error?.response?.data?.detail || `We could not generate the ${format} report right now.`,
        })
      }
    }

    void runExport()
  }

  const openDetail = (staffId: number) => {
    setSelectedStaffId(staffId)
  }

  const selectedStaff = rows.find((row) => row.staff_id === selectedStaffId) || null
  const detailRows: AdminPerformanceTicketDetail[] = detail?.tickets || []

  return (
    <AdminShell
      title="Staff Performance"
      subtitle="Track ticket handling speed, workload, and response target performance across officers"
      titleIcon={<BarChart3 />}
      workspaceLabel="Administration"
      fullWidth
      headerAction={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => handleExport('CSV')}
            className="inline-flex items-center gap-2 rounded-[8px] border border-[#1E6B3B]/15 bg-white px-3.5 py-2 text-sm font-semibold text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:bg-[#F0F2F5]"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('PDF')}
            className="inline-flex items-center gap-2 rounded-[8px] bg-[#B8860B] px-3.5 py-2 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:bg-[#9C7008]"
          >
            <FileText className="h-4 w-4" />
            Export PDF
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <h2 className="section-heading">
          Performance Snapshot
          <span className="section-subtitle">Review response speed, workload balance, and target pressure at a glance.</span>
        </h2>
        <section className={`${cardClass} p-4 sm:p-5`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="card-title">
                <CalendarRange className="h-4 w-4" />
                Date Range
              </h2>
              <p className="section-subtitle">Use the range filter to compare workload, response times, and resolution performance.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['7', '30', '90', 'custom'] as RangeKey[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleRangeChange(item)}
                  className={`rounded-[8px] px-4 py-2 text-sm font-semibold transition ${
                    range === item
                      ? 'bg-[#1E6B3B] text-white'
                      : 'border border-[#1E6B3B]/15 bg-white text-[#1E6B3B] hover:bg-[#F0F2F5]'
                  }`}
                >
                  {rangeLabels[item]}
                </button>
              ))}
            </div>
          </div>
          {range === 'custom' ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-[#333333]">
                Start date
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className="rounded-[8px] border border-[#1E6B3B]/15 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
              </label>
              <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-[#333333]">
                End date
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className="rounded-[8px] border border-[#1E6B3B]/15 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {statCardItems(overview).map((item) => (
            <article key={item.label} className={`${cardClass} border-t-4 border-t-[#1E6B3B] p-5`}>
              <p className="text-sm font-medium text-[#999999]">{item.label}</p>
              <p className="mt-3 text-[1.8rem] font-semibold leading-none text-[#B8860B]">{item.value}</p>
              <p className="mt-3 text-sm text-[#666666]">{item.tone}</p>
            </article>
          ))}
        </section>

        <section className={`${cardClass} overflow-hidden`}>
          <div className="border-b border-[#F0F2F5] px-5 py-4">
            <h2 className="card-title">
              <Users className="h-4 w-4" />
              Officer Workload Overview
            </h2>
            <p className="section-subtitle">Tap a workload number to open that officer's ticket detail in a pop-up.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#F0F2F5] text-left text-[#666666]">
                <tr>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('staff_username')}>Officer</button>
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('assigned')}>Assigned</button>
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('not_started')}>Not Started</button>
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('in_progress')}>In Progress</button>
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('resolved_30d')}>Resolved</button>
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('avg_response_time_hours')}>Avg Response</button>
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('avg_resolution_time_days')}>Avg Resolution</button>
                  </th>
                  <th className="px-5 py-3 font-semibold">
                    <button type="button" onClick={() => handleSort('sla_breaches')}>Target Breaches</button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {isOverviewLoading ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-[#666666]">
                      <div className="inline-flex items-center gap-3">
                        <Loader2 className="h-4 w-4 animate-spin text-[#1E6B3B]" />
                        Loading performance data...
                      </div>
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-5 py-12 text-center text-[#666666]">
                      No performance records were available for the selected range.
                    </td>
                  </tr>
                ) : (
                  rows.map((row: AdminPerformanceRow) => (
                    <tr
                      key={row.staff_id}
                      className={`border-t border-[#F0F2F5] transition hover:bg-[#F8FAFB] ${
                        selectedStaffId === row.staff_id ? 'bg-[#F8FAFB]' : ''
                      }`}
                    >
                      <td className="px-5 py-4 font-semibold text-[#333333]">{row.staff_username}</td>
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => openDetail(row.staff_id)} className="font-semibold text-[#1E6B3B] underline-offset-2 hover:underline">
                          {row.assigned}
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => openDetail(row.staff_id)} className="font-semibold text-[#1E6B3B] underline-offset-2 hover:underline">
                          {row.not_started}
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => openDetail(row.staff_id)} className="font-semibold text-[#1E6B3B] underline-offset-2 hover:underline">
                          {row.in_progress}
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => openDetail(row.staff_id)} className="font-semibold text-[#1E6B3B] underline-offset-2 hover:underline">
                          {row.resolved_30d}
                        </button>
                      </td>
                      <td className="px-5 py-4 text-[#666666]">{formatHours(row.avg_response_time_hours)}</td>
                      <td className="px-5 py-4 text-[#666666]">{formatDays(row.avg_resolution_time_days)}</td>
                      <td className="px-5 py-4">
                        <button type="button" onClick={() => openDetail(row.staff_id)} className="inline-flex rounded-full bg-[#F5EDD6] px-3 py-1 text-xs font-semibold text-[#B8860B]">
                          {row.sla_breaches}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {selectedStaffId != null ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-sm">
          <button
            type="button"
            aria-label="Close detail modal"
            className="absolute inset-0"
            onClick={() => setSelectedStaffId(null)}
          />
          <section className={`${cardClass} relative z-10 max-h-[85vh] w-full max-w-5xl overflow-hidden border-t-4 border-t-[#B8860B]`}>
            <div className="flex items-start justify-between gap-4 border-b border-[#F0F2F5] px-5 py-4">
              <div>
                <h2 className="card-title border-b-0 pb-0">
                  {selectedStaff ? `${selectedStaff.staff_username} Ticket Detail` : 'Ticket Detail'}
                </h2>
                <p className="section-subtitle">Ticket-level breakdown for the selected officer.</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedStaffId(null)}
                className="rounded-full p-2 text-[#666666] transition hover:bg-[#F0F2F5] hover:text-[#333333]"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[calc(85vh-84px)] overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-[#F0F2F5] text-left text-[#666666]">
                  <tr>
                    <th className="px-5 py-3 font-semibold">Ticket</th>
                    <th className="px-5 py-3 font-semibold">Student</th>
                    <th className="px-5 py-3 font-semibold">Status</th>
                    <th className="px-5 py-3 font-semibold">Assigned</th>
                    <th className="px-5 py-3 font-semibold">Response Time</th>
                    <th className="px-5 py-3 font-semibold">Resolution Time</th>
                  </tr>
                </thead>
                <tbody>
                  {isDetailLoading ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-[#666666]">
                        <div className="inline-flex items-center gap-3">
                          <Loader2 className="h-4 w-4 animate-spin text-[#1E6B3B]" />
                          Loading ticket detail...
                        </div>
                      </td>
                    </tr>
                  ) : detailRows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-5 py-12 text-center text-[#666666]">
                        No tickets matched this officer and date range.
                      </td>
                    </tr>
                  ) : (
                    detailRows.map((ticket: AdminPerformanceTicketDetail) => (
                      <tr key={ticket.ticket_id} className="border-t border-[#F0F2F5]">
                        <td className="px-5 py-4 font-medium text-[#333333]">{ticket.reference_code}</td>
                        <td className="px-5 py-4 text-[#666666]">{ticket.student_username || '-'}</td>
                        <td className="px-5 py-4">
                          <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass(ticket.status)}`}>
                            {statusLabel(ticket.status)}
                          </span>
                        </td>
                        <td className="px-5 py-4 text-[#666666]">{formatDate(ticket.assigned_date)}</td>
                        <td className="px-5 py-4 text-[#666666]">{formatHours(ticket.response_time_hours)}</td>
                        <td className="px-5 py-4 text-[#666666]">{formatDays(ticket.resolution_time_days)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
    </AdminShell>
  )
}

export default AdminPerformancePage
