import React from 'react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts'

interface TicketVolumeChartProps {
  data: Array<{
    day: string
    tickets: number
  }>
}

const TicketVolumeChart: React.FC<TicketVolumeChartProps> = ({ data }) => {
  return (
    <div className="bg-white/90 backdrop-blur p-6 rounded-xl shadow-sm border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-ink">Ticket Volume</h3>
          <p className="text-sm text-slate-500">Last 7 days performance</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold text-ink">842</p>
          <p className="text-sm text-green-600 font-medium">+5.2%</p>
        </div>
      </div>

      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorTickets" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#003A8F" stopOpacity={0.8}/>
              <stop offset="95%" stopColor="#003A8F" stopOpacity={0}/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis 
            dataKey="day" 
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <YAxis 
            tick={{ fontSize: 12, fill: '#64748b' }}
            axisLine={{ stroke: '#e2e8f0' }}
          />
          <Tooltip 
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
            }}
          />
          <Area
            type="monotone"
            dataKey="tickets"
            stroke="#003A8F"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorTickets)"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

export default TicketVolumeChart
