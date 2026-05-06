import React from 'react'
import { Download, Eye, FileText } from 'lucide-react'
import { attachmentAPI } from '../../services/api'
import { Attachment } from '../../types'

interface AttachmentListProps {
  attachments?: Attachment[]
  tone?: 'light' | 'dark'
}

const AttachmentList: React.FC<AttachmentListProps> = ({ attachments = [], tone = 'light' }) => {
  if (attachments.length === 0) return null

  const baseClass =
    tone === 'dark'
      ? 'border-white/20 bg-white/10 text-white'
      : 'border-slate-200 bg-slate-50 text-slate-700'
  const buttonClass =
    tone === 'dark'
      ? 'text-white/85 hover:text-white hover:bg-white/10'
      : 'text-slate-600 hover:text-primary-700 hover:bg-white'

  return (
    <div className="mt-3 space-y-2">
      {attachments.map((attachment) => (
        <div
          key={attachment.id}
          className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-3 py-2 ${baseClass}`}
        >
          <div className="flex min-w-0 items-center gap-2">
            <FileText className="h-4 w-4 flex-shrink-0" />
            <span className="truncate text-sm font-medium">{attachment.original_filename}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void attachmentAPI.openAttachment(attachment)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${buttonClass}`}
            >
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" />
                Open
              </span>
            </button>
            <button
              type="button"
              onClick={() => void attachmentAPI.downloadAttachment(attachment)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition ${buttonClass}`}
            >
              <span className="inline-flex items-center gap-1">
                <Download className="h-3.5 w-3.5" />
                Download
              </span>
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

export default AttachmentList
