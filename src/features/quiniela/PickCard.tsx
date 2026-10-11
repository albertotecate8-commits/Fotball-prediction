import { CheckCircle2, Circle, CircleDot, Lock, Minus, Plus } from 'lucide-react'
import { TeamCrest } from '@/components/TeamCrest'
import { MatchStatusBadge } from '@/components/StatusBadge'
import { formatShortDate, formatTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { MatchStatus, Outcome, Team } from '@/types/domain'

/** Lo mínimo que necesita la tarjeta (sirve para jornadas y para la quiniela continua). */
export interface PickMatch {
  kickoff_at: string
  status: MatchStatus
  elapsed: number | null
  home_goals: number | null
  away_goals: number | null
  result_confirmed: boolean
  competition: { name: string } | null
  home: Team
  away: Team
  score: { points: number } | null
  is_manual?: boolean
}

export interface PickValue { outcome: Outcome | null; home: number | null; away: number | null }

const outcomeOf = (h: number, a: number): Outcome => (h > a ? '1' : h < a ? '2' : 'X')
/** Completo = marcador de los dos equipos (el resultado 1/X/2 sale solo). */
export const isComplete = (v: PickValue) => v.home !== null && v.away !== null

/** Un partido: marcador obligatorio con botones − / + (sencillo con el pulgar). */
export function PickCard({ match: m, tz, value, disabled, saved, submitted, maxGoals, onChange, highlight }: {
  match: PickMatch; tz: string; value: PickValue; disabled: boolean; saved: boolean; submitted: boolean; maxGoals: number
  onChange: (v: PickValue) => void; highlight?: boolean
}) {
  const hasResult = (m.status === 'live' || m.status === 'finished') && m.home_goals !== null
  const complete = isComplete(value)
  const state = submitted ? 'Enviado' : disabled ? (complete ? 'Cerrado' : 'Sin pronóstico') : !complete ? 'Falta marcador' : saved ? 'Guardado' : 'Guardando…'

  const step = (side: 'home' | 'away', d: 1 | -1) => {
    const cur = value[side]
    // Desde vacío: «+» pone 1 y «−» pone 0.
    const n = cur === null ? (d > 0 ? 1 : 0) : Math.max(0, Math.min(maxGoals, cur + d))
    const next = { ...value, [side]: n }
    next.outcome = next.home !== null && next.away !== null ? outcomeOf(next.home, next.away) : null
    onChange(next)
  }
  const verdict = complete ? (value.home! > value.away! ? `Gana ${m.home.short_name}` : value.home! < value.away! ? `Gana ${m.away.short_name}` : 'Empate') : null

  const row = (side: 'home' | 'away') => {
    const team = side === 'home' ? m.home : m.away
    const v = value[side]
    return (
      <div key={side} className="flex items-center gap-3">
        <TeamCrest team={team} size={30} />
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={team.name}>{team.short_name}</span>
        {disabled ? (
          <span className="scoreline w-10 text-center text-2xl">{v ?? '–'}</span>
        ) : (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" aria-label={`Menos goles de ${team.name}`} onClick={() => step(side, -1)} disabled={v === 0}
              className="grid size-10 place-items-center rounded-xl border border-line-strong bg-surface-2 text-ink active:scale-95 disabled:opacity-35"><Minus className="size-5" /></button>
            <output aria-label={`Goles de ${team.name}`} className={cn('scoreline w-8 text-center text-3xl', v === null ? 'text-faint' : 'text-ink')}>{v ?? '–'}</output>
            <button type="button" aria-label={`Más goles de ${team.name}`} onClick={() => step(side, 1)} disabled={v === maxGoals}
              className="grid size-10 place-items-center rounded-xl border border-aqua/50 bg-aqua/15 text-aqua active:scale-95 disabled:opacity-35"><Plus className="size-5" /></button>
          </div>
        )}
      </div>
    )
  }

  return (
    <article className={cn('card p-3 transition', complete && 'border-aqua/30', highlight && !complete && 'border-gold/60 ring-2 ring-gold/30')}>
      <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5 truncate">{m.competition?.name ?? 'Partido'}{m.is_manual && <span className="shrink-0 rounded-full border border-gold/40 px-1.5 text-[9px] font-bold uppercase text-gold">Añadido por el admin</span>}</span>
        <span className="flex shrink-0 items-center gap-2">
          <MatchStatusBadge status={m.status} elapsed={m.elapsed} confirmed={m.result_confirmed} />
          <span className="capitalize">{formatShortDate(m.kickoff_at, tz)} · {formatTime(m.kickoff_at, tz)}</span>
        </span>
      </div>
      <div className="space-y-2.5">
        {row('home')}
        {row('away')}
      </div>
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold',
          state === 'Enviado' ? 'text-success' : state === 'Guardado' ? 'text-aqua' : state === 'Falta marcador' ? 'text-gold' : 'text-muted')}>
          {state === 'Falta marcador' || state === 'Sin pronóstico' ? <Circle className="size-3.5" /> : state === 'Guardando…' ? <CircleDot className="size-3.5" /> : state === 'Cerrado' ? <Lock className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} {state}
        </span>
        {m.score ? (
          <span className={cn('scoreline text-base', m.score.points === 5 ? 'text-aqua' : m.score.points === 3 ? 'text-success' : 'text-muted')}>+{m.score.points} pts</span>
        ) : hasResult ? (
          <span className="text-[11px] text-muted">Resultado: <span className="scoreline text-sm text-ink">{m.home_goals}-{m.away_goals}</span></span>
        ) : verdict ? <span className="text-[11px] font-semibold text-ink/80">{verdict}</span> : null}
      </div>
    </article>
  )
}
