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
  const showFeedbackActions = !isTicketReferral
  const actorTone = isUser ? 'text-[#1E6B3B]/70' : 'text-[#1E6B3B]'

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
    const totalLength = text.length
    const targetDurationMs = Math.min(4200, Math.max(1400, totalLength * 12))
    const intervalMs = 24
    const totalTicks = Math.max(1, Math.floor(targetDurationMs / intervalMs))
    const charsPerTick = Math.max(1, Math.ceil(totalLength / totalTicks))

    const interval = window.setInterval(() => {
      index += charsPerTick
      setDisplayedContent(text.slice(0, index))
      if (index >= text.length) {
        window.clearInterval(interval)
        setDisplayedContent(text)
        setIsTyping(false)
      }
    }, intervalMs)

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
          <div className="ml-auto max-w-[min(58ch,100%)] rounded-[20px] border border-[#E6B422]/20 bg-[rgba(230,180,34,0.2)] px-4 py-3 text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
            <p className="text-[14px] leading-6 whitespace-pre-wrap break-words sm:text-[15px] sm:leading-7">{displayedContent}</p>
            <AttachmentList attachments={message.attachments} tone="dark" />
          </div>
        </div>
      ) : (
        <div className="w-full max-w-5xl">
          <div className={`mb-2 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] ${actorTone}`}>
            <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-[8px] bg-[#FEF9E6] shadow-[0_2px_6px_rgba(0,0,0,0.05)] ring-1 ring-[#E6B422]/20">
              <img src={mustLogo} alt="ArASSIST avatar" className="h-5 w-5 object-contain" />
            </span>
            <span>ArASSIST (AI Support)</span>
            <span className="font-normal tracking-normal text-[#1E6B3B]/60">
              {new Date(timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          </div>
          <div className="rounded-[20px] border border-[#E6B422]/25 bg-[#FEF9E6] px-4 py-3.5 shadow-[0_2px_6px_rgba(0,0,0,0.05)] md:px-6 md:py-5">
            {isTicketReferral ? (
              <div className="mb-2 flex justify-end">
                <span className="text-[11px] uppercase tracking-[0.12em] text-[#1E6B3B]/60 md:text-xs">
                  Ref: AR-SUPPORT-{String(Math.abs(message.id)).padStart(4, '0')}
                </span>
              </div>
            ) : null}

            <div className="chat-rich-text text-[14px] leading-7 text-[#1E6B3B] sm:text-[15px] sm:leading-8">
              <MarkdownMessage content={displayedContent} />
            </div>
            <AttachmentList attachments={message.attachments} />

            {!isTyping && (
              <>
                <div className="mt-4 border-t border-[#E6B422]/20 pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    {showEscalate ? (
                      <button
                        onClick={() => onEscalate?.(message.id)}
                        className="inline-flex items-center gap-2 rounded-full bg-[#E6B422] px-3 py-1.5 text-xs font-semibold text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:bg-[#d8aa20]"
                      >
                        <UserPlus className="h-4 w-4" />
                        <span>Talk to an officer</span>
                      </button>
                    ) : (
                      <span />
                    )}

                    {showFeedbackActions ? (
                      <div className="flex flex-wrap items-center justify-start gap-2 text-sm text-[#333333]">
                        <button
                          onClick={() => onFeedback?.(message.id, true)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#E6B422] px-2.5 py-1 transition hover:bg-[#1E6B3B] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!!feedbackState}
                        >
                          <ThumbsUp className={`h-4 w-4 ${feedbackState === 'up' ? 'text-[#1E6B3B]' : 'text-[#1E6B3B]'}`} />
                          <span>Helpful</span>
                        </button>
                        <button
                          onClick={() => onFeedback?.(message.id, false)}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#E6B422] px-2.5 py-1 transition hover:bg-[#1E6B3B] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                          disabled={!!feedbackState}
                        >
                          <ThumbsDown className={`h-4 w-4 ${feedbackState === 'down' ? 'text-[#1E6B3B]' : 'text-[#1E6B3B]'}`} />
                          <span>Not Helpful</span>
                        </button>
                        <span className="text-[11px] uppercase tracking-[0.14em] text-[#1E6B3B]/60">
                          {feedbackState ? 'Feedback received' : ''}
                        </span>
                      </div>
                    ) : (
                      <span />
                    )}
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
