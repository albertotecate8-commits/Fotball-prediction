import { CheckCircle2, Circle, CircleDot, Lock, XCircle } from 'lucide-react'
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
  score: { points: number; outcome_hit?: boolean } | null
  is_manual?: boolean
}

export interface PickValue { outcome: Outcome | null; home: number | null; away: number | null }

/** Completo = eligió quién gana, empate o quién pierde. */
export const isComplete = (v: PickValue) => v.outcome !== null
export const outcomeLabel = (o: Outcome | null, m: Pick<PickMatch, 'home' | 'away'>) =>
  o === '1' ? `Gana ${m.home.short_name}` : o === '2' ? `Gana ${m.away.short_name}` : o === 'X' ? 'Empate' : '—'

/** Un partido: tres botones grandes (local · empate · visita), fáciles con el pulgar. */
export function PickCard({ match: m, tz, value, disabled, saved, submitted, onChange, highlight }: {
  match: PickMatch; tz: string; value: PickValue; disabled: boolean; saved: boolean; submitted: boolean
  onChange: (v: PickValue) => void; highlight?: boolean
}) {
  const hasResult = (m.status === 'live' || m.status === 'finished') && m.home_goals !== null
  const complete = isComplete(value)
  const state = submitted ? 'Enviado' : disabled ? (complete ? 'Cerrado' : 'Sin pronóstico') : !complete ? 'Elige un resultado' : saved ? 'Guardado' : 'Guardando…'
  const choose = (o: Outcome) => onChange({ outcome: value.outcome === o ? null : o, home: null, away: null })

  const option = (o: Outcome, label: string, team?: Team) => {
    const active = value.outcome === o
    return (
      <button key={o} type="button" disabled={disabled} aria-pressed={active} onClick={() => choose(o)}
        aria-label={o === 'X' ? 'Empate' : `Gana ${team!.name}`}
        className={cn('flex min-h-[86px] flex-1 flex-col items-center justify-center gap-1.5 rounded-2xl border px-1.5 py-2 text-center transition active:scale-[0.97]',
          active ? 'border-aqua bg-aqua/15 text-ink shadow-[0_0_0_1px_var(--color-aqua)]' : 'border-line-strong bg-surface-2 text-ink/85',
          disabled && !active && 'opacity-45', disabled && 'cursor-default active:scale-100')}>
        {team ? <TeamCrest team={team} size={30} /> : <span className="scoreline grid size-[30px] place-items-center text-2xl text-muted">=</span>}
        <span className="line-clamp-2 text-[12px] font-semibold leading-tight">{label}</span>
      </button>
    )
  }

  return (
    <article className={cn('card p-3 transition', complete && 'border-aqua/30', highlight && !complete && 'border-gold/60 ring-2 ring-gold/30')}>
      <div className="mb-2.5 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="flex min-w-0 items-center gap-1.5 truncate">{m.competition?.name ?? 'Partido'}</span>
        <span className="flex shrink-0 items-center gap-2">
          <MatchStatusBadge status={m.status} elapsed={m.elapsed} confirmed={m.result_confirmed} />
          <span className="capitalize">{formatShortDate(m.kickoff_at, tz)} · {formatTime(m.kickoff_at, tz)}</span>
        </span>
      </div>
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
        <span className="min-w-0 flex-1 truncate" title={m.home.name}>{m.home.short_name}</span>
        {hasResult ? <span className="scoreline shrink-0 text-xl">{m.home_goals}-{m.away_goals}</span> : <span className="shrink-0 text-xs text-faint">vs</span>}
        <span className="min-w-0 flex-1 truncate text-right" title={m.away.name}>{m.away.short_name}</span>
      </div>
      <div role="group" aria-label={`Resultado de ${m.home.name} contra ${m.away.name}`} className="flex gap-2">
        {option('1', `Gana ${m.home.short_name}`, m.home)}
        {option('X', 'Empate')}
        {option('2', `Gana ${m.away.short_name}`, m.away)}
      </div>
      <div className="mt-2.5 flex items-center justify-between gap-2 border-t border-line pt-2.5">
        <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold',
          state === 'Enviado' ? 'text-success' : state === 'Guardado' ? 'text-aqua' : state === 'Elige un resultado' ? 'text-gold' : 'text-muted')}>
          {state === 'Elige un resultado' || state === 'Sin pronóstico' ? <Circle className="size-3.5" /> : state === 'Guardando…' ? <CircleDot className="size-3.5" /> : state === 'Cerrado' ? <Lock className="size-3.5" /> : <CheckCircle2 className="size-3.5" />} {state}
        </span>
        {m.score && (m.status === 'live' || m.status === 'suspended') ? (
          // En vivo todavía no es acierto ni fallo: solo cómo va.
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-live"><span className="size-1.5 animate-pulse-soft rounded-full bg-live" />{(m.score.outcome_hit ?? m.score.points > 0) ? 'Por ahora vas acertando' : 'Por ahora no'}</span>
        ) : m.score && m.status === 'finished' && m.result_confirmed ? (
          (m.score.outcome_hit ?? m.score.points > 0)
            ? <span className="inline-flex items-center gap-1 text-xs font-bold text-success"><CheckCircle2 className="size-4" /> Acierto</span>
            : <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted"><XCircle className="size-4" /> Fallo</span>
        ) : complete ? <span className="text-[11px] font-semibold text-ink/80">{outcomeLabel(value.outcome, m)}</span> : null}
      </div>
    </article>
  )
}
