import React from 'react'

interface TicketStatusTabsProps {
  activeTab: string
  onTabChange: (tab: string) => void
  counts: {
    all: number
    open: number
    assigned: number
    in_progress: number
    resolved: number
  }
}

const TicketStatusTabs: React.FC<TicketStatusTabsProps> = ({
  activeTab,
  onTabChange,
  counts,
}) => {
  const tabs = [
    { id: 'all', label: 'All Tickets', count: counts.all },
    { id: 'open', label: 'Open', count: counts.open },
    { id: 'assigned', label: 'Assigned', count: counts.assigned },
    { id: 'in_progress', label: 'In Progress', count: counts.in_progress },
    { id: 'resolved', label: 'Resolved', count: counts.resolved },
  ]

  return (
    <div className="flex space-x-1 border-b border-slate-200">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onTabChange(tab.id)}
          className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
            activeTab === tab.id
              ? 'text-primary-700 border-primary-600'
              : 'text-slate-500 border-transparent hover:text-slate-700 hover:border-slate-300'
          }`}
        >
          {tab.label}
          {tab.count > 0 && (
            <span className="ml-2 px-2 py-1 text-xs rounded-full bg-slate-100 text-slate-600">
              {tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

export default TicketStatusTabs
