import { Link } from 'react-router'
import { ChevronRight, ListChecks, Ticket } from 'lucide-react'
import { Countdown } from '@/components/Countdown'
import { RoundPhaseBadge, MyPredictionBadge } from '@/components/StatusBadge'
import { ButtonLink } from '@/components/ui/Button'
import { formatDateTime } from '@/lib/time'
import { roundCta } from './NextRoundCard'
import type { RoundListItem } from '@/types/domain'

/** Acceso compacto a la quiniela oficial (la jornada que publica el admin). */
export function QuinielaAccess({ round, tz }: { round: RoundListItem; tz: string }) {
  const cta = roundCta(round)
  const progress = round.match_count ? Math.round((round.my_items / round.match_count) * 100) : 0
  const showCountdown = round.phase === 'open' || round.phase === 'upcoming'
  return (
    <section className="card p-4" aria-labelledby="quiniela-oficial">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-aqua">Quiniela oficial</p>
          <h2 id="quiniela-oficial" className="display mt-1 truncate text-2xl font-semibold uppercase leading-none">{round.name}</h2>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><ListChecks className="size-3.5" /> {round.match_count} partidos</span>
            <span>Cierre: <span className="capitalize text-ink">{formatDateTime(round.deadline_at, tz)}</span></span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <RoundPhaseBadge phase={round.phase} />
          <MyPredictionBadge status={round.my_status} phase={round.phase} />
        </div>
      </div>
      {showCountdown && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted">
          {round.phase === 'upcoming' ? 'Abre en' : 'Cierra en'}
          <Countdown compact className="text-base text-ink" target={round.phase === 'upcoming' && round.opens_at ? round.opens_at : round.deadline_at} />
        </p>
      )}
      {round.phase === 'open' && round.my_status !== 'submitted' && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-muted"><span>Tu pronóstico</span><span className="font-semibold text-ink">{round.my_items}/{round.match_count}</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-red" style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <ButtonLink to={cta.to} variant={cta.variant} className="flex-1" icon={cta.icon}>{cta.label}</ButtonLink>
        <Link to="/quinielas" aria-label="Ver todas las jornadas" className="grid size-11 shrink-0 place-items-center rounded-full border border-line-strong text-muted transition hover:text-aqua">
          <ChevronRight className="size-5" />
        </Link>
      </div>
    </section>
  )
}

export function NoQuiniela() {
  return (
    <section className="card flex items-center gap-3 p-4">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-aqua/12 text-aqua"><Ticket className="size-5" /></span>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold">La quiniela oficial aún no tiene jornada</p>
        <p className="text-xs text-muted">Cuando se publique verás aquí sus partidos para pronosticar.</p>
      </div>
      <ButtonLink to="/quinielas" variant="secondary" size="sm">Quiniela</ButtonLink>
    </section>
  )
}
