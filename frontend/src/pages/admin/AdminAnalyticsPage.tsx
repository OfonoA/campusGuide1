import React, { useEffect, useId, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Download,
  FileText,
  HelpCircle,
  Lightbulb,
  MessageSquare,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import AdminShell from '../../components/admin/AdminShell'
import { adminAPI, AdminAnalyticsTrendPoint, AdminConversationAnalyticsResponse } from '../../services/api'

type RangeKey = '7' | '30' | '90' | 'custom'
type TrendView = 'daily' | 'weekly' | 'monthly'

interface OverviewStats {
  totalQuestions: number
  answered: number
  answeredRate: number
  unanswered: number
  unansweredRate: number
  escalationRate: number
  helpfulRate: number
  kbCoverage: number
}

interface TrendPoint {
  label: string
  value: number
}

interface TopicRow {
  topic: string
  volume: number
  share: number
  escalationRate: number
  answerRate: number
}

interface HotspotRow {
  query: string
  escalationRate: number
  tickets: number
}

interface GapRow {
  area: string
  failedQuery: string
  suggestedDocument: string
}

interface UnansweredRow {
  query: string
}

interface FollowUpRow {
  topic: string
  tickets: number
  delta: number
}

interface AnalyticsDataset {
  overview: OverviewStats
  trends: Record<TrendView, TrendPoint[]>
  peakHours: TrendPoint[]
  peakDays: TrendPoint[]
  topics: TopicRow[]
  hotspots: HotspotRow[]
  feedback: {
    helpful: number
    notHelpful: number
  }
  noAnswerAreas: Array<{ topic: string; count: number }>
  gaps: GapRow[]
  unansweredExamples: UnansweredRow[]
  followUpInsights: FollowUpRow[]
}

const cardClass = 'rounded-[8px] bg-white shadow-[0_2px_6px_rgba(0,0,0,0.05)]'

const analyticsData: Record<RangeKey, AnalyticsDataset> = {
  '7': {
    overview: {
      totalQuestions: 2847,
      answered: 2412,
      answeredRate: 85,
      unanswered: 435,
      unansweredRate: 15,
      escalationRate: 12,
      helpfulRate: 78,
      kbCoverage: 68,
    },
    trends: {
      daily: [
        { label: 'Mon', value: 412 },
        { label: 'Tue', value: 389 },
        { label: 'Wed', value: 423 },
        { label: 'Thu', value: 445 },
        { label: 'Fri', value: 398 },
        { label: 'Sat', value: 267 },
        { label: 'Sun', value: 243 },
      ],
      weekly: [
        { label: 'Wk 1', value: 2847 },
        { label: 'Wk 2', value: 2732 },
        { label: 'Wk 3', value: 2914 },
        { label: 'Wk 4', value: 2659 },
      ],
      monthly: [
        { label: 'Jan', value: 9241 },
        { label: 'Feb', value: 8876 },
        { label: 'Mar', value: 9712 },
        { label: 'Apr', value: 9544 },
      ],
    },
    peakHours: [
      { label: '9am', value: 156 },
      { label: '10am', value: 245 },
      { label: '11am', value: 223 },
      { label: '12pm', value: 189 },
      { label: '1pm', value: 167 },
      { label: '2pm', value: 198 },
      { label: '3pm', value: 178 },
      { label: '4pm', value: 145 },
      { label: '7pm', value: 98 },
    ],
    peakDays: [
      { label: 'Mon', value: 412 },
      { label: 'Tue', value: 389 },
      { label: 'Wed', value: 423 },
      { label: 'Thu', value: 445 },
      { label: 'Fri', value: 398 },
      { label: 'Sat', value: 267 },
      { label: 'Sun', value: 243 },
    ],
    topics: [
      { topic: 'Fees', volume: 845, share: 29.7, escalationRate: 8, answerRate: 91 },
      { topic: 'Admissions', volume: 534, share: 18.8, escalationRate: 6, answerRate: 88 },
      { topic: 'Dead Year', volume: 423, share: 14.9, escalationRate: 24, answerRate: 45 },
      { topic: 'Transcript', volume: 356, share: 12.5, escalationRate: 15, answerRate: 72 },
      { topic: 'PRN', volume: 289, share: 10.2, escalationRate: 31, answerRate: 34 },
      { topic: 'Scholarships', volume: 234, share: 8.2, escalationRate: 11, answerRate: 82 },
      { topic: 'Registration', volume: 166, share: 5.8, escalationRate: 9, answerRate: 79 },
    ],
    hotspots: [
      { query: 'How to calculate dead year?', escalationRate: 67, tickets: 34 },
      { query: 'PRN not working', escalationRate: 58, tickets: 28 },
      { query: 'Transcript processing time', escalationRate: 42, tickets: 19 },
      { query: 'Late registration penalty', escalationRate: 38, tickets: 14 },
      { query: 'Scholarship deadline status', escalationRate: 31, tickets: 11 },
    ],
    feedback: {
      helpful: 1892,
      notHelpful: 534,
    },
    noAnswerAreas: [
      { topic: 'Scholarship deadlines', count: 43 },
      { topic: 'PRN generation', count: 38 },
      { topic: 'Dead year rules', count: 34 },
      { topic: 'Transcript fees', count: 27 },
      { topic: 'Hostel allocation', count: 22 },
    ],
    gaps: [
      {
        area: 'Fee Structure',
        failedQuery: 'What are late registration fees?',
        suggestedDocument: 'Add fees_2026.pdf',
      },
      {
        area: 'Dead Year',
        failedQuery: 'How to calculate dead year GPA?',
        suggestedDocument: 'Create dead_year_policy.md',
      },
      {
        area: 'Transcripts',
        failedQuery: 'How long for transcript processing?',
        suggestedDocument: 'Update transcript_faq.md',
      },
    ],
    unansweredExamples: [
      { query: 'how do I know if I have a dead year?' },
      { query: 'my PRN is showing invalid what should I do?' },
      { query: 'when are merit scholarship results coming?' },
      { query: 'can I get transcript same day?' },
      { query: 'what is the late registration penalty?' },
      { query: 'how much is replacement for a lost student ID?' },
    ],
    followUpInsights: [
      { topic: 'Dead year calculation', tickets: 47, delta: 12 },
      { topic: 'PRN not working', tickets: 34, delta: 5 },
      { topic: 'Transcript delays', tickets: 28, delta: -3 },
      { topic: 'Fee payment issues', tickets: 22, delta: 8 },
    ],
  },
  '30': {
    overview: {
      totalQuestions: 11238,
      answered: 9387,
      answeredRate: 84,
      unanswered: 1851,
      unansweredRate: 16,
      escalationRate: 13,
      helpfulRate: 77,
      kbCoverage: 66,
    },
    trends: {
      daily: [
        { label: 'May 1', value: 401 },
        { label: 'May 5', value: 418 },
        { label: 'May 9', value: 462 },
        { label: 'May 13', value: 447 },
        { label: 'May 17', value: 429 },
        { label: 'May 21', value: 474 },
        { label: 'May 25', value: 391 },
        { label: 'May 30', value: 382 },
      ],
      weekly: [
        { label: 'Wk 1', value: 2721 },
        { label: 'Wk 2', value: 2849 },
        { label: 'Wk 3', value: 2962 },
        { label: 'Wk 4', value: 2706 },
      ],
      monthly: [
        { label: 'Feb', value: 8876 },
        { label: 'Mar', value: 9712 },
        { label: 'Apr', value: 9544 },
        { label: 'May', value: 11238 },
      ],
    },
    peakHours: [
      { label: '9am', value: 541 },
      { label: '10am', value: 802 },
      { label: '11am', value: 744 },
      { label: '12pm', value: 633 },
      { label: '1pm', value: 588 },
      { label: '2pm', value: 657 },
      { label: '3pm', value: 592 },
      { label: '4pm', value: 501 },
      { label: '7pm', value: 326 },
    ],
    peakDays: [
      { label: 'Mon', value: 1631 },
      { label: 'Tue', value: 1584 },
      { label: 'Wed', value: 1674 },
      { label: 'Thu', value: 1722 },
      { label: 'Fri', value: 1603 },
      { label: 'Sat', value: 1112 },
      { label: 'Sun', value: 983 },
    ],
    topics: [
      { topic: 'Fees', volume: 3226, share: 28.7, escalationRate: 9, answerRate: 90 },
      { topic: 'Admissions', volume: 2051, share: 18.3, escalationRate: 7, answerRate: 87 },
      { topic: 'Dead Year', volume: 1734, share: 15.4, escalationRate: 26, answerRate: 43 },
      { topic: 'Transcript', volume: 1311, share: 11.7, escalationRate: 17, answerRate: 71 },
      { topic: 'PRN', volume: 1182, share: 10.5, escalationRate: 33, answerRate: 32 },
      { topic: 'Scholarships', volume: 988, share: 8.8, escalationRate: 12, answerRate: 81 },
      { topic: 'Registration', volume: 746, share: 6.6, escalationRate: 10, answerRate: 78 },
    ],
    hotspots: [
      { query: 'How to calculate dead year?', escalationRate: 69, tickets: 122 },
      { query: 'PRN not working', escalationRate: 61, tickets: 118 },
      { query: 'Transcript processing time', escalationRate: 45, tickets: 72 },
      { query: 'Late registration penalty', escalationRate: 39, tickets: 46 },
      { query: 'Scholarship deadline status', escalationRate: 34, tickets: 38 },
    ],
    feedback: {
      helpful: 7345,
      notHelpful: 2195,
    },
    noAnswerAreas: [
      { topic: 'PRN generation', count: 164 },
      { topic: 'Dead year rules', count: 147 },
      { topic: 'Scholarship deadlines', count: 143 },
      { topic: 'Transcript fees', count: 104 },
      { topic: 'Hostel allocation', count: 87 },
    ],
    gaps: [
      {
        area: 'PRN',
        failedQuery: 'Why is my PRN still invalid after payment?',
        suggestedDocument: 'Update prn_troubleshooting.md',
      },
      {
        area: 'Dead Year',
        failedQuery: 'How is dead year status determined?',
        suggestedDocument: 'Create dead_year_policy.md',
      },
      {
        area: 'Scholarships',
        failedQuery: 'When do scholarship results come out?',
        suggestedDocument: 'Add scholarships_calendar.pdf',
      },
    ],
    unansweredExamples: [
      { query: 'how do I know if I have a dead year?' },
      { query: 'my PRN is showing invalid what should I do?' },
      { query: 'when are merit scholarship results coming?' },
      { query: 'can I get transcript same day?' },
      { query: 'what is the late registration penalty?' },
      { query: 'where do I confirm hostel allocation?' },
    ],
    followUpInsights: [
      { topic: 'Dead year calculation', tickets: 182, delta: 12 },
      { topic: 'PRN not working', tickets: 156, delta: 5 },
      { topic: 'Transcript delays', tickets: 101, delta: -3 },
      { topic: 'Fee payment issues', tickets: 95, delta: 8 },
    ],
  },
  '90': {
    overview: {
      totalQuestions: 33894,
      answered: 28241,
      answeredRate: 83,
      unanswered: 5653,
      unansweredRate: 17,
      escalationRate: 14,
      helpfulRate: 76,
      kbCoverage: 64,
    },
    trends: {
      daily: [
        { label: 'Mar 5', value: 377 },
        { label: 'Mar 19', value: 421 },
        { label: 'Apr 2', value: 462 },
        { label: 'Apr 16', value: 449 },
        { label: 'Apr 30', value: 481 },
        { label: 'May 14', value: 453 },
        { label: 'May 28', value: 437 },
      ],
      weekly: [
        { label: 'Wk 3', value: 2611 },
        { label: 'Wk 6', value: 2762 },
        { label: 'Wk 9', value: 2895 },
        { label: 'Wk 12', value: 2742 },
      ],
      monthly: [
        { label: 'Mar', value: 9712 },
        { label: 'Apr', value: 9544 },
        { label: 'May', value: 11238 },
        { label: 'Jun', value: 3400 },
      ],
    },
    peakHours: [
      { label: '9am', value: 1622 },
      { label: '10am', value: 2471 },
      { label: '11am', value: 2286 },
      { label: '12pm', value: 1937 },
      { label: '1pm', value: 1814 },
      { label: '2pm', value: 1991 },
      { label: '3pm', value: 1862 },
      { label: '4pm', value: 1488 },
      { label: '7pm', value: 932 },
    ],
    peakDays: [
      { label: 'Mon', value: 4871 },
      { label: 'Tue', value: 4728 },
      { label: 'Wed', value: 4955 },
      { label: 'Thu', value: 5064 },
      { label: 'Fri', value: 4812 },
      { label: 'Sat', value: 3320 },
      { label: 'Sun', value: 2981 },
    ],
    topics: [
      { topic: 'Fees', volume: 9642, share: 28.5, escalationRate: 10, answerRate: 89 },
      { topic: 'Admissions', volume: 6110, share: 18.0, escalationRate: 8, answerRate: 86 },
      { topic: 'Dead Year', volume: 5324, share: 15.7, escalationRate: 27, answerRate: 42 },
      { topic: 'Transcript', volume: 4157, share: 12.3, escalationRate: 18, answerRate: 70 },
      { topic: 'PRN', volume: 3605, share: 10.6, escalationRate: 34, answerRate: 31 },
      { topic: 'Scholarships', volume: 2979, share: 8.8, escalationRate: 13, answerRate: 80 },
      { topic: 'Registration', volume: 2077, share: 6.1, escalationRate: 11, answerRate: 77 },
    ],
    hotspots: [
      { query: 'How to calculate dead year?', escalationRate: 70, tickets: 351 },
      { query: 'PRN not working', escalationRate: 63, tickets: 302 },
      { query: 'Transcript processing time', escalationRate: 46, tickets: 183 },
      { query: 'Late registration penalty', escalationRate: 42, tickets: 125 },
      { query: 'Scholarship deadline status', escalationRate: 36, tickets: 114 },
    ],
    feedback: {
      helpful: 21346,
      notHelpful: 6742,
    },
    noAnswerAreas: [
      { topic: 'PRN generation', count: 463 },
      { topic: 'Dead year rules', count: 418 },
      { topic: 'Scholarship deadlines', count: 392 },
      { topic: 'Transcript fees', count: 304 },
      { topic: 'Hostel allocation', count: 260 },
    ],
    gaps: [
      {
        area: 'PRN',
        failedQuery: 'Why is my PRN still invalid after payment?',
        suggestedDocument: 'Update prn_troubleshooting.md',
      },
      {
        area: 'Transcript',
        failedQuery: 'Can I get transcript same day?',
        suggestedDocument: 'Add transcript_service_levels.pdf',
      },
      {
        area: 'Dead Year',
        failedQuery: 'How is dead year status determined?',
        suggestedDocument: 'Create dead_year_policy.md',
      },
    ],
    unansweredExamples: [
      { query: 'how do I know if I have a dead year?' },
      { query: 'my PRN is showing invalid what should I do?' },
      { query: 'when are merit scholarship results coming?' },
      { query: 'can I get transcript same day?' },
      { query: 'what is the late registration penalty?' },
      { query: 'does hostel allocation come before registration?' },
    ],
    followUpInsights: [
      { topic: 'Dead year calculation', tickets: 521, delta: 14 },
      { topic: 'PRN not working', tickets: 448, delta: 9 },
      { topic: 'Transcript delays', tickets: 302, delta: -4 },
      { topic: 'Fee payment issues', tickets: 276, delta: 6 },
    ],
  },
  custom: {
    overview: {
      totalQuestions: 1674,
      answered: 1432,
      answeredRate: 86,
      unanswered: 242,
      unansweredRate: 14,
      escalationRate: 11,
      helpfulRate: 79,
      kbCoverage: 69,
    },
    trends: {
      daily: [
        { label: 'Day 1', value: 188 },
        { label: 'Day 2', value: 214 },
        { label: 'Day 3', value: 236 },
        { label: 'Day 4', value: 207 },
        { label: 'Day 5', value: 243 },
        { label: 'Day 6', value: 196 },
        { label: 'Day 7', value: 190 },
      ],
      weekly: [
        { label: 'Wk 1', value: 812 },
        { label: 'Wk 2', value: 862 },
        { label: 'Wk 3', value: 791 },
        { label: 'Wk 4', value: 845 },
      ],
      monthly: [
        { label: 'M1', value: 1674 },
        { label: 'M2', value: 1542 },
        { label: 'M3', value: 1702 },
        { label: 'M4', value: 1628 },
      ],
    },
    peakHours: [
      { label: '9am', value: 111 },
      { label: '10am', value: 176 },
      { label: '11am', value: 168 },
      { label: '12pm', value: 144 },
      { label: '1pm', value: 122 },
      { label: '2pm', value: 136 },
      { label: '3pm', value: 125 },
      { label: '4pm', value: 98 },
      { label: '7pm', value: 74 },
    ],
    peakDays: [
      { label: 'Mon', value: 247 },
      { label: 'Tue', value: 231 },
      { label: 'Wed', value: 254 },
      { label: 'Thu', value: 266 },
      { label: 'Fri', value: 240 },
      { label: 'Sat', value: 174 },
      { label: 'Sun', value: 162 },
    ],
    topics: [
      { topic: 'Fees', volume: 478, share: 28.6, escalationRate: 7, answerRate: 92 },
      { topic: 'Admissions', volume: 308, share: 18.4, escalationRate: 5, answerRate: 90 },
      { topic: 'Dead Year', volume: 236, share: 14.1, escalationRate: 22, answerRate: 48 },
      { topic: 'Transcript', volume: 209, share: 12.5, escalationRate: 13, answerRate: 74 },
      { topic: 'PRN', volume: 171, share: 10.2, escalationRate: 27, answerRate: 38 },
      { topic: 'Scholarships', volume: 152, share: 9.1, escalationRate: 10, answerRate: 83 },
      { topic: 'Registration', volume: 120, share: 7.1, escalationRate: 8, answerRate: 81 },
    ],
    hotspots: [
      { query: 'How to calculate dead year?', escalationRate: 63, tickets: 21 },
      { query: 'PRN not working', escalationRate: 54, tickets: 17 },
      { query: 'Transcript processing time', escalationRate: 39, tickets: 11 },
      { query: 'Late registration penalty', escalationRate: 34, tickets: 9 },
      { query: 'Scholarship deadline status', escalationRate: 30, tickets: 8 },
    ],
    feedback: {
      helpful: 1131,
      notHelpful: 300,
    },
    noAnswerAreas: [
      { topic: 'Scholarship deadlines', count: 24 },
      { topic: 'PRN generation', count: 21 },
      { topic: 'Dead year rules', count: 19 },
      { topic: 'Transcript fees', count: 15 },
      { topic: 'Hostel allocation', count: 13 },
    ],
    gaps: [
      {
        area: 'Fee Structure',
        failedQuery: 'What are late registration fees?',
        suggestedDocument: 'Add fees_2026.pdf',
      },
      {
        area: 'PRN',
        failedQuery: 'My PRN is invalid after paying, what next?',
        suggestedDocument: 'Update prn_troubleshooting.md',
      },
      {
        area: 'Transcript',
        failedQuery: 'Can I get transcript same day?',
        suggestedDocument: 'Update transcript_faq.md',
      },
    ],
    unansweredExamples: [
      { query: 'how do I know if I have a dead year?' },
      { query: 'my PRN is showing invalid what should I do?' },
      { query: 'when are merit scholarship results coming?' },
      { query: 'can I get transcript same day?' },
      { query: 'what is the late registration penalty?' },
    ],
    followUpInsights: [
      { topic: 'Dead year calculation', tickets: 29, delta: 7 },
      { topic: 'PRN not working', tickets: 22, delta: 4 },
      { topic: 'Transcript delays', tickets: 16, delta: -2 },
      { topic: 'Fee payment issues', tickets: 14, delta: 6 },
    ],
  },
}

const rangeLabels: Record<RangeKey, string> = {
  '7': 'Last 7 days',
  '30': 'Last 30 days',
  '90': 'Last 90 days',
  custom: 'Custom',
}

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value)

const normalizeTrendPoints = (points: AdminAnalyticsTrendPoint[] | TrendPoint[] | undefined): TrendPoint[] =>
  Array.isArray(points)
    ? points
        .filter((point) => point && typeof point.label === 'string' && typeof point.value === 'number')
        .map((point) => ({ label: point.label, value: point.value }))
    : []

const TrendLineChart: React.FC<{ points: TrendPoint[]; toneLabel: string }> = ({ points, toneLabel }) => {
  const chartId = useId()
  const width = 760
  const height = 260
  const left = 18
  const bottom = 28
  const top = 18
  const usableWidth = width - left * 2
  const usableHeight = height - top - bottom
  const maxValue = Math.max(...points.map((point) => point.value))
  const minValue = Math.min(...points.map((point) => point.value))
  const spread = Math.max(maxValue - minValue, 1)
  const step = points.length > 1 ? usableWidth / (points.length - 1) : usableWidth

  const path = points
    .map((point, index) => {
      const x = left + index * step
      const y = top + usableHeight - ((point.value - minValue) / spread) * usableHeight
      return `${index === 0 ? 'M' : 'L'} ${x} ${y}`
    })
    .join(' ')

  const areaPath = `${path} L ${left + usableWidth} ${height - bottom} L ${left} ${height - bottom} Z`

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#333333]">{toneLabel}</p>
          <p className="text-xs text-[#999999]">Hover points for exact values</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[260px] min-w-[640px] w-full">
          <defs>
            <linearGradient id={`${chartId}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#1E6B3B" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#1E6B3B" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          <line x1={left} y1={height - bottom} x2={width - left} y2={height - bottom} stroke="#D7DCE2" />
          <line x1={left} y1={top} x2={left} y2={height - bottom} stroke="#D7DCE2" />
          <path d={areaPath} fill={`url(#${chartId}-fill)`} />
          <path d={path} fill="none" stroke="#1E6B3B" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => {
            const x = left + index * step
            const y = top + usableHeight - ((point.value - minValue) / spread) * usableHeight
            return (
              <g key={`${point.label}-${point.value}`}>
                <circle cx={x} cy={y} r="5.5" fill="#B8860B">
                  <title>{`${point.label}: ${formatNumber(point.value)} queries`}</title>
                </circle>
                <text x={x} y={height - 8} textAnchor="middle" fontSize="11" fill="#666666">
                  {point.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

const DistributionDonut: React.FC<{ helpful: number; notHelpful: number }> = ({ helpful, notHelpful }) => {
  const total = helpful + notHelpful
  const helpfulPercent = total ? Math.round((helpful / total) * 100) : 0
  const notHelpfulPercent = 100 - helpfulPercent

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-center">
      <div
        className="mx-auto h-40 w-40 rounded-full"
        style={{
          background: `conic-gradient(#1E6B3B 0 ${helpfulPercent}%, #B8860B ${helpfulPercent}% 100%)`,
        }}
      >
        <div className="m-[18px] flex h-[calc(100%-36px)] w-[calc(100%-36px)] items-center justify-center rounded-full bg-white">
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[#999999]">Helpful</p>
            <p className="mt-1 text-2xl font-semibold text-[#1E6B3B]">{helpfulPercent}%</p>
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-3">
        <div className="rounded-[8px] bg-[#E0F0EA] px-4 py-3">
          <p className="text-sm font-semibold text-[#1E6B3B]">Helpful: {formatNumber(helpful)} ({helpfulPercent}%)</p>
        </div>
        <div className="rounded-[8px] bg-[#F5EDD6] px-4 py-3">
          <p className="text-sm font-semibold text-[#B8860B]">
            Not Helpful: {formatNumber(notHelpful)} ({notHelpfulPercent}%)
          </p>
        </div>
      </div>
    </div>
  )
}

const AdminAnalyticsPage: React.FC = () => {
  const [range, setRange] = useState<RangeKey>('7')
  const [trendView, setTrendView] = useState<TrendView>('daily')
  const [unansweredOpen, setUnansweredOpen] = useState(true)
  const [customStart, setCustomStart] = useState('2026-05-01')
  const [customEnd, setCustomEnd] = useState('2026-05-09')
  const [remoteDataset, setRemoteDataset] = useState<AnalyticsDataset | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let isMounted = true

    const fallbackDataset = analyticsData[range]

    const mapResponse = (response: AdminConversationAnalyticsResponse): AnalyticsDataset => ({
      overview: {
        totalQuestions: response.overview.total_questions,
        answered: response.overview.answered,
        answeredRate: response.overview.answered_rate,
        unanswered: response.overview.unanswered,
        unansweredRate: response.overview.unanswered_rate,
        escalationRate: response.overview.escalation_rate,
        helpfulRate: response.overview.helpful_rate,
        kbCoverage: response.overview.kb_coverage,
      },
      trends: {
        daily: normalizeTrendPoints(response.trends?.daily).length > 0
          ? normalizeTrendPoints(response.trends?.daily)
          : fallbackDataset.trends.daily,
        weekly: normalizeTrendPoints(response.trends?.weekly).length > 0
          ? normalizeTrendPoints(response.trends?.weekly)
          : fallbackDataset.trends.weekly,
        monthly: normalizeTrendPoints(response.trends?.monthly).length > 0
          ? normalizeTrendPoints(response.trends?.monthly)
          : fallbackDataset.trends.monthly,
      },
      peakHours: normalizeTrendPoints(response.peak_hours).length > 0
        ? normalizeTrendPoints(response.peak_hours)
        : fallbackDataset.peakHours,
      peakDays: normalizeTrendPoints(response.peak_days).length > 0
        ? normalizeTrendPoints(response.peak_days)
        : fallbackDataset.peakDays,
      topics: response.topics.map((row) => ({
        topic: row.topic,
        volume: row.volume,
        share: row.share,
        escalationRate: row.escalation_rate,
        answerRate: row.answer_rate,
      })),
      hotspots: response.hotspots.map((row) => ({
        query: row.query,
        escalationRate: row.escalation_rate,
        tickets: row.tickets,
      })),
      feedback: response.feedback,
      noAnswerAreas: response.no_answer_areas,
      gaps: response.gaps.map((row) => ({
        area: row.area,
        failedQuery: row.failed_query,
        suggestedDocument: row.suggested_document,
      })),
      unansweredExamples: response.unanswered_examples,
      followUpInsights: response.follow_up_insights,
    })

    const loadAnalytics = async () => {
      setIsLoading(true)
      try {
        const response = await adminAPI.getConversationAnalytics(
          range,
          range === 'custom' ? customStart : undefined,
          range === 'custom' ? customEnd : undefined,
        )
        if (!isMounted) return
        setRemoteDataset(mapResponse(response))
      } catch (error) {
        if (!isMounted) return
        setRemoteDataset(null)
      } finally {
        if (isMounted) {
          setIsLoading(false)
        }
      }
    }

    void loadAnalytics()

    return () => {
      isMounted = false
    }
  }, [customEnd, customStart, range])

  const dataset = remoteDataset || analyticsData[range]
  const trendPoints = dataset.trends[trendView].length > 0
    ? dataset.trends[trendView]
    : analyticsData[range].trends[trendView]
  const peakHourMax = Math.max(...dataset.peakHours.map((item) => item.value))
  const peakDayMax = Math.max(...dataset.peakDays.map((item) => item.value))
  const highestVolume = Math.max(...dataset.topics.map((row) => row.volume))

  const dateSummary = useMemo(() => {
    if (range !== 'custom') return rangeLabels[range]
    return `${customStart} to ${customEnd}`
  }, [customEnd, customStart, range])

  const handleRangeChange = (nextRange: RangeKey) => {
    setRange(nextRange)
    console.log('Conversation analytics range changed', {
      range: nextRange,
      startDate: nextRange === 'custom' ? customStart : undefined,
      endDate: nextRange === 'custom' ? customEnd : undefined,
    })
  }

  const handleExport = (format: 'csv' | 'pdf') => {
    const runExport = async () => {
      if (format === 'csv') {
        await adminAPI.exportConversationAnalyticsCsv(
          range,
          range === 'custom' ? customStart : undefined,
          range === 'custom' ? customEnd : undefined,
        )
        return
      }

      await adminAPI.exportConversationAnalyticsPdf(
        range,
        range === 'custom' ? customStart : undefined,
        range === 'custom' ? customEnd : undefined,
      )
    }

    void runExport()
  }

  const handleUnansweredAction = (action: string, query: string) => {
    console.log('Unanswered query admin action', { action, query, range })
  }

  const stats = [
    { label: 'Total Questions', value: formatNumber(dataset.overview.totalQuestions), tone: `${dateSummary}` },
    {
      label: 'Answered',
      value: `${formatNumber(dataset.overview.answered)} (${dataset.overview.answeredRate}%)`,
      tone: 'AI response coverage',
    },
    {
      label: 'Unanswered',
      value: `${formatNumber(dataset.overview.unanswered)} (${dataset.overview.unansweredRate}%)`,
      tone: 'Needs follow-up',
    },
    { label: 'Escalation Rate', value: `${dataset.overview.escalationRate}%`, tone: 'Ticket conversion' },
    { label: 'Helpful Rate', value: `${dataset.overview.helpfulRate}%`, tone: 'Student feedback' },
    { label: 'KB Coverage', value: `${dataset.overview.kbCoverage}%`, tone: 'Resolved from docs' },
  ]

  return (
    <AdminShell
      title="Conversation Analytics"
      subtitle="Monitor student queries, AI performance, and knowledge gaps"
      titleIcon={<BarChart3 />}
      workspaceLabel="Administration"
      fullWidth
      headerAction={
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => handleExport('csv')}
            className="inline-flex items-center gap-2 rounded-[8px] border border-[#1E6B3B]/15 bg-white px-3.5 py-2 text-sm font-semibold text-[#1E6B3B] shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:bg-[#F0F2F5]"
          >
            <Download className="h-4 w-4" />
            Export Report CSV
          </button>
          <button
            type="button"
            onClick={() => handleExport('pdf')}
            className="inline-flex items-center gap-2 rounded-[8px] bg-[#B8860B] px-3.5 py-2 text-sm font-semibold text-white shadow-[0_2px_6px_rgba(0,0,0,0.05)] transition hover:bg-[#9C7008]"
          >
            <FileText className="h-4 w-4" />
            Export Report PDF
          </button>
        </div>
      }
    >
      <div className="space-y-6">
        <h2 className="section-heading">
          Analytics Snapshot
          <span className="section-subtitle">Compare demand, answer quality, and knowledge coverage across the selected period.</span>
        </h2>
        <section className={`${cardClass} p-4 sm:p-5`}>
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <h2 className="card-title">
                <CalendarRange className="h-4 w-4" />
                Date Range
              </h2>
              <p className="section-subtitle">Switch views to compare recent demand, answer quality, and escalation pressure.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['7', '30', '90', 'custom'] as RangeKey[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => handleRangeChange(item)}
                  className={`rounded-[8px] px-4 py-2 text-sm font-semibold transition ${
                    range === item
                      ? 'bg-[#1E6B3B] text-white'
                      : 'border border-[#1E6B3B]/15 bg-white text-[#1E6B3B] hover:bg-[#F0F2F5]'
                  }`}
                >
                  {rangeLabels[item]}
                </button>
              ))}
            </div>
          </div>
          {range === 'custom' ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-[#333333]">
                Start date
                <input
                  type="date"
                  value={customStart}
                  onChange={(event) => {
                    setCustomStart(event.target.value)
                    console.log('Conversation analytics custom start updated', event.target.value)
                  }}
                  className="rounded-[8px] border border-[#1E6B3B]/15 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
              </label>
              <label className="flex flex-1 flex-col gap-2 text-sm font-medium text-[#333333]">
                End date
                <input
                  type="date"
                  value={customEnd}
                  onChange={(event) => {
                    setCustomEnd(event.target.value)
                    console.log('Conversation analytics custom end updated', event.target.value)
                  }}
                  className="rounded-[8px] border border-[#1E6B3B]/15 bg-white px-3 py-2 text-sm outline-none ring-0"
                />
              </label>
            </div>
          ) : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stats.map((item) => (
            <article key={item.label} className={`${cardClass} border-t-4 border-t-[#1E6B3B] p-5`}>
              <p className="text-sm font-medium text-[#999999]">{item.label}</p>
              <p className="mt-3 text-[1.9rem] font-semibold leading-none text-[#B8860B]">{item.value}</p>
              <p className="mt-3 text-sm text-[#666666]">{item.tone}</p>
            </article>
          ))}
        </section>

        <section className={`${cardClass} p-5`}>
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="card-title">
                <BarChart3 className="h-4 w-4" />
                Query Volume Trends
              </h2>
              <p className="section-subtitle">
                {isLoading ? 'Refreshing analytics data...' : 'Track daily, weekly, or monthly demand across the selected range.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(['daily', 'weekly', 'monthly'] as TrendView[]).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setTrendView(item)
                    console.log('Conversation analytics trend view changed', { range, trendView: item })
                  }}
                  className={`rounded-[8px] px-4 py-2 text-sm font-semibold capitalize transition ${
                    trendView === item
                      ? 'bg-[#1E6B3B] text-white'
                      : 'border border-[#1E6B3B]/15 bg-white text-[#1E6B3B] hover:bg-[#F0F2F5]'
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <TrendLineChart points={trendPoints} toneLabel={`${rangeLabels[range]} • ${trendView}`} />
        </section>

        <section className="grid gap-4 xl:grid-cols-2">
          <article className={`${cardClass} p-5`}>
            <h2 className="card-title">Peak Hours</h2>
            <p className="section-subtitle">Busiest chat windows for student queries.</p>
            <div className="mt-5 space-y-3">
              {dataset.peakHours.map((item) => {
                const isPeak = item.value === peakHourMax
                return (
                  <div key={item.label} className="grid grid-cols-[60px_1fr_56px] items-center gap-3 text-sm">
                    <span className="font-medium text-[#333333]">{item.label}</span>
                    <div className="h-3 overflow-hidden rounded-full bg-[#F0F2F5]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(item.value / peakHourMax) * 100}%`,
                          backgroundColor: isPeak ? '#B8860B' : '#1E6B3B',
                        }}
                        title={`${item.label}: ${formatNumber(item.value)} queries`}
                      />
                    </div>
                    <span className="text-right text-[#666666]">{formatNumber(item.value)}</span>
                  </div>
                )
              })}
            </div>
          </article>

          <article className={`${cardClass} p-5`}>
            <h2 className="card-title">Peak Days</h2>
            <p className="section-subtitle">Day-of-week traffic for the selected period.</p>
            <div className="mt-5 space-y-3">
              {dataset.peakDays.map((item) => {
                const isPeak = item.value === peakDayMax
                return (
                  <div key={item.label} className="grid grid-cols-[48px_1fr_62px] items-center gap-3 text-sm">
                    <span className="font-medium text-[#333333]">{item.label}</span>
                    <div className="h-3 overflow-hidden rounded-full bg-[#F0F2F5]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(item.value / peakDayMax) * 100}%`,
                          backgroundColor: isPeak ? '#B8860B' : '#1E6B3B',
                        }}
                        title={`${item.label}: ${formatNumber(item.value)} queries`}
                      />
                    </div>
                    <span className="text-right text-[#666666]">{formatNumber(item.value)}</span>
                  </div>
                )
              })}
            </div>
          </article>
        </section>

        <section className={`${cardClass} overflow-hidden`}>
          <div className="border-b border-[#F0F2F5] px-5 py-4">
            <h2 className="card-title">Top Question Themes</h2>
            <p className="section-subtitle">Most common topics, answer rates, and escalation pressure.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#F0F2F5] text-left text-[#666666]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Topic</th>
                  <th className="px-5 py-3 font-semibold">Volume</th>
                  <th className="px-5 py-3 font-semibold">% of Total</th>
                  <th className="px-5 py-3 font-semibold">Escalation Rate</th>
                  <th className="px-5 py-3 font-semibold">Answer Rate</th>
                </tr>
              </thead>
              <tbody>
                {dataset.topics.map((row) => (
                  <tr key={row.topic} className="border-t border-[#F0F2F5]">
                    <td className="px-5 py-4 font-semibold text-[#333333]">{row.topic}</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          row.volume >= highestVolume * 0.45 ? 'bg-[#E0F0EA] text-[#1E6B3B]' : 'bg-[#F0F2F5] text-[#666666]'
                        }`}
                      >
                        {formatNumber(row.volume)}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#666666]">{row.share}%</td>
                    <td className="px-5 py-4">
                      <span
                        className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
                          row.escalationRate > 20 ? 'bg-[#FBE9E7] text-[#D32F2F]' : 'bg-[#F5EDD6] text-[#B8860B]'
                        }`}
                      >
                        {row.escalationRate}%
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#333333]">{row.answerRate}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <article className={`${cardClass} p-5`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 text-[#B8860B]" />
              <div>
                <h2 className="card-title border-b-0 pb-0">Questions Most Likely to Become Tickets</h2>
                <p className="section-subtitle">These patterns are the strongest escalation candidates in the current window.</p>
              </div>
            </div>
            <div className="mt-5 space-y-3">
              {dataset.hotspots.map((item) => (
                <div key={item.query} className="rounded-[8px] border-l-4 border-l-[#B8860B] bg-[#F5EDD6] px-4 py-3">
                  <p className="text-sm font-semibold text-[#333333]">"{item.query}"</p>
                  <p className="mt-1 text-sm text-[#666666]">
                    {item.escalationRate}% escalate • {formatNumber(item.tickets)} tickets
                  </p>
                </div>
              ))}
            </div>
          </article>

          <div className="grid gap-4">
            <article className={`${cardClass} p-5`}>
              <h2 className="card-title">Feedback Distribution</h2>
              <p className="section-subtitle">Student-rated answer quality in the selected range.</p>
              <div className="mt-6">
                <DistributionDonut
                  helpful={dataset.feedback.helpful}
                  notHelpful={dataset.feedback.notHelpful}
                />
              </div>
            </article>

            <article className={`${cardClass} p-5`}>
              <h2 className="card-title">Common No-Answer Areas</h2>
              <p className="section-subtitle">Topics where the assistant still lacks reliable coverage.</p>
              <div className="mt-5 space-y-3">
                {dataset.noAnswerAreas.map((item) => (
                  <div key={item.topic} className="flex items-center justify-between gap-4 rounded-[8px] bg-[#F0F2F5] px-4 py-3">
                    <span className="font-medium text-[#333333]">{item.topic}</span>
                    <span className="text-sm font-semibold text-[#B8860B]">{item.count} unanswered</span>
                  </div>
                ))}
              </div>
            </article>
          </div>
        </section>

        <section className={`${cardClass} overflow-hidden`}>
          <div className="border-b border-[#F0F2F5] px-5 py-4">
            <div className="flex items-start gap-3">
              <Lightbulb className="mt-0.5 h-5 w-5 text-[#1E6B3B]" />
              <div>
                <h2 className="card-title border-b-0 pb-0">Knowledge Base Gaps</h2>
                <p className="section-subtitle">Recurring failed questions mapped to the next document or article to add.</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-[#F0F2F5] text-left text-[#666666]">
                <tr>
                  <th className="px-5 py-3 font-semibold">Gap Area</th>
                  <th className="px-5 py-3 font-semibold">Recurring Failed Queries</th>
                  <th className="px-5 py-3 font-semibold">Suggested Document</th>
                </tr>
              </thead>
              <tbody>
                {dataset.gaps.map((row) => (
                  <tr key={`${row.area}-${row.suggestedDocument}`} className="border-t border-[#F0F2F5]">
                    <td className="px-5 py-4 font-semibold text-[#333333]">{row.area}</td>
                    <td className="px-5 py-4 text-[#666666]">{row.failedQuery}</td>
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-full bg-[#E0F0EA] px-3 py-1 text-xs font-semibold text-[#1E6B3B]">
                        {row.suggestedDocument}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className={`${cardClass} overflow-hidden`}>
          <button
            type="button"
            onClick={() => setUnansweredOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
          >
            <div className="flex items-start gap-3">
              <MessageSquare className="mt-0.5 h-5 w-5 text-[#1E6B3B]" />
              <div>
                <h2 className="card-title border-b-0 pb-0">View Recent Unanswered Queries</h2>
                <p className="section-subtitle">Examples the assistant could not close confidently without staff support.</p>
              </div>
            </div>
            {unansweredOpen ? <ChevronUp className="h-5 w-5 text-[#666666]" /> : <ChevronDown className="h-5 w-5 text-[#666666]" />}
          </button>
          {unansweredOpen ? (
            <div className="border-t border-[#F0F2F5] px-5 py-5">
              <div className="space-y-4">
                {dataset.unansweredExamples.map((item) => (
                  <div key={item.query} className="rounded-[8px] bg-[#F0F2F5] px-4 py-4">
                    <p className="text-sm text-[#333333]">{item.query}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleUnansweredAction('escalate', item.query)}
                        className="rounded-[8px] bg-[#1E6B3B] px-3 py-2 text-xs font-semibold text-white"
                      >
                        Escalate
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUnansweredAction('mark_helpful', item.query)}
                        className="rounded-[8px] bg-[#E0F0EA] px-3 py-2 text-xs font-semibold text-[#1E6B3B]"
                      >
                        Mark as Helpful
                      </button>
                      <button
                        type="button"
                        onClick={() => handleUnansweredAction('suggest_kb_article', item.query)}
                        className="rounded-[8px] bg-[#F5EDD6] px-3 py-2 text-xs font-semibold text-[#B8860B]"
                      >
                        Suggest KB Article
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <section className={`${cardClass} p-5`}>
          <div className="flex items-start gap-3">
            <HelpCircle className="mt-0.5 h-5 w-5 text-[#1E6B3B]" />
            <div>
              <h2 className="card-title border-b-0 pb-0">Topics Requiring Human Help</h2>
              <p className="section-subtitle">Escalation-heavy issues that still require direct officer handling.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 xl:grid-cols-2">
            {dataset.followUpInsights.map((item) => {
              const trendUp = item.delta >= 0
              return (
                <div key={item.topic} className="rounded-[8px] border border-[#F0F2F5] bg-white px-4 py-4">
                  <div className="flex items-center justify-between gap-4">
                    <p className="font-semibold text-[#333333]">{item.topic}</p>
                    <span className="text-sm font-semibold text-[#666666]">{formatNumber(item.tickets)} tickets</span>
                  </div>
                  <div className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold"
                    style={{
                      backgroundColor: trendUp ? '#F5EDD6' : '#E0F0EA',
                      color: trendUp ? '#B8860B' : '#1E6B3B',
                    }}
                  >
                    {trendUp ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                    {trendUp ? 'Up' : 'Down'} {Math.abs(item.delta)}% from last month
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </AdminShell>
  )
}

export default AdminAnalyticsPage
