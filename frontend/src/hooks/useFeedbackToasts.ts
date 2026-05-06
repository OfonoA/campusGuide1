import { useCallback, useRef, useState } from 'react'
import { FeedbackToast, FeedbackToastTone } from '../components/feedback/FeedbackToastStack'

interface ToastInput {
  title: string
  message?: string
  duration?: number
}

const DEFAULT_DURATION = 4200

export const useFeedbackToasts = () => {
  const [toasts, setToasts] = useState<FeedbackToast[]>([])
  const nextId = useRef(1)

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback(
    (tone: FeedbackToastTone, input: ToastInput) => {
      const id = nextId.current++
      const toast: FeedbackToast = {
        id,
        tone,
        title: input.title,
        message: input.message,
      }

      setToasts((current) => [...current, toast])
      window.setTimeout(() => {
        dismissToast(id)
      }, input.duration ?? DEFAULT_DURATION)
    },
    [dismissToast]
  )

  return {
    toasts,
    dismissToast,
    showSuccess: useCallback((input: ToastInput) => pushToast('success', input), [pushToast]),
    showError: useCallback((input: ToastInput) => pushToast('error', input), [pushToast]),
    showInfo: useCallback((input: ToastInput) => pushToast('info', input), [pushToast]),
  }
}
