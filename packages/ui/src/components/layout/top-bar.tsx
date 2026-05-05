import { PillButton } from '../common/pill-button.js'
import type { TimeRange } from '../../hooks/use-time-range.js'

interface TopBarProps {
  pageName: string
  companyName: string
  timeRange: TimeRange
  onTimeRangeChange: (range: TimeRange) => void
  user?: {
    email: string
    name: string
  }
}

const timeRangeOptions: Array<{ value: TimeRange; label: string }> = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'all', label: 'All time' },
]

export function TopBar({ pageName, companyName, timeRange, onTimeRangeChange, user }: TopBarProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-[#e7e5e4] bg-[#f2f1f0]">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-[#78716c]">{companyName}</span>
        <span className="text-[#78716c]">/</span>
        <span className="text-[#0c0a09] font-semibold">{pageName}</span>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          {timeRangeOptions.map((option) => (
            <PillButton
              key={option.value}
              label={option.label}
              active={timeRange === option.value}
              onClick={() => onTimeRangeChange(option.value)}
            />
          ))}
        </div>

        {user && (
          <div className="flex items-center gap-3 pl-6 border-l border-[#e7e5e4]">
            <div className="flex flex-col items-end">
              <span className="text-sm font-medium text-[#0c0a09] leading-none">{user.name}</span>
              <span className="text-xs text-[#78716c] leading-tight">{user.email}</span>
            </div>
            <a
              href="/auth/logout"
              className="text-sm text-[#ef4444] hover:text-[#dc2626] font-medium transition-colors"
            >
              Log out
            </a>
          </div>
        )}
      </div>
    </div>
  )
}
