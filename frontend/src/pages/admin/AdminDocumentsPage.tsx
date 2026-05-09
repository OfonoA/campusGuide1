import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, FileText, Search, Trash2, UploadCloud } from 'lucide-react'
import AdminShell from '../../components/admin/AdminShell'
import FeedbackToastStack from '../../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import { adminAPI } from '../../services/api'
import { getErrorDetail } from '../../utils/errors'

const panelClass = 'overflow-hidden rounded-[8px] border border-[#F0F2F5] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'
const compactCardClass = 'rounded-[8px] border border-[#F0F2F5] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'

interface DocumentItem {
  id: number
  filename?: string
  title?: string
  source?: string
  source_reference?: string
  source_type?: string
  chunk_count?: number
  file_exists?: boolean
  created_at?: string
}

const getDocumentStatus = (doc: DocumentItem): 'success' | 'failed' | 'pending' => {
  if ((doc.chunk_count || 0) > 0) return 'success'
  if (doc.file_exists) return 'pending'
  return 'failed'
}

const getDocumentStatusLabel = (status: 'success' | 'failed' | 'pending') => {
  if (status === 'success') return 'Success'
  if (status === 'pending') return 'Pending'
  return 'Failed'
}

const AdminDocumentsPage: React.FC = () => {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [isDeletingId, setIsDeletingId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | string>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pageSize = 6
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()

  useEffect(() => {
    void loadDocuments()
  }, [])

  useEffect(() => {
    if (!isUploading) {
      if (uploadProgress === 100) {
        const timeout = window.setTimeout(() => setUploadProgress(0), 700)
        return () => window.clearTimeout(timeout)
      }
      return
    }

    setUploadProgress(12)
    const interval = window.setInterval(() => {
      setUploadProgress((current) => {
        if (current >= 88) return current
        return current + Math.max(5, Math.round((88 - current) / 3))
      })
    }, 260)

    return () => window.clearInterval(interval)
  }, [isUploading, uploadProgress])

  const loadDocuments = async () => {
    try {
      const data = await adminAPI.listDocuments()
      setDocuments(data)
    } catch (error) {
      console.error('Error loading documents:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUpload = async () => {
    if (!file) {
      showInfo({
        title: 'No document selected',
        message: 'Choose a PDF file before starting ingestion.',
      })
      return
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showError({
        title: 'Upload rejected',
        message: 'Only PDF files can be ingested into the knowledge base.',
      })
      return
    }

    setIsUploading(true)
    showInfo({
      title: 'Ingestion started',
      message: `${file.name} is being uploaded and ingested into the knowledge base.`,
      duration: 2600,
    })

    try {
      const result = await adminAPI.uploadDocument(file)
      setUploadProgress(100)
      setFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      await loadDocuments()
      showSuccess({
        title: 'Document ingested',
        message: `${result.stored_filename} was uploaded successfully and produced ${result.chunks_created} indexed chunks.`,
      })
    } catch (error) {
      console.error('Error uploading document:', error)
      showError({
        title: 'Ingestion failed',
        message: getErrorDetail(error, 'The document could not be uploaded and ingested.'),
      })
    } finally {
      setIsUploading(false)
    }
  }

  const handleDelete = async (doc: DocumentItem) => {
    const label = doc.title || doc.source_reference || `Document ${doc.id}`
    const confirmed = window.confirm(`Delete "${label}" from the archive and remove its indexed chunks?`)
    if (!confirmed) return

    setIsDeletingId(doc.id)
    try {
      await adminAPI.deleteDocument(doc.id)
      await loadDocuments()
      showSuccess({
        title: 'Document deleted',
        message: `${label} was removed from the archive.`,
      })
    } catch (error) {
      console.error('Error deleting document:', error)
      showError({
        title: 'Delete failed',
        message: getErrorDetail(error, 'The document could not be removed.'),
      })
    } finally {
      setIsDeletingId(null)
    }
  }

  const sourceOptions = useMemo(() => {
    return Array.from(new Set(documents.map((doc) => (doc.source || 'unknown').toLowerCase()))).sort()
  }, [documents])

  const typeOptions = useMemo(() => {
    return Array.from(new Set(documents.map((doc) => (doc.source_type || 'pdf').toLowerCase()))).sort()
  }, [documents])

  const filteredDocuments = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()

    return documents.filter((doc) => {
      const label = `${doc.title || ''} ${doc.filename || ''} ${doc.source_reference || ''}`.toLowerCase()
      const matchesQuery = !query || label.includes(query)
      const matchesSource = sourceFilter === 'all' || (doc.source || 'unknown').toLowerCase() === sourceFilter
      const matchesType = typeFilter === 'all' || (doc.source_type || 'pdf').toLowerCase() === typeFilter
      return matchesQuery && matchesSource && matchesType
    })
  }, [documents, searchTerm, sourceFilter, typeFilter])

  const totalPages = Math.max(1, Math.ceil(filteredDocuments.length / pageSize))

  const paginatedDocuments = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return filteredDocuments.slice(start, start + pageSize)
  }, [currentPage, filteredDocuments])

  useEffect(() => {
    setCurrentPage(1)
  }, [searchTerm, sourceFilter, typeFilter])

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  const archiveMetrics = useMemo(() => {
    const totalDocuments = documents.length
    const totalChunks = documents.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0)
    const availableFiles = documents.filter((doc) => doc.file_exists).length
    const pdfDocuments = documents.filter((doc) => (doc.source_type || '').toLowerCase() === 'pdf').length
    const latestDocument = [...documents]
      .filter((doc) => doc.created_at)
      .sort((a, b) => new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime())[0]

    return {
      totalDocuments,
      totalChunks,
      availableFiles,
      pdfDocuments,
      latestDocument,
    }
  }, [documents])

  const formatDate = (value?: string) => {
    if (!value) return 'Unknown'
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return 'Unknown'
    return date.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const latestDocument = archiveMetrics.latestDocument
  const activityDate = latestDocument?.created_at ? formatDate(latestDocument.created_at) : '12 Apr 2026, 22:03'
  const activitySource = latestDocument?.source || 'Manual'
  const activityChunks = latestDocument?.chunk_count ?? 811

  return (
    <AdminShell
      title="Document Management"
      subtitle="Policy documents used by ArASSIST knowledge retrieval"
      fullWidth
    >
      <style>{`
        .document-management-screen {
          --admin-primary: #1E6B3B;
          --admin-accent: #B8860B;
          --card-bg: #FFFFFF;
          --page-bg: #F0F2F5;
          --text-dark: #333333;
          --text-light: #FFFFFF;
          --success-tint: #E0F0EA;
          --warning-tint: #F5EDD6;
          color: var(--text-dark);
        }

        .document-stats-grid {
          display: grid;
          gap: 1rem;
          grid-template-columns: repeat(3, minmax(0, 1fr));
        }

        .document-stat-card {
          background: var(--card-bg);
          border-radius: 8px;
          border-top: 4px solid var(--admin-primary);
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
          padding: 1rem;
        }

        .document-stat-value {
          color: var(--admin-accent);
          font-size: 2rem;
          font-weight: 700;
          line-height: 1.1;
        }

        .document-stat-label {
          color: var(--text-dark);
          font-size: 0.875rem;
          font-weight: 600;
          letter-spacing: 0.16em;
          margin-top: 0.55rem;
          text-transform: uppercase;
        }

        .document-stat-subtitle {
          color: var(--text-dark);
          font-size: 0.8rem;
          margin-top: 0.35rem;
        }

        .document-upload-card {
          background: var(--card-bg);
          border: 2px dashed var(--admin-accent);
          border-radius: 8px;
          padding: 1.5rem;
          text-align: center;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.05);
        }

        .document-upload-input {
          display: none;
        }

        .document-upload-select {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 152px;
          border: 1px solid var(--admin-accent);
          border-radius: 6px;
          background: var(--card-bg);
          color: var(--text-dark);
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 600;
          padding: 0.7rem 1rem;
          transition: border-color 160ms ease, color 160ms ease, background-color 160ms ease;
        }

        .document-upload-select:hover {
          border-color: var(--admin-primary);
          color: var(--admin-primary);
        }

        .document-upload-selection {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          color: var(--admin-primary);
          font-size: 0.95rem;
          font-weight: 600;
        }

        .document-progress-track {
          width: 100%;
          height: 6px;
          background: #E0E0E0;
          border-radius: 999px;
          overflow: hidden;
        }

        .document-progress-fill {
          height: 100%;
          background: var(--admin-primary);
          border-radius: inherit;
          transition: width 220ms ease;
          width: 0%;
        }

        .document-upload-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 0;
          border-radius: 6px;
          background: var(--admin-accent);
          color: var(--text-dark);
          cursor: pointer;
          font-size: 0.95rem;
          font-weight: 700;
          padding: 8px 16px;
          transition: background-color 160ms ease, color 160ms ease, opacity 160ms ease;
        }

        .document-upload-button:hover:not(:disabled) {
          background: var(--admin-primary);
          color: var(--text-light);
        }

        .document-upload-button:disabled {
          cursor: not-allowed;
          opacity: 0.5;
        }

        .document-activity-title {
          border-left: 4px solid var(--admin-accent);
          color: var(--text-dark);
          font-size: 1.1rem;
          font-weight: 700;
          padding-left: 0.75rem;
        }

        .document-activity-link {
          color: var(--admin-primary);
          font-size: 0.9rem;
          text-decoration: none;
        }

        .document-activity-link:hover {
          text-decoration: underline;
        }

        .document-activity-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          margin-top: 1.25rem;
        }

        .document-activity-item {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          color: var(--text-dark);
          font-size: 0.95rem;
        }

        .document-activity-dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: var(--admin-primary);
          flex-shrink: 0;
          margin-top: 0.38rem;
        }

        .document-status-badge {
          display: inline-block;
          border-radius: 20px;
          font-size: 0.7rem;
          font-weight: 700;
          letter-spacing: 0.08em;
          padding: 2px 10px;
          text-transform: uppercase;
        }

        .document-status-success {
          background: var(--success-tint);
          color: var(--admin-primary);
        }

        .document-status-failed {
          background: var(--warning-tint);
          color: var(--admin-accent);
        }

        .document-status-pending {
          background: var(--page-bg);
          color: var(--text-dark);
        }

        .document-table th {
          background: var(--page-bg);
          color: var(--admin-primary);
          font-size: 0.76rem;
          font-weight: 700;
          letter-spacing: 0.12em;
          text-transform: uppercase;
        }

        .document-table tr {
          background: var(--card-bg);
        }

        .document-table tbody tr:hover {
          background: var(--page-bg);
        }

        .document-table td,
        .document-table th {
          border-bottom: 1px solid var(--page-bg);
        }

        @media (max-width: 767px) {
          .document-stats-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />

      <div className="document-management-screen space-y-6">
        <section className="document-stats-grid">
          <article className="document-stat-card">
            <p className="document-stat-value">{archiveMetrics.totalDocuments.toLocaleString()}</p>
            <p className="document-stat-label">Documents</p>
          </article>
          <article className="document-stat-card">
            <p className="document-stat-value">{archiveMetrics.totalChunks.toLocaleString()}</p>
            <p className="document-stat-label">Chunks</p>
          </article>
          <article className="document-stat-card">
            <p className="document-stat-value">{archiveMetrics.availableFiles.toLocaleString()}</p>
            <p className="document-stat-label">Files On Disk</p>
            <p className="document-stat-subtitle">PDF Records · {archiveMetrics.pdfDocuments.toLocaleString()} files</p>
          </article>
        </section>

        <section className="document-upload-card">
          <div className="mx-auto max-w-3xl">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[8px] bg-[#F5EDD6] text-[#1E6B3B]">
              <UploadCloud className="h-6 w-6" />
            </div>
            <h2 className="mt-4 text-2xl font-semibold text-[#1E6B3B]">Upload new official documents to the knowledge base</h2>
            <p className="mt-2 text-sm text-[#333333]">
              Select a PDF file to ingest into ArASSIST without changing the current document workflow.
            </p>

            <div className="mt-6 flex flex-col items-center gap-4">
              <input
                ref={fileInputRef}
                id="document-upload-input"
                type="file"
                accept="application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="document-upload-input"
              />

              <label htmlFor="document-upload-input" className="document-upload-select">
                Choose file
              </label>

              {file ? (
                <div className="document-upload-selection">
                  <CheckCircle2 className="h-4.5 w-4.5" />
                  <span>{file.name}</span>
                </div>
              ) : (
                <p className="text-sm text-[#333333]">No file selected</p>
              )}

              <div className="w-full max-w-xl">
                <div className="document-progress-track">
                  <div className="document-progress-fill" style={{ width: `${uploadProgress}%` }} />
                </div>
              </div>

              <button
                type="button"
                onClick={handleUpload}
                disabled={!file || isUploading}
                className="document-upload-button"
              >
                {isUploading ? 'Uploading...' : 'Upload PDF'}
              </button>
            </div>
          </div>
        </section>

        <section className={panelClass}>
          <div className="border-b border-[#F0F2F5] bg-[#FFFFFF] px-5 py-4 sm:px-6">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#1E6B3B]">
                  Recent Documents
                </p>
                <p className="mt-2 text-sm text-[#333333]">{filteredDocuments.length} Records Found</p>
              </div>

              <div className="grid w-full gap-3 lg:max-w-3xl lg:grid-cols-[minmax(0,1fr)_180px_160px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#1E6B3B]" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by title or filename"
                    className="w-full rounded-[8px] border border-[#F0F2F5] bg-white px-11 py-3 text-sm text-[#333333] outline-none transition focus:border-[#B8860B] focus:ring-2 focus:ring-[#F5EDD6]"
                  />
                </div>

                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="w-full rounded-[8px] border border-[#F0F2F5] bg-white px-4 py-3 text-sm text-[#333333] outline-none transition focus:border-[#B8860B] focus:ring-2 focus:ring-[#F5EDD6]"
                >
                  <option value="all">All categories</option>
                  {sourceOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </option>
                  ))}
                </select>

                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full rounded-[8px] border border-[#F0F2F5] bg-white px-4 py-3 text-sm text-[#333333] outline-none transition focus:border-[#B8860B] focus:ring-2 focus:ring-[#F5EDD6]"
                >
                  <option value="all">All types</option>
                  {typeOptions.map((option) => (
                    <option key={option} value={option}>
                      {option.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="document-table hidden min-w-full border-collapse lg:table">
              <thead>
                <tr>
                  <th className="px-6 py-4 text-left">File Name</th>
                  <th className="px-6 py-4 text-left">Uploaded</th>
                  <th className="px-6 py-4 text-left">Chunks</th>
                  <th className="px-6 py-4 text-left">Status</th>
                  <th className="px-6 py-4 text-left">Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-sm text-[#333333]">
                      Loading documents...
                    </td>
                  </tr>
                ) : paginatedDocuments.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-sm text-[#333333]">
                      No documents match the current search or filters.
                    </td>
                  </tr>
                ) : (
                  paginatedDocuments.map((doc) => (
                    (() => {
                      const status = getDocumentStatus(doc)
                      return (
                        <tr key={doc.id}>
                          <td className="px-6 py-5">
                            <div className="flex items-center gap-3">
                              <FileText className="h-5 w-5 text-[#1E6B3B]" />
                              <span className="font-medium text-[#333333]">
                                {doc.title || doc.filename || doc.source_reference || `Document_${doc.id}.pdf`}
                              </span>
                            </div>
                          </td>
                          <td className="px-6 py-5 text-sm text-[#333333]">{formatDate(doc.created_at)}</td>
                          <td className="px-6 py-5 text-sm font-semibold text-[#333333]">
                            {(doc.chunk_count || 0).toLocaleString()}
                          </td>
                          <td className="px-6 py-5">
                            <span className={`document-status-badge document-status-${status}`}>{getDocumentStatusLabel(status)}</span>
                          </td>
                          <td className="px-6 py-5">
                            <button
                              type="button"
                              onClick={() => void handleDelete(doc)}
                              disabled={isDeletingId === doc.id}
                              className="inline-flex items-center gap-2 rounded-[6px] border border-[#B8860B] bg-white px-3 py-2 text-sm font-semibold text-[#333333] transition hover:bg-[#1E6B3B] hover:text-white disabled:opacity-50"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span>{isDeletingId === doc.id ? 'Deleting...' : 'Delete'}</span>
                            </button>
                          </td>
                        </tr>
                      )
                    })()
                  ))
                )}
              </tbody>
            </table>

            <div className="divide-y divide-[#F0F2F5] lg:hidden">
              {isLoading ? (
                <div className="px-5 py-8 text-sm text-[#333333]">Loading documents...</div>
              ) : paginatedDocuments.length === 0 ? (
                <div className="px-5 py-8 text-sm text-[#333333]">No documents match the current search or filters.</div>
              ) : (
                paginatedDocuments.map((doc) => (
                  (() => {
                    const status = getDocumentStatus(doc)
                    return (
                      <div key={doc.id} className="px-5 py-5">
                        <div className="flex items-start gap-3">
                          <FileText className="mt-0.5 h-5 w-5 text-[#1E6B3B]" />
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-[#333333]">
                              {doc.title || doc.filename || doc.source_reference || `Document_${doc.id}.pdf`}
                            </p>
                            <div className="mt-3 grid gap-2 text-sm text-[#333333] sm:grid-cols-2">
                              <p>Uploaded: {formatDate(doc.created_at)}</p>
                              <p>Chunks: {(doc.chunk_count || 0).toLocaleString()}</p>
                            </div>
                            <div className="mt-3 flex flex-wrap items-center gap-3">
                              <span className={`document-status-badge document-status-${status}`}>{getDocumentStatusLabel(status)}</span>
                              <button
                                type="button"
                                onClick={() => void handleDelete(doc)}
                                disabled={isDeletingId === doc.id}
                                className="inline-flex items-center gap-2 rounded-[6px] border border-[#B8860B] bg-white px-3 py-2 text-sm font-semibold text-[#333333] transition hover:bg-[#1E6B3B] hover:text-white disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                                <span>{isDeletingId === doc.id ? 'Deleting...' : 'Delete'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })()
                ))
              )}
            </div>
          </div>

          {!isLoading && filteredDocuments.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-[#F0F2F5] px-5 py-5 text-sm text-[#333333] sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p>
                Showing {filteredDocuments.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
                {Math.min(currentPage * pageSize, filteredDocuments.length)} of {filteredDocuments.length} documents
              </p>
              <div className="flex items-center gap-6">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  className="font-medium text-[#1E6B3B] disabled:opacity-40"
                >
                  Previous
                </button>
                <span className="text-[#333333]">
                  {currentPage} / {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                  className="font-medium text-[#1E6B3B] disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </section>

        <section className={`${compactCardClass} px-6 py-5`}>
          <div className="flex items-start justify-between gap-4">
            <h3 className="document-activity-title">Activity Log</h3>
            <button type="button" className="document-activity-link">
              Filter by date
            </button>
          </div>

          <div className="document-activity-list">
            <div className="document-activity-item">
              <span className="document-activity-dot" />
              <div className="flex flex-wrap items-center gap-2">
                <span>Most Recent Ingestion: {activityDate}</span>
                <span className="document-status-badge document-status-success">Success</span>
              </div>
            </div>
            <div className="document-activity-item">
              <span className="document-activity-dot" />
              <div>Archive Source: {activitySource.charAt(0).toUpperCase() + activitySource.slice(1)}</div>
            </div>
            <div className="document-activity-item">
              <span className="document-activity-dot" />
              <div>Latest Chunk Count: {activityChunks.toLocaleString()}</div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button type="button" className="document-activity-link">
              View all
            </button>
          </div>
        </section>
      </div>
    </AdminShell>
  )
}

export default AdminDocumentsPage
