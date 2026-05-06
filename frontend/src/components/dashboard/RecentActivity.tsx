import React from 'react'
import { MessageSquare, FileText, AlertTriangle, Clock } from 'lucide-react'

interface ActivityItem {
  id: number
  type: 'ticket' | 'document' | 'warning'
  title: string
  description: string
  timestamp: string
  timeAgo: string
}

interface RecentActivityProps {
  activities: ActivityItem[]
}

const RecentActivity: React.FC<RecentActivityProps> = ({ activities }) => {
  const getIcon = (type: ActivityItem['type']) => {
    switch (type) {
      case 'ticket':
        return <MessageSquare className="w-5 h-5" />
      case 'document':
        return <FileText className="w-5 h-5" />
      case 'warning':
        return <AlertTriangle className="w-5 h-5" />
      default:
        return <MessageSquare className="w-5 h-5" />
    }
  }

  const getIconColor = (type: ActivityItem['type']) => {
    switch (type) {
      case 'ticket':
        return 'bg-blue-100 text-blue-600'
      case 'document':
        return 'bg-green-100 text-green-600'
      case 'warning':
        return 'bg-yellow-100 text-yellow-600'
      default:
        return 'bg-slate-100 text-slate-600'
    }
  }

  return (
    <div className="bg-white/90 backdrop-blur p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-semibold text-ink">Recent Activity</h3>
        <button className="text-sm text-primary-700 hover:text-primary-800 font-medium">
          View all activity {'>'}
        </button>
      </div>

      <div className="space-y-4">
        {activities.map((activity) => (
          <div key={activity.id} className="flex items-start space-x-3 p-3 hover:bg-slate-50 rounded-xl transition-colors">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${getIconColor(activity.type)}`}>
              {getIcon(activity.type)}
            </div>
            
            <div className="flex-1 min-w-0">
              <h4 className="text-sm font-medium text-ink mb-1">
                {activity.title}
              </h4>
              <p className="text-sm text-slate-600 mb-2">
                {activity.description}
              </p>
              <div className="flex items-center text-xs text-slate-400">
                <Clock className="w-3 h-3 mr-1" />
                {activity.timeAgo}
              </div>
            </div>
          </div>
        ))}

        {activities.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-slate-500 text-sm">No recent activity</p>
            <p className="text-slate-400 text-xs mt-1">Activity will appear here as it happens</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default RecentActivity
