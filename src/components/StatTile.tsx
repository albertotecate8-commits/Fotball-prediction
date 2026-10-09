import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export function StatTile({ label, value, sub, icon, accent, className }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; accent?: boolean; className?: string }) {
  return (
    <div className={cn('card flex min-w-0 flex-col gap-1 p-4', accent && 'border-lime/30', className)}>
      <div className="flex items-center justify-between gap-2 text-muted">
        <span className="truncate text-[11px] font-bold uppercase tracking-wider">{label}</span>
        {icon && <span className={cn('shrink-0', accent ? 'text-lime' : 'text-olive')}>{icon}</span>}
      </div>
      <span className={cn('scoreline text-3xl', accent ? 'text-lime' : 'text-ink')}>{value}</span>
      {sub && <span className="truncate text-xs text-muted">{sub}</span>}
    </div>
  )
}
