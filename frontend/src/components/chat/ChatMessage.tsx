import React, { memo, useEffect, useMemo, useState } from 'react'
import { ChatMessage as ChatMessageType } from '../../types'
import { ThumbsUp, ThumbsDown, UserPlus } from 'lucide-react'
import mustLogo from '../../../images/logo.png'
import AttachmentList from './AttachmentList'
import MarkdownMessage from './MarkdownMessage'

interface ChatMessageProps {
  message: ChatMessageType
  onFeedback?: (messageId: number, isHelpful: boolean) => void
  onEscalate?: (messageId: number) => void
  feedbackState?: 'up' | 'down' | null
  showEscalate?: boolean
}

const ChatMessage: React.FC<ChatMessageProps> = ({
  message,
  onFeedback,
  onEscalate,
  feedbackState = null,
  showEscalate = false,
}) => {
  const isUser = message.sender === 'user'
  const timestamp = message.created_at || (message as any).timestamp
  const shouldType = useMemo(
    () => !isUser && !!message.typing_effect && !!message.content,
    [isUser, message.typing_effect, message.content]
  )
  const [displayedContent, setDisplayedContent] = useState(shouldType ? '' : message.content)
  const [isTyping, setIsTyping] = useState(shouldType)
  const isTicketReferral = /ticket reference is/i.test(message.content) || /continue in the ticket chat/i.test(message.content)
  const actorTone = isUser ? 'text-slate-400' : 'text-primary-700'

  useEffect(() => {
    if (!shouldType) {
      setDisplayedContent(message.content)
      setIsTyping(false)
      return
    }

    setDisplayedContent('')
    setIsTyping(true)
    let index = 0
    const text = message.content
    const interval = window.setInterval(() => {
      index += 2
      setDisplayedContent(text.slice(0, index))
      if (index >= text.length) {
        window.clearInterval(interval)
        setIsTyping(false)
      }
    }, 14)

    return () => window.clearInterval(interval)
  }, [shouldType, message.content, message.id])
  
  return (
    <div className={`flex w-full min-w-0 ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {isUser ? (
        <div className="w-full max-w-[min(58ch,100%)]">
          <div className={`mb-2 flex items-center justify-end gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${actorTone}`}>
            <span>You (Student)</span>
            <span className="font-normal tracking-normal text-slate-400">
              {new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="ml-auto max-w-[min(58ch,100%)] rounded-[1.35rem] border-l-[3px] border-primary-600 bg-primary-700 px-4 py-3 text-white shadow-[0_16px_28px_rgba(51,51,153,0.2)]">
            <p className="text-[14px] leading-6 whitespace-pre-wrap break-words sm:text-[15px] sm:leading-7">{displayedContent}</p>
            <AttachmentList attachments={message.attachments} tone="dark" />
          </div>
        </div>
      ) : (
        <div className="w-full max-w-4xl">
          <div className={`mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${actorTone}`}>
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
              <img src={mustLogo} alt="ArASSIST avatar" className="h-5 w-5 object-contain" />
            </span>
            <span>ArASSIST (AI Support)</span>
            <span className="font-normal tracking-normal text-slate-400">
              {new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="rounded-[1.35rem] border border-white/80 border-l-[3px] border-l-primary-600 bg-white/84 px-4 py-3.5 shadow-[0_14px_28px_rgba(15,23,42,0.06)] backdrop-blur md:px-5 md:py-4">
            {isTicketReferral ? (
              <div className="mb-2 flex justify-end">
                <span className="text-[11px] uppercase tracking-[0.12em] text-slate-400 md:text-xs">
                  Ref: AR-SUPPORT-{String(Math.abs(message.id)).padStart(4, '0')}
                </span>
              </div>
            ) : null}

            <div className="text-[14px] leading-6 text-slate-800 sm:text-[15px] sm:leading-7">
              <MarkdownMessage content={displayedContent} />
            </div>
            <AttachmentList attachments={message.attachments} />

            {!isTyping && (
              <>
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {showEscalate ? (
                      <button
                        onClick={() => onEscalate?.(message.id)}
                        className="inline-flex items-center gap-2 rounded-full bg-accent-50 px-3 py-1.5 text-xs font-semibold text-accent-800 transition hover:bg-accent-100"
                      >
                        <UserPlus className="h-4 w-4" />
                        <span>Talk to an officer</span>
                      </button>
                    ) : (
                      <span />
                    )}

                    <div className="flex flex-wrap items-center justify-start gap-2 text-sm text-slate-600">
                      <button
                        onClick={() => onFeedback?.(message.id, true)}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!!feedbackState}
                      >
                        <ThumbsUp className={`h-4 w-4 ${feedbackState === 'up' ? 'text-green-600' : 'text-slate-500'}`} />
                        <span>Helpful</span>
                      </button>
                      <button
                        onClick={() => onFeedback?.(message.id, false)}
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 transition hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                        disabled={!!feedbackState}
                      >
                        <ThumbsDown className={`h-4 w-4 ${feedbackState === 'down' ? 'text-red-600' : 'text-slate-500'}`} />
                        <span>Not Helpful</span>
                      </button>
                      <span className="text-[11px] uppercase tracking-[0.14em] text-slate-400">
                        {feedbackState ? 'Feedback received' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(ChatMessage)
