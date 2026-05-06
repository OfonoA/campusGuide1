import React, { useEffect, useMemo, useState } from 'react'
import { adminAPI } from '../../services/api'
import AdminShell from '../../components/admin/AdminShell'
import FeedbackToastStack from '../../components/feedback/FeedbackToastStack'
import { useFeedbackToasts } from '../../hooks/useFeedbackToasts'
import { FileText, Search, Trash2, UploadCloud } from 'lucide-react'
import { getErrorDetail } from '../../utils/errors'

const panelClass = 'overflow-hidden rounded-[1.5rem] border border-white/70 bg-white/88 shadow-[0_22px_54px_rgba(15,23,42,0.08)]'
const compactCardClass = 'rounded-[1.5rem] border border-white/70 bg-white/88 shadow-[0_22px_54px_rgba(15,23,42,0.08)]'

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

const AdminDocumentsPage: React.FC = () => {
  const [documents, setDocuments] = useState<DocumentItem[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [isDeletingId, setIsDeletingId] = useState<number | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sourceFilter, setSourceFilter] = useState<'all' | string>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [currentPage, setCurrentPage] = useState(1)
  const pageSize = 6
  const { toasts, dismissToast, showError, showInfo, showSuccess } = useFeedbackToasts()

  useEffect(() => {
    void loadDocuments()
  }, [])

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
      setFile(null)
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
    const totalDocuments = filteredDocuments.length
    const totalChunks = filteredDocuments.reduce((sum, doc) => sum + (doc.chunk_count || 0), 0)
    const availableFiles = filteredDocuments.filter((doc) => doc.file_exists).length
    const pdfDocuments = filteredDocuments.filter((doc) => (doc.source_type || '').toLowerCase() === 'pdf').length
    const latestCreatedAt = filteredDocuments[0]?.created_at

    return {
      totalDocuments,
      totalChunks,
      availableFiles,
      pdfDocuments,
      latestCreatedAt,
    }
  }, [filteredDocuments])

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

  return (
    <AdminShell
      title="Document Management"
      subtitle="Policy documents used by ArASSIST knowledge retrieval"
    >
      <FeedbackToastStack toasts={toasts} onDismiss={dismissToast} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <section className="rounded-[1.6rem] border border-white/75 bg-[linear-gradient(180deg,#ffffff_0%,#f6f9ff_100%)] px-5 py-6 shadow-[0_22px_54px_rgba(15,23,42,0.06)] sm:px-8 sm:py-8">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
              <div className="max-w-xl">
                <div className="flex h-16 w-16 items-center justify-center rounded-[1.1rem] bg-success-100 text-success-700">
                  <UploadCloud className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-[1.8rem] font-semibold text-slate-950">Archive and ingestion</h2>
                <p className="mt-3 max-w-xl text-base leading-7 text-slate-600">
                  Manage archived knowledge-base documents, upload new PDFs, and filter records quickly.
                </p>
              </div>

              <div className="w-full max-w-xl space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="min-w-0 text-sm text-slate-600"
                  />
                  <button
                    onClick={handleUpload}
                    disabled={!file || isUploading}
                    className="rounded-[1.2rem] bg-primary-700 px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-800 disabled:opacity-50"
                  >
                    {isUploading ? 'Uploading...' : 'Upload PDF'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className={panelClass}>
            <div className="border-b border-slate-200 bg-slate-100/80 px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600">
                  Uploaded Documents
                </p>
                <p className="text-sm text-slate-600">{filteredDocuments.length} Records Found</p>
              </div>

              <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_160px]">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search by title or filename"
                    className="w-full rounded-2xl border border-slate-200 bg-white px-11 py-3 text-sm text-slate-700 outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
                  />
                </div>

                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
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
                  className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-none transition focus:border-primary-500 focus:ring-4 focus:ring-primary-100"
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

            <div className="hidden grid-cols-[1.6fr_0.65fr_0.7fr_0.55fr_0.7fr] gap-5 px-6 py-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 lg:grid">
              <div>Title</div>
              <div>Source</div>
              <div>Type</div>
              <div>Chunks</div>
              <div>Actions</div>
            </div>

            {isLoading ? (
              <div className="px-6 py-8 text-sm text-slate-500">Loading documents...</div>
            ) : filteredDocuments.length === 0 ? (
              <div className="px-6 py-8 text-sm text-slate-500">No documents match the current search or filters.</div>
            ) : (
              paginatedDocuments.map((doc) => (
                <React.Fragment key={doc.id}>
                  <div className="hidden grid-cols-[1.6fr_0.65fr_0.7fr_0.55fr_0.7fr] gap-5 border-t border-slate-100 px-6 py-6 lg:grid">
                    <div className="flex items-center gap-4">
                      <FileText className="h-6 w-6 text-primary-700" />
                      <p className="text-[1.2rem] font-medium text-slate-900">
                        {doc.title || doc.filename || doc.source_reference || `Document_${doc.id}.pdf`}
                      </p>
                    </div>
                    <p className="text-sm capitalize text-slate-700">{doc.source || 'unknown'}</p>
                    <p className="text-sm uppercase text-slate-700">{doc.source_type || 'pdf'}</p>
                    <p className="text-sm font-semibold text-success-700">
                      {(doc.chunk_count || 0).toLocaleString()}
                    </p>
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => void handleDelete(doc)}
                        disabled={isDeletingId === doc.id}
                        className="inline-flex items-center gap-2 rounded-[1rem] border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                      >
                        <Trash2 className="h-4 w-4" />
                        <span>{isDeletingId === doc.id ? 'Deleting...' : 'Delete'}</span>
                      </button>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 px-5 py-5 lg:hidden">
                    <div className="flex items-start gap-4">
                      <FileText className="mt-0.5 h-5 w-5 text-primary-700" />
                      <div className="min-w-0 flex-1">
                        <p className="text-base font-medium text-slate-900">
                          {doc.title || doc.filename || doc.source_reference || `Document_${doc.id}.pdf`}
                        </p>
                        <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-2">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Source</p>
                            <p className="mt-1 capitalize">{doc.source || 'unknown'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Chunks</p>
                            <p className="mt-1 font-semibold text-success-700">
                              {(doc.chunk_count || 0).toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Type</p>
                            <p className="mt-1 uppercase">{doc.source_type || 'pdf'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Created</p>
                            <p className="mt-1">{formatDate(doc.created_at)}</p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleDelete(doc)}
                          disabled={isDeletingId === doc.id}
                          className="mt-4 inline-flex items-center gap-2 rounded-[1rem] border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                        >
                          <Trash2 className="h-4 w-4" />
                          <span>{isDeletingId === doc.id ? 'Deleting...' : 'Delete'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              ))
            )}

            {!isLoading && filteredDocuments.length > 0 ? (
              <div className="flex flex-col gap-3 border-t border-slate-200 px-5 py-5 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <p>
                  Showing {filteredDocuments.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
                  {Math.min(currentPage * pageSize, filteredDocuments.length)} of {filteredDocuments.length} documents
                </p>
                <div className="flex items-center gap-6">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                    disabled={currentPage === 1}
                    className="disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="text-slate-400">
                    {currentPage} / {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                    disabled={currentPage === totalPages}
                    className="disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>

        <div className="space-y-6">
          <section className={panelClass}>
            <div className="border-l-[4px] border-primary-700 px-6 py-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-600">Archive Snapshot</p>
              <div className="mt-6 grid grid-cols-2 gap-4">
                <div className="rounded-[1.1rem] bg-[#f5f6fb] px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Documents</p>
                  <p className="mt-2 text-[1.6rem] font-semibold text-primary-700">{archiveMetrics.totalDocuments.toLocaleString()}</p>
                </div>
                <div className="rounded-[1.1rem] bg-[#f5f6fb] px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Chunks</p>
                  <p className="mt-2 text-[1.6rem] font-semibold text-success-700">{archiveMetrics.totalChunks.toLocaleString()}</p>
                </div>
                <div className="rounded-[1.1rem] bg-[#f5f6fb] px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">Files On Disk</p>
                  <p className="mt-2 text-[1.6rem] font-semibold text-success-700">{archiveMetrics.availableFiles.toLocaleString()}</p>
                </div>
                <div className="rounded-[1.1rem] bg-[#f5f6fb] px-4 py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">PDF Records</p>
                  <p className="mt-2 text-[1.6rem] font-semibold text-primary-700">{archiveMetrics.pdfDocuments.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </section>

          <section className={`${compactCardClass} px-6 py-6`}>
            <h3 className="text-[1.5rem] font-semibold text-primary-700">Latest Activity</h3>
            <div className="mt-5 space-y-4 text-sm text-slate-700">
              <div className="flex items-center justify-between">
                <span>Most Recent Ingestion</span>
                <span className="font-semibold text-slate-950">{formatDate(archiveMetrics.latestCreatedAt)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Archive Source</span>
                <span className="font-semibold capitalize text-slate-950">{filteredDocuments[0]?.source || 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Latest Chunk Count</span>
                <span className="font-semibold text-slate-950">{(filteredDocuments[0]?.chunk_count || 0).toLocaleString()}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </AdminShell>
  )
}

export default AdminDocumentsPage
