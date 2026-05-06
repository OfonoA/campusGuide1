import React, { useState } from 'react'
import { Download, Calendar, FileText } from 'lucide-react'

interface ExportButtonProps {
  onExport: (format: 'pdf' | 'csv') => void
}

const ExportButton: React.FC<ExportButtonProps> = ({ onExport }) => {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-2 px-4 py-2.5 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors"
      >
        <Download className="w-4 h-4" />
        <span className="text-sm font-medium text-slate-700">Export Report</span>
      </button>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />

          {/* Dropdown */}
          <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 z-20">
            <div className="py-1">
              <button
                onClick={() => {
                  onExport('pdf')
                  setIsOpen(false)
                }}
                className="flex items-center space-x-3 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <FileText className="w-4 h-4" />
                <span>Export as PDF</span>
              </button>
              <button
                onClick={() => {
                  onExport('csv')
                  setIsOpen(false)
                }}
                className="flex items-center space-x-3 w-full px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                <Calendar className="w-4 h-4" />
                <span>Export as CSV</span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default ExportButton
