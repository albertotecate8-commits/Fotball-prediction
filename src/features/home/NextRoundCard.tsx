import { CalendarClock, CheckCircle2, ListChecks, Lock, PencilLine, Send, Ticket } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'
import { Countdown } from '@/components/Countdown'
import { HeroArt } from '@/components/HeroArt'
import { RoundPhaseBadge } from '@/components/StatusBadge'
import { formatDateTime } from '@/lib/time'
import type { RoundListItem } from '@/types/domain'

/** Estado del botón principal según la fase de la jornada y la quiniela del jugador. */
export function roundCta(r: RoundListItem) {
  if (r.my_status === 'submitted') return { label: 'Quiniela enviada', to: `/quinielas/${r.round_id}`, icon: <CheckCircle2 className="size-5" />, variant: 'secondary' as const }
  if (r.phase === 'open') {
    if (r.my_items >= r.match_count && r.match_count > 0) return { label: 'Revisar y enviar', to: `/quinielas/${r.round_id}/jugar`, icon: <Send className="size-5" />, variant: 'primary' as const }
    if (r.my_items > 0) return { label: 'Continuar borrador', to: `/quinielas/${r.round_id}/jugar`, icon: <PencilLine className="size-5" />, variant: 'primary' as const }
    return { label: 'Hacer mi quiniela', to: `/quinielas/${r.round_id}/jugar`, icon: <Ticket className="size-5" />, variant: 'primary' as const }
  }
  if (r.phase === 'upcoming') return { label: 'Abre pronto', to: `/quinielas/${r.round_id}`, icon: <CalendarClock className="size-5" />, variant: 'secondary' as const }
  return { label: 'Jornada cerrada', to: `/quinielas/${r.round_id}`, icon: <Lock className="size-5" />, variant: 'secondary' as const }
}

export function NextRoundCard({ round, tz }: { round: RoundListItem; tz: string }) {
  const cta = roundCta(round)
  const countdownTarget = round.phase === 'upcoming' && round.opens_at ? round.opens_at : round.deadline_at
  const showCountdown = round.phase === 'open' || round.phase === 'upcoming'
  const progress = round.match_count ? Math.round((round.my_items / round.match_count) * 100) : 0
  return (
    <section aria-labelledby="next-round" className="card relative overflow-hidden p-5 sm:p-6 animate-fade-up">
      <HeroArt />
      <div className="relative">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-lime">
            {round.phase === 'open' ? 'Jornada abierta' : round.phase === 'upcoming' ? 'Próxima jornada' : 'Jornada actual'}
          </span>
          <RoundPhaseBadge phase={round.phase} />
        </div>
        <h2 id="next-round" className="display text-3xl font-semibold uppercase leading-none sm:text-4xl">{round.name}</h2>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
          <span className="inline-flex items-center gap-1.5"><CalendarClock className="size-4 text-olive" /> Cierre: <span className="capitalize text-ink">{formatDateTime(round.deadline_at, tz)}</span></span>
          <span className="inline-flex items-center gap-1.5"><ListChecks className="size-4 text-olive" /> {round.match_count} partidos</span>
        </div>

        {showCountdown && (
          <div className="mt-5">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">{round.phase === 'upcoming' ? 'Abre en' : 'Tiempo para enviar'}</p>
            <Countdown target={countdownTarget} />
          </div>
        )}

        {round.phase === 'open' && round.my_status !== 'submitted' && (
          <div className="mt-5">
            <div className="mb-1.5 flex justify-between text-xs text-muted">
              <span>Tu quiniela</span><span className="font-semibold text-ink">{round.my_items} de {round.match_count}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full bg-lime transition-[width] duration-500" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {round.my_status === 'submitted' && round.my_submitted_at && (
          <p className="mt-5 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> Enviada el <span className="capitalize">{formatDateTime(round.my_submitted_at, tz)}</span></p>
        )}

        <ButtonLink to={cta.to} variant={cta.variant} size="lg" block className="mt-6" icon={cta.icon}>{cta.label}</ButtonLink>
      </div>
    </section>
  )
}
