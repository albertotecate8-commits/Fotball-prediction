import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type Tone = 'lime' | 'olive' | 'neutral' | 'success' | 'danger' | 'live' | 'warning'
const tones: Record<Tone, string> = {
  lime: 'bg-lime/15 text-lime border-lime/30',
  olive: 'bg-olive/25 text-[#cfe07f] border-olive/50',
  neutral: 'bg-white/5 text-muted border-line',
  success: 'bg-success/12 text-success border-success/30',
  danger: 'bg-danger/12 text-danger border-danger/30',
  live: 'bg-live text-white border-live',
  warning: 'bg-amber-400/12 text-amber-300 border-amber-300/30',
}

export function Badge({ tone = 'neutral', children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide', tones[tone], className)}>
      {icon}
      {children}
    </span>
  )
}

export function LiveBadge({ minute }: { minute?: number | null }) {
  return (
    <Badge tone="live" icon={<span className="size-1.5 rounded-full bg-white animate-pulse-soft" />}>
      En vivo{minute ? ` ${minute}'` : ''}
    </Badge>
  )
}

export function TestDataBadge() {
  return <Badge tone="warning" className="normal-case tracking-normal">Datos de prueba</Badge>
}
