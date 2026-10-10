import { useState } from 'react'
import { CheckCircle2, Circle, CircleDot } from 'lucide-react'
import { TeamCrest } from '@/components/TeamCrest'
import { MatchStatusBadge } from '@/components/StatusBadge'
import { formatShortDate, formatTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { Outcome, RoundMatch } from '@/types/domain'

export interface PickValue { outcome: Outcome | null; home: number | null; away: number | null }

const OPTIONS: { v: Outcome; label: (m: RoundMatch) => string; short: string }[] = [
  { v: '1', short: 'Local', label: (m) => m.home.short_name },
  { v: 'X', short: 'Empate', label: () => 'Empate' },
  { v: '2', short: 'Visita', label: (m) => m.away.short_name },
]

const outcomeOf = (h: number, a: number): Outcome => (h > a ? '1' : h < a ? '2' : 'X')

/** Un partido: tres opciones grandes (local, empate, visitante) y marcador exacto opcional. */
export function PickCard({ match: m, tz, value, disabled, saved, submitted, maxGoals, onChange }: {
  match: RoundMatch; tz: string; value: PickValue; disabled: boolean; saved: boolean; submitted: boolean; maxGoals: number
  onChange: (v: PickValue) => void
}) {
  const [showScore, setShowScore] = useState(value.home !== null)
  const hasResult = (m.status === 'live' || m.status === 'finished') && m.home_goals !== null
  const state = submitted ? 'Enviado' : !value.outcome ? 'Pendiente' : saved ? 'Guardado' : 'Sin guardar'

  const pickOutcome = (o: Outcome) => {
    // Si había marcador y ya no coincide con la opción elegida, se quita el marcador.
    const keepScore = value.home !== null && value.away !== null && outcomeOf(value.home, value.away) === o
    onChange({ outcome: o, home: keepScore ? value.home : null, away: keepScore ? value.away : null })
  }
  const setGoal = (side: 'home' | 'away', raw: string) => {
    const n = raw === '' ? null : Math.max(0, Math.min(maxGoals, Number(raw.replace(/\D/g, '')) || 0))
    const next = { ...value, [side]: n }
    if (next.home !== null && next.away !== null) next.outcome = outcomeOf(next.home, next.away)
    onChange(next)
  }

  return (
    <article className={cn('card p-3', value.outcome && 'border-aqua/25')}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="truncate">{m.competition?.name ?? 'Partido'}</span>
        <span className="flex shrink-0 items-center gap-2">
          <MatchStatusBadge status={m.status} elapsed={m.elapsed} confirmed={m.result_confirmed} />
          <span className="capitalize">{formatShortDate(m.kickoff_at, tz)} · {formatTime(m.kickoff_at, tz)}</span>
        </span>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2"><TeamCrest team={m.home} size={30} /><span className="truncate text-sm font-semibold">{m.home.name}</span></div>
        {hasResult ? <span className="scoreline shrink-0 text-xl">{m.home_goals}:{m.away_goals}</span> : <span className="shrink-0 text-xs text-faint">vs</span>}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2"><span className="truncate text-right text-sm font-semibold">{m.away.name}</span><TeamCrest team={m.away} size={30} /></div>
      </div>

      <div role="radiogroup" aria-label={`Resultado de ${m.home.name} contra ${m.away.name}`} className="grid grid-cols-3 gap-2">
        {OPTIONS.map((o) => {
          const active = value.outcome === o.v
          return (
            <button key={o.v} type="button" role="radio" aria-checked={active} disabled={disabled} onClick={() => pickOutcome(o.v)}
              className={cn('flex h-14 flex-col items-center justify-center rounded-xl border px-1 text-center transition disabled:cursor-default',
                active ? (o.v === 'X' ? 'border-silver bg-silver text-bg' : o.v === '1' ? 'border-red bg-red text-white' : 'border-aqua bg-aqua text-bg')
                  : 'border-line-strong bg-surface-2 text-ink hover:border-silver/40', disabled && !active && 'opacity-60')}>
              <span className="scoreline text-lg leading-none">{o.v}</span>
              <span className="mt-0.5 max-w-full truncate text-[11px] font-semibold">{o.label(m)}</span>
            </button>
          )
        })}
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold',
          state === 'Enviado' ? 'text-success' : state === 'Guardado' ? 'text-aqua' : state === 'Sin guardar' ? 'text-gold' : 'text-muted')}>
          {state === 'Pendiente' ? <Circle className="size-3.5" /> : state === 'Sin guardar' ? <CircleDot className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} {state}
        </span>
        {m.score ? (
          <span className={cn('scoreline text-base', m.score.points === 5 ? 'text-aqua' : m.score.points === 3 ? 'text-success' : 'text-muted')}>+{m.score.points} pts</span>
        ) : !disabled ? (
          <button type="button" className="text-[11px] font-semibold text-muted underline-offset-2 hover:text-ink hover:underline" onClick={() => setShowScore((s) => !s)}>
            {showScore ? 'Quitar marcador' : 'Marcador exacto (opcional, +2)'}
          </button>
        ) : value.home !== null ? <span className="text-[11px] text-muted">Tu marcador: {value.home}-{value.away}</span> : null}
      </div>
      {showScore && !disabled && (
        <div className="mt-2 flex items-center justify-center gap-2">
          <input aria-label={`Goles de ${m.home.name}`} inputMode="numeric" className="scoreline h-12 w-14 rounded-xl border border-line-strong bg-bg/70 text-center text-2xl focus:border-aqua focus:outline-none"
            value={value.home ?? ''} onChange={(e) => setGoal('home', e.target.value)} />
          <span className="scoreline text-xl text-muted">:</span>
          <input aria-label={`Goles de ${m.away.name}`} inputMode="numeric" className="scoreline h-12 w-14 rounded-xl border border-line-strong bg-bg/70 text-center text-2xl focus:border-aqua focus:outline-none"
            value={value.away ?? ''} onChange={(e) => setGoal('away', e.target.value)} />
        </div>
      )}
    </article>
  )
}
