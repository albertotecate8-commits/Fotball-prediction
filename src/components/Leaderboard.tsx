import { Crown } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/cn'
import type { LeaderboardRow } from '@/types/domain'

const PODIUM = [
  { ring: 'border-silver', text: 'text-silver', bg: 'from-silver/25', h: 'h-24', label: '2' },
  { ring: 'border-gold', text: 'text-gold', bg: 'from-gold/25', h: 'h-32', label: '1' },
  { ring: 'border-bronze', text: 'text-bronze', bg: 'from-bronze/25', h: 'h-20', label: '3' },
]

/** Podio para los tres primeros. Solo se muestra con datos reales. */
export function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const top = rows.filter((r) => r.rank_position <= 3).slice(0, 3)
  if (top.length === 0) return null
  // Orden visual 2 · 1 · 3
  const slots = [top[1], top[0], top[2]]
  return (
    <div className="grid grid-cols-3 items-end gap-2 sm:gap-4" aria-label="Podio">
      {slots.map((r, i) => {
        const s = PODIUM[i]!
        if (!r) return <div key={i} />
        return (
          <div key={r.user_id} className="flex flex-col items-center gap-2 animate-fade-up" style={{ animationDelay: `${i * 70}ms` }}>
            {i === 1 && <Crown className="size-6 text-gold-soft" aria-hidden />}
            <Avatar name={r.display_name} url={r.avatar_url} size={i === 1 ? 64 : 52} className={cn('border-2', s.ring)} />
            <span className={cn('max-w-full truncate text-sm font-semibold', r.is_me && 'text-gold-soft')}>{r.display_name}</span>
            <div className={cn('flex w-full flex-col items-center justify-start rounded-t-2xl border border-b-0 border-line bg-gradient-to-b to-transparent pt-2', s.bg, s.h)}>
              <span className={cn('scoreline text-3xl', s.text)}>{r.rank_position}</span>
              <span className="text-xs font-bold text-ink">{r.points} pts</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Tabla de clasificación: filas-tarjeta en móvil, columnas en escritorio. */
export function LeaderboardTable({ rows }: { rows: LeaderboardRow[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="hidden grid-cols-[3rem_1fr_4rem_4rem_4rem_4.5rem] gap-2 border-b border-line px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-muted sm:grid">
        <span>#</span><span>Jugador</span><span className="text-right">Pts</span><span className="text-right">Exactos</span><span className="text-right">1X2</span><span className="text-right">Error gol</span>
      </div>
      <ol>
        {rows.map((r) => (
          <li key={r.user_id}
            className={cn('grid grid-cols-[2.25rem_1fr_auto] items-center gap-x-3 gap-y-1 border-b border-line px-4 py-3 last:border-b-0 sm:grid-cols-[3rem_1fr_4rem_4rem_4rem_4.5rem] sm:gap-2',
              r.is_me && 'bg-gold-soft/[0.07] shadow-[inset_3px_0_0_var(--color-gold-soft)]')}
            aria-current={r.is_me ? 'true' : undefined}>
            <span className={cn('scoreline text-xl', r.rank_position === 1 ? 'text-gold-soft' : r.rank_position === 2 ? 'text-silver' : r.rank_position === 3 ? 'text-bronze' : 'text-muted')}>
              {r.rank_position}
            </span>
            <span className="flex min-w-0 items-center gap-3">
              <Avatar name={r.display_name} url={r.avatar_url} size={34} highlight={r.is_me} />
              <span className="min-w-0">
                <span className="block truncate font-semibold">{r.display_name}{r.is_me && <span className="ml-1.5 text-xs text-gold-soft">(tú)</span>}</span>
                <span className="block text-xs text-muted sm:hidden">{r.exact_hits} exactos · {r.outcome_hits} 1X2 · error {r.goal_error}</span>
              </span>
            </span>
            <span className="scoreline text-right text-2xl sm:text-xl">{r.points}</span>
            <span className="hidden text-right tabular-nums sm:block">{r.exact_hits}</span>
            <span className="hidden text-right tabular-nums sm:block">{r.outcome_hits}</span>
            <span className="hidden text-right tabular-nums text-muted sm:block">{r.goal_error}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}
