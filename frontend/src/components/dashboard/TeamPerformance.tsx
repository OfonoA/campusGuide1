import React, { useState } from 'react'
import { Search, UserPlus } from 'lucide-react'

interface TeamMember {
  id: number
  name: string
  role: string
  avatar: string
  status: 'online' | 'offline' | 'away'
  openTickets: number
  solvedToday: number
  avgResponse: string
}

interface TeamPerformanceProps {
  teamMembers: TeamMember[]
}

const TeamPerformance: React.FC<TeamPerformanceProps> = ({ teamMembers }) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)

  const filteredMembers = teamMembers.filter(member =>
    member.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    member.role.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const getStatusColor = (status: TeamMember['status']) => {
    switch (status) {
      case 'online':
        return 'bg-green-500'
      case 'away':
        return 'bg-yellow-500'
      case 'offline':
        return 'bg-slate-400'
      default:
        return 'bg-slate-400'
    }
  }

  const getStatusText = (status: TeamMember['status']) => {
    switch (status) {
      case 'online':
        return 'Online'
      case 'away':
        return 'Away'
      case 'offline':
        return 'Offline'
      default:
        return 'Offline'
    }
  }

  return (
    <div className="bg-white/90 backdrop-blur p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-ink mb-4">Team Performance</h3>
        
        {/* Search and Invite */}
        <div className="flex items-center space-x-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400 w-4 h-4" />
            <input
              type="text"
              placeholder="Filter agents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <button
            onClick={() => setShowInviteModal(true)}
            className="px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors flex items-center space-x-2 shadow-sm"
          >
            <UserPlus className="w-4 h-4" />
            <span>Invite</span>
          </button>
        </div>
      </div>

      {/* Team Members List */}
      <div className="space-y-3">
        {filteredMembers.map((member) => (
          <div key={member.id} className="flex items-center justify-between p-4 border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            <div className="flex items-center space-x-4">
              {/* Avatar */}
              <div className="relative">
                <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                  <span className="text-primary-700 font-medium">
                    {member.name.split(' ').map(n => n[0]).join('').toUpperCase()}
                  </span>
                </div>
                <div className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${getStatusColor(member.status)}`}></div>
              </div>

              {/* Name and Role */}
              <div>
                <h4 className="text-sm font-medium text-ink">{member.name}</h4>
                <p className="text-xs text-slate-500">{member.role}</p>
              </div>
            </div>

            {/* Status */}
            <div className="flex items-center space-x-2">
              <span className={`text-xs font-medium ${getStatusColor(member.status).replace('bg-', 'text-')}`}>
                {getStatusText(member.status)}
              </span>
            </div>

            {/* Metrics */}
            <div className="flex items-center space-x-6 text-sm">
              <div className="text-center">
                <p className="font-medium text-ink">{member.openTickets}</p>
                <p className="text-xs text-slate-500">Open</p>
              </div>
              <div className="text-center">
                <p className="font-medium text-ink">{member.solvedToday}</p>
                <p className="text-xs text-slate-500">Solved Today</p>
              </div>
              <div className="text-center">
                <p className="font-medium text-ink">{member.avgResponse}</p>
                <p className="text-xs text-slate-500">Avg Response</p>
              </div>
            </div>
          </div>
        ))}

        {filteredMembers.length === 0 && (
          <div className="text-center py-8">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <UserPlus className="w-6 h-6 text-slate-400" />
            </div>
            <p className="text-slate-500 text-sm">No team members found</p>
            <p className="text-slate-400 text-xs mt-1">Try adjusting your search or invite new members</p>
          </div>
        )}
      </div>

      {/* Invite Modal (placeholder) */}
      {showInviteModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white/95 backdrop-blur rounded-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold text-ink mb-4">Invite Team Member</h3>
            <p className="text-slate-600 mb-4">Invite functionality coming soon...</p>
            <button
              onClick={() => setShowInviteModal(false)}
              className="w-full px-4 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-xl transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default TeamPerformance
