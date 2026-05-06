import React, { useRef, useState } from 'react'
import { Paperclip, Send, X } from 'lucide-react'

interface ChatInputProps {
  onSendMessage: (message: string, files?: File[]) => void
  disabled?: boolean
  placeholder?: string
  onAttachmentAccepted?: (files: File[]) => void
  onAttachmentRejected?: (message: string) => void
}

const ALLOWED_ATTACHMENT_EXTENSIONS = ['pdf', 'txt', 'md', 'csv']
const MAX_ATTACHMENT_COUNT = 3

const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  disabled = false,
  placeholder = "Type your inquiry here...",
  onAttachmentAccepted,
  onAttachmentRejected,
}) => {
  const [message, setMessage] = useState('')
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = message.trim()
    if ((trimmed || selectedFiles.length > 0) && !disabled) {
      onSendMessage(trimmed || 'Please review the attached files.', selectedFiles)
      setMessage('')
      setSelectedFiles([])
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[1.8rem] border border-white/80 bg-white/82 p-3 shadow-[0_24px_54px_rgba(15,23,42,0.08)] backdrop-blur-xl">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        multiple
        accept=".pdf,.txt,.md,.csv"
        onChange={(e) => {
          const incoming = Array.from(e.target.files || [])
          if (incoming.length === 0) return

          const accepted: File[] = []
          const rejected: string[] = []

          incoming.forEach((file) => {
            const extension = file.name.split('.').pop()?.toLowerCase() || ''
            if (!ALLOWED_ATTACHMENT_EXTENSIONS.includes(extension)) {
              rejected.push(`${file.name} is not a supported file type`)
              return
            }
            accepted.push(file)
          })

          if (rejected.length > 0) {
            onAttachmentRejected?.(rejected.join('. ') + '.')
          }

          if (accepted.length === 0) {
            if (fileInputRef.current) {
              fileInputRef.current.value = ''
            }
            return
          }

          setSelectedFiles((prev) => {
            const nextFiles = [...prev, ...accepted]
            const allowedFiles = nextFiles.slice(0, MAX_ATTACHMENT_COUNT)
            const droppedCount = nextFiles.length - allowedFiles.length
            if (droppedCount > 0) {
              onAttachmentRejected?.(`Only ${MAX_ATTACHMENT_COUNT} attachments can be added to one message.`)
            }
            onAttachmentAccepted?.(allowedFiles.slice(prev.length))
            return allowedFiles
          })
        }}
      />
      {selectedFiles.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 px-2">
          {selectedFiles.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600"
            >
              <span className="max-w-[180px] truncate">{file.name}</span>
              <button
                type="button"
                className="rounded-full text-slate-400 transition hover:text-slate-700"
                onClick={() => setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none border-0 bg-transparent px-4 py-3 text-base text-slate-700 outline-none placeholder:text-slate-400 focus:ring-0 sm:text-lg"
            style={{
              minHeight: '52px',
              maxHeight: '140px',
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = `${Math.min(target.scrollHeight, 140)}px`
            }}
          />
        </div>

        <button
          type="button"
          className="mb-1 hidden rounded-2xl p-3 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 sm:inline-flex"
          title="Attach file"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-5 w-5" />
        </button>

        <button
          type="submit"
          disabled={(!message.trim() && selectedFiles.length === 0) || disabled}
          className="mb-1 inline-flex items-center gap-2 rounded-[1.25rem] bg-primary-700 px-7 py-4 text-sm font-semibold uppercase tracking-[0.16em] text-white shadow-[0_16px_30px_rgba(44,52,143,0.24)] transition hover:bg-primary-800 disabled:cursor-not-allowed disabled:opacity-50"
          title="Send message"
        >
          <span>Send</span>
          <Send className="h-4 w-4" />
        </button>
      </div>
    </form>
  )
}

export default ChatInput
