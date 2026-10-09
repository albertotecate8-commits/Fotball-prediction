import { useNow } from '@/hooks/useServerClock'
import { countdownTo } from '@/lib/time'
import { cn } from '@/lib/cn'

const pad = (n: number) => String(n).padStart(2, '0')

/** Cuenta regresiva con la hora del servidor (no la del dispositivo). */
export function Countdown({ target, className, compact }: { target: string; className?: string; compact?: boolean }) {
  const now = useNow(1000)
  const c = countdownTo(target, now)
  if (c.totalSeconds === 0) return <span className={cn('display text-lg uppercase text-muted', className)}>Cerrada</span>
  const units = [
    ...(c.days > 0 ? [{ v: c.days, l: 'días' }] : []),
    { v: c.hours, l: 'h' },
    { v: c.minutes, l: 'min' },
    ...(c.days === 0 ? [{ v: c.seconds, l: 's' }] : []),
  ]
  const urgent = c.totalSeconds < 3600
  if (compact) {
    return <span className={cn('scoreline tabular-nums', urgent && 'text-danger', className)} role="timer">{units.map((u) => `${pad(u.v)}${u.l === 'días' ? 'd' : u.l === 'min' ? 'm' : u.l}`).join(' ')}</span>
  }
  return (
    <div className={cn('flex items-end gap-2', className)} role="timer" aria-label={`Faltan ${units.map((u) => `${u.v} ${u.l}`).join(' ')}`}>
      {units.map((u, i) => (
        <div key={u.l} className="flex items-end gap-2">
          {i > 0 && <span className="scoreline pb-3 text-2xl text-olive">:</span>}
          <div className="flex flex-col items-center">
            <span className={cn('scoreline text-4xl tabular-nums sm:text-5xl', urgent ? 'text-danger' : 'text-ink')}>{pad(u.v)}</span>
            <span className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted">{u.l}</span>
          </div>
        </div>
      ))}
    </div>
  )
}
