import React from 'react'

interface MetricCardProps {
  title: string
  value: string | number
  change: string
  changeType: 'positive' | 'negative' | 'neutral'
  icon: React.ReactNode
  trend?: React.ReactNode
}

const MetricCard: React.FC<MetricCardProps> = ({
  title,
  value,
  change,
  changeType,
  icon,
  trend,
}) => {
  const getChangeColor = () => {
    switch (changeType) {
      case 'positive':
        return 'text-green-600'
      case 'negative':
        return 'text-red-600'
      default:
        return 'text-slate-600'
    }
  }

  return (
    <div className="bg-white/90 backdrop-blur p-6 rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-4">
        <div className="w-12 h-12 bg-primary-50 rounded-2xl flex items-center justify-center">
          {icon}
        </div>
        {trend && (
          <div className="w-16 h-8">
            {trend}
          </div>
        )}
      </div>
      
      <div>
        <p className="text-sm font-medium text-slate-600 mb-1">{title}</p>
        <p className="text-2xl font-semibold text-ink mb-2">{value}</p>
        <p className={`text-sm font-medium ${getChangeColor()}`}>{change}</p>
      </div>
    </div>
  )
}

export default MetricCard
