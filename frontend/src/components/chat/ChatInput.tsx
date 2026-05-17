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
    <form onSubmit={handleSubmit} className="rounded-[8px] border border-[#D4AF37]/30 bg-white p-2 shadow-[0_2px_6px_rgba(0,0,0,0.05)]">
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
        <div className="mb-2 flex flex-wrap gap-2 px-1.5">
          {selectedFiles.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className="inline-flex items-center gap-2 rounded-full bg-[#FEF9E6] px-3 py-1 text-xs font-medium text-[#333333]"
            >
              <span className="max-w-[180px] truncate">{file.name}</span>
              <button
                type="button"
                className="rounded-full text-[#1E6B3B]/60 transition hover:text-[#1E6B3B]"
                onClick={() => setSelectedFiles((prev) => prev.filter((_, itemIndex) => itemIndex !== index))}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="w-full resize-none border-0 bg-transparent px-2.5 py-1.5 text-sm text-[#333333] outline-none placeholder:text-[#1E6B3B] focus:ring-0 sm:text-[15px]"
            style={{
              minHeight: '38px',
              maxHeight: '104px',
            }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement
              target.style.height = 'auto'
              target.style.height = `${Math.min(target.scrollHeight, 104)}px`
            }}
          />
        </div>

        <button
          type="button"
          className="mb-0.5 hidden rounded-lg p-2 text-[#1E6B3B] transition hover:bg-[#FEF9E6] hover:text-[#D4AF37] sm:inline-flex"
          title="Attach file"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip className="h-4.5 w-4.5" />
        </button>

        <button
          type="submit"
          disabled={(!message.trim() && selectedFiles.length === 0) || disabled}
          className="mb-0.5 inline-flex items-center gap-1.5 rounded-[8px] bg-[#1E6B3B] px-4 py-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:border hover:border-[#D4AF37] hover:bg-[#1E6B3B] disabled:cursor-not-allowed disabled:opacity-50 sm:px-5"
          title="Send message"
        >
          <span>Send</span>
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </form>
  )
}

export default ChatInput
