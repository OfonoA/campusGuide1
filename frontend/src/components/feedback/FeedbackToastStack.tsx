import React from 'react'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'

export type FeedbackToastTone = 'success' | 'error' | 'info'

export interface FeedbackToast {
  id: number
  tone: FeedbackToastTone
  title: string
  message?: string
}

interface FeedbackToastStackProps {
  toasts: FeedbackToast[]
  onDismiss: (id: number) => void
}

const toneStyles: Record<FeedbackToastTone, string> = {
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  error: 'border-rose-200 bg-rose-50 text-rose-900',
  info: 'border-primary-200 bg-primary-50 text-primary-900',
}

const toneIcons: Record<FeedbackToastTone, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
}

const FeedbackToastStack: React.FC<FeedbackToastStackProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed inset-x-4 top-4 z-[90] flex flex-col gap-3 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm">
      {toasts.map((toast) => {
        const Icon = toneIcons[toast.tone]
        return (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-[1.2rem] border px-4 py-3 backdrop-blur-xl shadow-[0_18px_36px_rgba(15,23,42,0.12)] ${toneStyles[toast.tone]}`}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">{toast.title}</p>
                {toast.message ? (
                  <p className="mt-1 text-sm leading-6 opacity-90">{toast.message}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="rounded-full p-1 opacity-60 transition hover:bg-white/60 hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default FeedbackToastStack
