import axios from 'axios'
import { User, Chat, Ticket, DashboardMetrics, Attachment } from '../types'
import { emitAppFeedback, queuePersistentFeedback } from '../utils/appFeedback'
import { clearAuthSession, getAuthToken, getRefreshToken, setAuthSession } from '../utils/authStorage'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

const api = axios.create({
  baseURL: API_BASE_URL,
})

// Add auth token to requests
api.interceptors.request.use((config) => {
  const token = getAuthToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  if (config.data instanceof FormData) {
    config.headers.setContentType(undefined)
  } else {
    config.headers.setContentType('application/json')
  }
  return config
})

// Handle 401 responses
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config as any
    const requestUrl = String(originalRequest?.url || '')
    const isAuthRoute =
      requestUrl.includes('/api/login') ||
      requestUrl.includes('/api/signup') ||
      requestUrl.includes('/api/refresh')

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      if (!isAuthRoute) {
        originalRequest._retry = true
        const refreshToken = getRefreshToken()

        if (refreshToken) {
          try {
            const refreshRes = await axios.post(`${API_BASE_URL}/api/refresh`, {
              refresh_token: refreshToken,
            })

            const newToken = refreshRes.data?.token
            const newRefresh = refreshRes.data?.refresh_token

            if (!newToken) throw new Error('No access token returned from refresh')

            setAuthSession(newToken, newRefresh || refreshToken)

            originalRequest.headers = originalRequest.headers || {}
            originalRequest.headers.Authorization = `Bearer ${newToken}`
            return api(originalRequest)
          } catch {
            clearAuthSession()
            queuePersistentFeedback({
              tone: 'error',
              title: 'Session expired',
              message: 'Your session ended while refreshing credentials. Sign in again.',
            })
            window.location.href = '/login'
          }
        } else {
          clearAuthSession()
          queuePersistentFeedback({
            tone: 'error',
            title: 'Session expired',
            message: 'Your session ended. Sign in again to continue.',
          })
          window.location.href = '/login'
        }
      }
    }

    if (error.response?.status === 401 && !isAuthRoute) {
      clearAuthSession()
      queuePersistentFeedback({
        tone: 'error',
        title: 'Session expired',
        message: 'Your session is no longer valid. Sign in again.',
      })
      window.location.href = '/login'
    }

    if (error.response?.status === 403) {
      emitAppFeedback({
        tone: 'info',
        title: 'Action blocked',
        message: error.response?.data?.detail || 'You do not have permission to perform that action.',
      })
    }

    return Promise.reject(error)
  }
)

// Auth API
export const authAPI = {
  login: async (username: string, password: string) => {
    const response = await api.post('/api/login', { username, password })
    return response.data
  },
  
  signup: async (username: string, password: string) => {
    const response = await api.post('/api/signup', { username, password })
    return response.data
  },
  
  checkAuth: async () => {
    const response = await api.get('/api/check_auth')
    return response.data
  },
  
  logout: async (refreshToken?: string) => {
    const response = await api.post('/api/logout', {
      refresh_token: refreshToken,
    })
    return response.data
  },
  refresh: async (refreshToken: string) => {
    const response = await axios.post(`${API_BASE_URL}/api/refresh`, {
      refresh_token: refreshToken,
    })
    return response.data
  },
}

// Chat API
export const chatAPI = {
  sendMessage: async (
    query: string,
    chatId?: number,
    chatHistory?: Array<[string, string]>,
    files?: File[],
  ) => {
    const usableFiles = (files || []).filter((file) => file instanceof File)
    if (usableFiles.length > 0) {
      const form = new FormData()
      form.append('query', query)
      if (chatId) {
        form.append('chat_id', String(chatId))
      }
      if (chatHistory && chatHistory.length > 0) {
        form.append('chat_history', JSON.stringify(chatHistory))
      }
      usableFiles.forEach((file) => form.append('files', file))
      const response = await api.post('/chat/upload', form)
      return response.data
    }

    const response = await api.post('/chat/', {
      query,
      chat_id: chatId,
      chat_history: chatHistory,
    })
    return response.data
  },
  
  getChats: async (): Promise<Chat[]> => {
    const response = await api.get('/api/chats')
    const data = response.data || []
    return data.map((c: any) => ({
      id: c.id || c.chat_id,
      title: c.title || `Conversation ${c.id || c.chat_id}`,
      created_at: c.created_at || c.started_at || c.created,
      messages: c.messages || [],
    }))
  },
  
  getChatMessages: async (chatId: number) => {
    const response = await api.get(`/api/chats/${chatId}/messages`)
    const data = response.data || []
    return data.map((m: any) => ({
      id: m.id,
      sender: m.sender,
      content: m.content,
      created_at: m.created_at || m.timestamp,
      confidence_score: m.confidence_score,
      found_answer: m.found_answer,
      attachments: m.attachments || [],
    }))
  },
  getActiveTicket: async (chatId: number) => {
    const response = await api.get(`/api/chats/${chatId}/active-ticket`)
    return response.data as { active: boolean; ticket_reference: string | null }
  },
}

// Tickets API
export const ticketsAPI = {
  getTickets: async (): Promise<Ticket[]> => {
    const response = await api.get('/api/tickets')
    const data = response.data || []
    return data.map((t: any) => ({
      id: t.id || t.ticket_id,
      reference_code: t.reference_code,
      conversation_id: t.conversation_id,
      student_id: t.student_id,
      status: t.status,
      created_at: t.created_at || t.started_at || t.created,
    }))
  },
  
  getTicket: async (ticketId: number): Promise<Ticket> => {
    const response = await api.get(`/api/tickets/${ticketId}`)
    const t = response.data
    return {
      id: t.id || t.ticket_id,
      reference_code: t.reference_code,
      conversation_id: t.conversation_id,
      student_id: t.student_id,
      status: t.status,
      created_at: t.created_at || t.started_at || t.created,
    }
  },
  
  getTicketMessages: async (ticketId: number) => {
    const response = await api.get(`/api/tickets/${ticketId}/messages`)
    const data = response.data || []
    return data.map((m: any) => ({
      id: m.id,
      ticket_id: m.ticket_id,
      sender_role: m.sender_role === 'officer' ? 'ar_staff' : m.sender_role,
      sender_id: m.sender_id,
      sender_alias: m.sender_alias,
      content: m.content,
      created_at: m.created_at,
      attachments: m.attachments || [],
    }))
  },
  
  addTicketMessage: async (ticketId: number, content: string, files?: File[]) => {
    const normalizedContent = content.trim()
    const usableFiles = (files || []).filter((file) => file instanceof File)
    const form = new FormData()
    form.append('content', normalizedContent || (usableFiles.length > 0 ? 'Please review the attached files.' : ''))
    usableFiles.forEach((file) => form.append('files', file))
    const response = await api.post(`/api/tickets/${ticketId}/messages`, form)
    return response.data
  },
}

const openBlobInNewTab = (blob: Blob) => {
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank', 'noopener,noreferrer')
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const triggerBlobDownload = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

const getFilenameFromDisposition = (contentDisposition?: string | null, fallback = 'download.bin') => {
  const match = contentDisposition?.match(/filename="?([^"]+)"?/)
  return match?.[1] || fallback
}

export interface AdminPerformanceOverviewStats {
  total_tickets: number
  avg_response_time_hours: number | null
  avg_resolution_time_days: number | null
  sla_compliance_percent: number | null
}

export interface AdminPerformanceRow {
  staff_id: number
  staff_username: string
  assigned: number
  not_started: number
  in_progress: number
  resolved_30d: number
  avg_response_time_hours: number | null
  avg_resolution_time_days: number | null
  sla_breaches: number
}

export interface AdminPerformanceOverviewResponse {
  stats: AdminPerformanceOverviewStats
  rows: AdminPerformanceRow[]
}

export interface AdminPerformanceTicketDetail {
  ticket_id: number
  reference_code: string
  student_username: string | null
  status: string
  assigned_date: string | null
  response_time_hours: number | null
  resolution_time_days: number | null
}

export interface AdminPerformanceDetailResponse {
  staff_id: number
  staff_username: string
  tickets: AdminPerformanceTicketDetail[]
}

export interface AdminAnalyticsTrendPoint {
  label: string
  value: number
}

export interface AdminAnalyticsOverview {
  total_questions: number
  answered: number
  answered_rate: number
  unanswered: number
  unanswered_rate: number
  escalation_rate: number
  helpful_rate: number
  kb_coverage: number
}

export interface AdminAnalyticsTopicRow {
  topic: string
  volume: number
  share: number
  escalation_rate: number
  answer_rate: number
}

export interface AdminAnalyticsHotspotRow {
  query: string
  escalation_rate: number
  tickets: number
}

export interface AdminAnalyticsNoAnswerArea {
  topic: string
  count: number
}

export interface AdminAnalyticsGapRow {
  area: string
  failed_query: string
  suggested_document: string
}

export interface AdminAnalyticsUnansweredExample {
  query: string
}

export interface AdminAnalyticsFollowUpInsight {
  topic: string
  tickets: number
  delta: number
}

export interface AdminConversationAnalyticsResponse {
  overview: AdminAnalyticsOverview
  trends: Record<'daily' | 'weekly' | 'monthly', AdminAnalyticsTrendPoint[]>
  peak_hours: AdminAnalyticsTrendPoint[]
  peak_days: AdminAnalyticsTrendPoint[]
  topics: AdminAnalyticsTopicRow[]
  hotspots: AdminAnalyticsHotspotRow[]
  feedback: {
    helpful: number
    notHelpful: number
  }
  no_answer_areas: AdminAnalyticsNoAnswerArea[]
  gaps: AdminAnalyticsGapRow[]
  unanswered_examples: AdminAnalyticsUnansweredExample[]
  follow_up_insights: AdminAnalyticsFollowUpInsight[]
}

export const attachmentAPI = {
  openAttachment: async (attachment: Attachment) => {
    const response = await api.get(attachment.view_url, { responseType: 'blob' })
    openBlobInNewTab(response.data)
  },
  downloadAttachment: async (attachment: Attachment) => {
    const response = await api.get(attachment.download_url, { responseType: 'blob' })
    triggerBlobDownload(response.data, attachment.original_filename)
  },
}

// AR Staff API
export const arAPI = {
  getAssignedTickets: async (): Promise<Ticket[]> => {
    const response = await api.get('/api/ar/tickets')
    const data = response.data || []
    return data.map((t: any) => ({
      id: t.id || t.ticket_id,
      reference_code: t.reference_code,
      conversation_id: t.conversation_id ?? 0,
      student_id: t.student_id ?? 0,
      status: t.status,
      created_at: t.created_at || t.started_at || t.created,
      resolved_at: t.resolved_at || null,
      preview_text: t.preview_text || null,
      student_identifier: t.student_identifier || null,
    }))
  },
  getTicketConversation: async (ticketId: number) => {
    const response = await api.get(`/api/ar/tickets/${ticketId}/conversation`)
    const data = response.data || []
    return data.map((m: any) => ({
      id: m.id,
      ticket_id: m.ticket_id,
      sender_role: m.sender_role === 'officer' ? 'ar_staff' : m.sender_role,
      sender_id: m.sender_id,
      sender_alias: m.sender_alias,
      content: m.content,
      created_at: m.created_at,
      attachments: m.attachments || [],
    }))
  },
  resolveTicket: async (ticketId: number, resolution_summary?: string) => {
    const payload = resolution_summary ? { resolution_summary } : {}
    console.info('[arAPI.resolveTicket] request', {
      ticketId,
      hasResolutionSummary: Boolean(resolution_summary),
      resolutionSummaryLength: resolution_summary?.length || 0,
    })
    const response = await api.post(`/api/ar/tickets/${ticketId}/resolve`, payload)
    console.info('[arAPI.resolveTicket] response', {
      ticketId,
      status: response.status,
    })
    return response.data
  },
}

// Admin API
export const adminAPI = {
  getTickets: async (): Promise<any[]> => {
    const response = await api.get('/api/admin/tickets')
    const data = response.data || []
    return data.map((t: any) => ({
      id: t.id || t.ticket_id,
      reference_code: t.reference_code,
      conversation_id: t.conversation_id,
      student_id: t.student_id,
      student_username: t.student_username,
      status: t.status,
      created_at: t.created_at || t.started_at || t.created,
      resolved_at: t.resolved_at || null,
      false_generated: Boolean(t.false_generated),
      exclude_from_ingestion: Boolean(t.exclude_from_ingestion),
      recommended_officer_id: t.recommended_officer_id ?? null,
      recommended_officer_username: t.recommended_officer_username ?? null,
      recommendation_score: t.recommendation_score ?? null,
      recommendation_reason: t.recommendation_reason ?? null,
      recommendation_created_at: t.recommendation_created_at ?? null,
      auto_assigned: Boolean(t.auto_assigned),
      assignment_reviewed: Boolean(t.assignment_reviewed),
      assigned_to: t.assigned_to ?? t.assigned_officer_id ?? t.ar_assigned_id ?? null,
      ar_assigned_username: t.ar_assigned_username,
    }))
  },
  getAssignmentMode: async () => {
    const response = await api.get('/api/admin/assignment-mode')
    return response.data as { mode: 'recommend' | 'auto_review' | 'auto_assign' }
  },
  updateAssignmentMode: async (mode: 'recommend' | 'auto_review' | 'auto_assign') => {
    const response = await api.put('/api/admin/assignment-mode', { mode })
    return response.data as { mode: 'recommend' | 'auto_review' | 'auto_assign' }
  },
  assignTicket: async (ticketId: number, officerId: number) => {
    const response = await api.post(`/api/admin/tickets/${ticketId}/assign`, null, {
      params: { officer_id: officerId },
    })
    return response.data
  },
  resolveFalseTicket: async (ticketId: number, note?: string) => {
    const response = await api.post(`/api/admin/tickets/${ticketId}/resolve-false`, {
      note: note?.trim() || undefined,
    })
    return response.data
  },
  acceptRecommendation: async (ticketId: number) => {
    const response = await api.post(`/api/admin/tickets/${ticketId}/accept-recommendation`)
    return response.data
  },
  markAssignmentReviewed: async (ticketId: number) => {
    const response = await api.post(`/api/admin/tickets/${ticketId}/mark-assignment-reviewed`)
    return response.data
  },
  listUsers: async (): Promise<User[]> => {
    const response = await api.get('/api/admin/users')
    const data = Array.isArray(response.data) ? response.data : []
    return data.map((u: any) => ({
      id: u.id ?? u.user_id ?? 0,
      username: u.username ?? u.email ?? 'user',
      role: u.role === 'staff' || u.role === 'ar' ? 'ar_staff' : (u.role ?? 'student'),
      email: u.email,
      name: u.name,
      created_at: u.created_at,
      last_active_at: u.last_active_at ?? null,
    }))
  },
  createUser: async (username: string, password: string, role: User['role']) => {
    const response = await api.post('/api/admin/users', { username, password, role })
    return response.data
  },
  updateUserRole: async (userId: number, role: User['role']) => {
    const response = await api.put(`/api/admin/users/${userId}/role`, { role })
    return response.data
  },
  deleteUser: async (userId: number, password: string) => {
    const response = await api.delete(`/api/admin/users/${userId}`, {
      data: { password },
    })
    return response.data
  },
  listDocuments: async () => {
    const response = await api.get('/api/admin/documents')
    return Array.isArray(response.data) ? response.data : []
  },
  uploadDocument: async (file: File) => {
    const form = new FormData()
    form.append('file', file)
    const response = await api.post('/api/admin/documents/upload', form)
    return response.data as {
      message: string
      original_filename: string
      stored_filename: string
      file_existed: boolean
      rag_document_id: number
      chunks_created: number
    }
  },
  deleteDocument: async (documentId: number) => {
    const response = await api.delete(`/api/admin/documents/${documentId}`)
    return response.data
  },
  getPerformanceOverview: async (
    rangeKey: '7' | '30' | '90' | 'custom',
    startDate?: string,
    endDate?: string,
  ): Promise<AdminPerformanceOverviewResponse> => {
    const response = await api.get('/api/admin/performance', {
      params: {
        range_key: rangeKey,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
    })
    return response.data
  },
  getPerformanceDetail: async (
    staffId: number,
    rangeKey: '7' | '30' | '90' | 'custom',
    startDate?: string,
    endDate?: string,
  ): Promise<AdminPerformanceDetailResponse> => {
    const response = await api.get(`/api/admin/performance/${staffId}`, {
      params: {
        range_key: rangeKey,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
    })
    return response.data
  },
  exportPerformanceCsv: async (
    rangeKey: '7' | '30' | '90' | 'custom',
    startDate?: string,
    endDate?: string,
  ) => {
    const response = await api.get('/api/admin/performance/export/csv', {
      params: {
        range_key: rangeKey,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
      responseType: 'blob',
    })
    const filename = getFilenameFromDisposition(
      response.headers['content-disposition'],
      'staff_performance_analytics.csv',
    )
    triggerBlobDownload(response.data, filename)
  },
  exportPerformancePdf: async (
    rangeKey: '7' | '30' | '90' | 'custom',
    startDate?: string,
    endDate?: string,
  ) => {
    const response = await api.get('/api/admin/performance/export/pdf', {
      params: {
        range_key: rangeKey,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
      responseType: 'blob',
    })
    const filename = getFilenameFromDisposition(
      response.headers['content-disposition'],
      'staff_performance_analytics.pdf',
    )
    triggerBlobDownload(response.data, filename)
  },
  getConversationAnalytics: async (
    rangeKey: '7' | '30' | '90' | 'custom',
    startDate?: string,
    endDate?: string,
  ): Promise<AdminConversationAnalyticsResponse> => {
    const response = await api.get('/api/admin/analytics', {
      params: {
        range_key: rangeKey,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
    })
    return response.data
  },
  exportConversationAnalyticsCsv: async (
    rangeKey: '7' | '30' | '90' | 'custom',
    startDate?: string,
    endDate?: string,
  ) => {
    const response = await api.get('/api/admin/analytics/export/csv', {
      params: {
        range_key: rangeKey,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
      responseType: 'blob',
    })
    const filename = getFilenameFromDisposition(
      response.headers['content-disposition'],
      'conversation_analytics.csv',
    )
    triggerBlobDownload(response.data, filename)
  },
  exportConversationAnalyticsPdf: async (
    rangeKey: '7' | '30' | '90' | 'custom',
    startDate?: string,
    endDate?: string,
  ) => {
    const response = await api.get('/api/admin/analytics/export/pdf', {
      params: {
        range_key: rangeKey,
        start_date: startDate || undefined,
        end_date: endDate || undefined,
      },
      responseType: 'blob',
    })
    const filename = getFilenameFromDisposition(
      response.headers['content-disposition'],
      'conversation_analytics.pdf',
    )
    triggerBlobDownload(response.data, filename)
  },
}

// Dashboard API
export const dashboardAPI = {
  getMetrics: async (): Promise<DashboardMetrics> => {
    return {
      totalTickets: 0,
      openTickets: 0,
      awaitingAssignment: 0,
      activeStaff: 0,
      resolvedToday: 0,
      inProgress: 0,
      assignedTickets: 0,
    }
  },
  
  getStaffMetrics: async (): Promise<DashboardMetrics> => {
    return {
      totalTickets: 0,
      openTickets: 0,
      awaitingAssignment: 0,
      activeStaff: 0,
      resolvedToday: 0,
      inProgress: 0,
      assignedTickets: 0,
    }
  },
}

// Feedback API
export const feedbackAPI = {
  sendFeedback: async (messageId: number, satisfactory: boolean, request_in_person = false) => {
    const response = await api.post(`/api/chat/${messageId}/feedback`, {
      satisfactory,
      request_in_person,
    })
    return response.data
  },
}

export default api
