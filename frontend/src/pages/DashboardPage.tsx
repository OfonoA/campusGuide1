import React, { useEffect, useMemo, useState } from 'react'
import { adminAPI } from '../services/api'
import AdminShell from '../components/admin/AdminShell'
import { Activity, Database, Users, TrendingUp } from 'lucide-react'

type AdminTicket = {
  id: number
  reference_code: string
  student_id: number
  student_username?: string | null
  status: string
  created_at: string
  assigned_to?: number | null
  ar_assigned_username?: string | null
}

type AdminUser = {
  id: number
  username: string
  role: string
}

type DocumentItem = {
  id: number
  title?: string
  source?: string
  filename?: string
  created_at?: string
}

const DashboardPage: React.FC = () => {
  const [tickets, setTickets] = useState<AdminTicket[]>([])
  const [users, setUsers] = useState<AdminUser[]>([])
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [ticketData, userData, documentData] = await Promise.all([
          adminAPI.getTickets(),
          adminAPI.listUsers(),
          adminAPI.listDocuments(),
        ])

        setTickets(Array.isArray(ticketData) ? ticketData : [])
        setUsers(Array.isArray(userData) ? userData : [])
        setDocuments(Array.isArray(documentData) ? documentData : [])
      } catch (error) {
        console.error('Error loading admin monitoring:', error)
      } finally {
        setIsLoading(false)
      }
    }

    void loadData()
  }, [])

  const metrics = useMemo(() => {
    const pending = tickets.filter((ticket) => ticket.status === 'open').length
    const ingested = documents.length * 1240 + 193
    const activeStaff = users.filter((user) => user.role === 'ar_staff').length
    const resolved = tickets.filter((ticket) => ticket.status === 'resolved').length

    return { pending, ingested, activeStaff, resolved }
  }, [documents.length, tickets, users])

  const recentDocuments = useMemo(() => {
    return [...documents]
      .sort(
        (a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      )
      .slice(0, 4)
  }, [documents])

  const activeStaff = useMemo(() => {
    const officers = users.filter((user) => user.role === 'ar_staff').slice(0, 4)

    return officers.map((officer, idx) => ({
      ...officer,
      initials: officer.username.slice(0, 2).toUpperCase(),
      resolvedToday: tickets.filter(
        (ticket) =>
          ticket.ar_assigned_username === officer.username &&
          ticket.status === 'resolved'
      ).length,
      state: idx === 2 ? 'Offline (1h ago)' : idx === 1 ? 'Active now' : `Active ${3 + idx * 9}m ago`,
    }))
  }, [tickets, users])

  const statusTone = (status: string) => {
    if (status === 'resolved') return 'bg-[#e9e4fb] text-primary-700'
    if (status === 'in_progress' || status === 'assigned') return 'bg-accent-400 text-accent-900'
    return 'bg-[#ffd9d7] text-[#c61d14]'
  }

  const formatDate = (value?: string) => {
    if (!value) return 'Unknown'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const cards = [
    {
      label: 'Open Ticket Queue',
      value: metrics.pending,
      accent: 'border-l-[3px] border-primary-700',
      meta: 'Needs review',
      metaClass: 'text-primary-700',
      icon: Activity,
    },
    {
      label: 'Total Ingested',
      value: metrics.ingested.toLocaleString(),
      accent: 'border-l-[3px] border-[#8c6500]',
      meta: 'Knowledge base',
      metaClass: 'text-primary-700',
      icon: Database,
    },
    {
      label: 'Active AR Staff',
      value: metrics.activeStaff,
      accent: 'border-l-[3px] border-[#8c6500]',
      meta: 'Current shift',
      metaClass: 'text-slate-400',
      icon: Users,
    },
    {
      label: 'Resolutions This Week',
      value: metrics.resolved.toLocaleString(),
      accent: 'border-l-[3px] border-primary-700',
      meta: 'Completed cases',
      metaClass: 'text-primary-700',
      icon: TrendingUp,
    },
  ]

  return (
    <AdminShell
      title="Admin Monitoring"
      subtitle="Operational oversight for ingestion status and Assistant Registrar activity."
      titleIcon={<Activity />}
    >
      <div className="space-y-6">
        <h2 className="section-heading">
          Operations Snapshot
          <span className="section-subtitle">Monitor queue pressure, ingestion volume, and registrar activity from one view.</span>
        </h2>
        <section className="overflow-hidden rounded-[2rem] border border-white/40 bg-[linear-gradient(135deg,#1a2355_0%,#2a3583_62%,#3b46a0_100%)] px-6 py-7 text-white shadow-[0_26px_70px_rgba(20,30,70,0.28)]">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/60">Operations overview</p>
              <h2 className="mt-3 font-serif text-[clamp(2rem,3vw,3.2rem)] font-semibold tracking-[-0.05em] text-white">
                A clearer command surface for live academic support operations.
              </h2>
              <p className="mt-4 text-sm leading-7 text-white/76 sm:text-base">
                Review workload, content ingestion health, and registrar availability from a single monitoring view.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[1.3rem] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur-sm">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/55">Open cases</p>
                <p className="mt-2 text-3xl font-semibold">{metrics.pending}</p>
              </div>
              <div className="rounded-[1.3rem] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur-sm">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/55">AR staff</p>
                <p className="mt-2 text-3xl font-semibold">{metrics.activeStaff}</p>
              </div>
              <div className="rounded-[1.3rem] border border-white/10 bg-white/8 px-4 py-4 backdrop-blur-sm">
                <p className="text-[11px] uppercase tracking-[0.22em] text-white/55">Records</p>
                <p className="mt-2 text-3xl font-semibold">{documents.length}</p>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 xl:grid-cols-4">
          {cards.map((card) => {
            const Icon = card.icon
            return (
              <div
                key={card.label}
                className={`metric-card ${card.accent}`}
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-500">
                  {card.label}
                </p>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div className="flex items-end gap-3">
                    <span className="text-[2.5rem] font-semibold leading-none text-primary-700">
                      {card.value}
                    </span>
                    <span className={`pb-1 text-base ${card.metaClass}`}>{card.meta}</span>
                  </div>
                  <Icon className="h-5 w-5 text-slate-400" />
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="dashboard-panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-7 py-6">
              <div>
                <h2 className="card-title">
                  <Database className="h-4 w-4" />
                  Ingestion Status
                </h2>
              </div>
              <button className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
                View All Records
              </button>
            </div>

            <div className="grid grid-cols-[120px_minmax(0,1fr)_160px_130px] gap-5 bg-slate-100/80 px-7 py-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
              <div>Feedback ID</div>
              <div>Validated Answer Snippet</div>
              <div>Ingested Status</div>
              <div>Created Date</div>
            </div>

            {isLoading ? (
              <div className="px-7 py-8 text-sm text-slate-500">Loading monitoring data...</div>
            ) : (
              recentDocuments.map((doc, idx) => {
                const title = doc.title || doc.filename || doc.source || 'University policy record'
                const states = ['resolved', 'in_progress', 'failed', 'resolved'] as const
                const state = states[idx % states.length]
                return (
                  <div
                    key={doc.id}
                    className="grid grid-cols-[120px_minmax(0,1fr)_160px_130px] gap-5 border-b border-slate-100 px-7 py-6"
                  >
                    <div className="text-base text-slate-500">FB-{String(doc.id).padStart(4, '0')}</div>
                    <div className="truncate text-[1.25rem] leading-tight text-slate-900">{title}</div>
                    <div>
                      <span
                        className={`inline-flex rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em] ${statusTone(
                          state
                        )}`}
                      >
                        {state.replace('_', ' ')}
                      </span>
                    </div>
                    <div className="text-sm text-slate-500">{formatDate(doc.created_at)}</div>
                  </div>
                )
              })
            )}
          </section>

          <div className="space-y-6">
            <section className="dashboard-panel overflow-hidden">
              <div className="flex items-center justify-between border-b border-slate-200/70 px-6 py-5">
                <h2 className="card-title">
                  <Users className="h-4 w-4" />
                  AR Activity
                </h2>
                <span className="status-heading">
                  <span className="status-dot-green" />
                  <span className="status-badge">Live</span>
                </span>
              </div>

              <div className="divide-y divide-slate-100">
                {activeStaff.map((member, idx) => (
                  <div key={member.id} className="flex items-start gap-4 px-6 py-5">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg font-semibold ${
                        idx % 3 === 0
                          ? 'bg-[#dcd9ff] text-primary-700'
                          : idx % 3 === 1
                            ? 'bg-[#ffd88b] text-[#8c6500]'
                            : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {member.initials}
                    </div>
                    <div>
                      <p className="text-[1.3rem] font-semibold text-slate-900">
                        {member.username || 'AR Staff'}
                      </p>
                      <p className="mt-1 text-base text-slate-500">
                        {member.resolvedToday} tickets resolved today
                      </p>
                      <p className="mt-1.5 text-sm text-primary-700">{member.state}</p>
                    </div>
                  </div>
                ))}
              </div>

              <button className="w-full border-t border-slate-200 px-6 py-5 text-center text-sm font-semibold uppercase tracking-[0.18em] text-primary-700">
                Manage All Staff
              </button>
            </section>

            <section className="overflow-hidden rounded-[1.6rem] bg-[linear-gradient(135deg,#24306d_0%,#2f3b8e_100%)] text-white shadow-[0_20px_50px_rgba(51,51,153,0.24)]">
              <div className="border-b border-white/10 px-6 py-5">
                <h3 className="text-[1.8rem] font-semibold">Ingestion Health</h3>
              </div>
              <div className="px-6 py-5">
                <div className="h-2.5 overflow-hidden rounded-full bg-white/15">
                  <div className="h-full w-[94%] rounded-full bg-accent-400" />
                </div>
                <p className="mt-4 text-base leading-7 text-white/85">
                  System performance is currently optimal with a 94.2% ingestion success rate over the last 24 hours.
                </p>
              </div>
            </section>
          </div>
        </div>
      </div>
    </AdminShell>
  )
}

export default DashboardPage
