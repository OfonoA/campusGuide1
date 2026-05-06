import React, { createContext, useContext, useEffect, useMemo } from 'react'
import FeedbackToastStack from '../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../hooks/useFeedbackToasts'
import { APP_FEEDBACK_EVENT, AppFeedbackPayload, emitAppFeedback, flushQueuedFeedback } from '../utils/appFeedback'

interface AppFeedbackContextType {
  showSuccess: (input: Omit<AppFeedbackPayload, 'tone'>) => void
  showError: (input: Omit<AppFeedbackPayload, 'tone'>) => void
  showInfo: (input: Omit<AppFeedbackPayload, 'tone'>) => void
}

const AppFeedbackContext = createContext<AppFeedbackContextType | undefined>(undefined)

export const AppFeedbackProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()

  useEffect(() => {
    flushQueuedFeedback().forEach((payload) => {
      if (payload.tone === 'success') showSuccess(payload)
      if (payload.tone === 'error') showError(payload)
      if (payload.tone === 'info') showInfo(payload)
    })

    const listener = (event: Event) => {
      const customEvent = event as CustomEvent<AppFeedbackPayload>
      const payload = customEvent.detail
      if (!payload) return
      if (payload.tone === 'success') showSuccess(payload)
      if (payload.tone === 'error') showError(payload)
      if (payload.tone === 'info') showInfo(payload)
    }

    window.addEventListener(APP_FEEDBACK_EVENT, listener as EventListener)
    return () => window.removeEventListener(APP_FEEDBACK_EVENT, listener as EventListener)
  }, [showError, showInfo, showSuccess])

  const value = useMemo(
    () => ({
      showSuccess: (input: Omit<AppFeedbackPayload, 'tone'>) => emitAppFeedback({ tone: 'success', ...input }),
      showError: (input: Omit<AppFeedbackPayload, 'tone'>) => emitAppFeedback({ tone: 'error', ...input }),
      showInfo: (input: Omit<AppFeedbackPayload, 'tone'>) => emitAppFeedback({ tone: 'info', ...input }),
    }),
    []
  )

  return (
    <AppFeedbackContext.Provider value={value}>
      {children}
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
    </AppFeedbackContext.Provider>
  )
}

export const useAppFeedback = () => {
  const context = useContext(AppFeedbackContext)
  if (!context) {
    throw new Error('useAppFeedback must be used within AppFeedbackProvider')
  }
  return context
}
