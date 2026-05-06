import { FeedbackToastTone } from '../components/feedback/FeedbackToastStack'

export interface AppFeedbackPayload {
  tone: FeedbackToastTone
  title: string
  message?: string
  duration?: number
}

const FEEDBACK_EVENT = 'arassist:feedback'
const QUEUED_FEEDBACK_KEY = 'arassist:queued-feedback'

export const emitAppFeedback = (payload: AppFeedbackPayload) => {
  window.dispatchEvent(new CustomEvent<AppFeedbackPayload>(FEEDBACK_EVENT, { detail: payload }))
}

export const queuePersistentFeedback = (payload: AppFeedbackPayload) => {
  try {
    const current = sessionStorage.getItem(QUEUED_FEEDBACK_KEY)
    const queue: AppFeedbackPayload[] = current ? JSON.parse(current) : []
    queue.push(payload)
    sessionStorage.setItem(QUEUED_FEEDBACK_KEY, JSON.stringify(queue))
  } catch {
    // ignore storage failures
  }
}

export const flushQueuedFeedback = () => {
  try {
    const current = sessionStorage.getItem(QUEUED_FEEDBACK_KEY)
    if (!current) return []
    sessionStorage.removeItem(QUEUED_FEEDBACK_KEY)
    const queue = JSON.parse(current)
    return Array.isArray(queue) ? (queue as AppFeedbackPayload[]) : []
  } catch {
    return []
  }
}

export const APP_FEEDBACK_EVENT = FEEDBACK_EVENT
