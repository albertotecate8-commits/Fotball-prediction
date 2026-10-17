import { Link, useParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Crosshair, Info, Lock, Target, XCircle } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { PageHeader } from '@/components/PageHeader'
import { TeamCrest } from '@/components/TeamCrest'
import { MatchStatusBadge, RoundPhaseBadge } from '@/components/StatusBadge'
import { StatTile } from '@/components/StatTile'
import { Countdown } from '@/components/Countdown'
import { Badge, TestDataBadge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'
import { formatDateTime, formatShortDate, formatTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { RoundMatch } from '@/types/domain'

function PointsChip({ m }: { m: RoundMatch }) {
  if (!m.score) {
    if (m.status === 'cancelled' || m.status === 'abandoned') return <Badge tone="neutral">Anulado</Badge>
    return <span className="text-xs text-muted">Pendiente</span>
  }
  const { points, exact_hit, outcome_hit } = m.score
  return (
    <div className="flex items-center gap-2">
      {exact_hit ? <Badge tone="accent" icon={<Crosshair className="size-3" />}>Exacto</Badge>
        : outcome_hit ? <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>1X2</Badge>
        : <Badge tone="danger" icon={<XCircle className="size-3" />}>Fallo</Badge>}
      <span className={cn('scoreline text-2xl', points === 5 ? 'text-aqua' : points === 3 ? 'text-success' : 'text-muted')}>+{points}</span>
    </div>
  )
}

export function RoundResultsPage() {
  const { roundId = '' } = useParams()
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.round(roundId), queryFn: () => playerApi.roundDetail(roundId), refetchInterval: 60_000 })

  if (q.isLoading) return <><PageHeader title="Jornada" back="/quinielas" /><CardSkeleton lines={6} /></>
  if (q.error) return <><PageHeader title="Jornada" back="/quinielas" /><ErrorState error={q.error} onRetry={() => void q.refetch()} /></>
  const d = q.data!
  const { round, summary, prediction } = d
  const submitted = prediction?.status === 'submitted'
  const scoring = ['in_progress', 'closed', 'finished', 'under_review'].includes(round.phase)
  const official = round.status === 'finished'

  return (
    <div>
      <PageHeader title={round.name} back="/quinielas" subtitle={<span className="capitalize">Cierre {formatDateTime(round.deadline_at, timezone)}</span>} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <RoundPhaseBadge phase={round.phase} />
        {submitted ? <Badge tone="success" icon={<Lock className="size-3" />}>Quiniela enviada</Badge> : <Badge tone="neutral">{prediction ? 'Borrador sin enviar' : 'Sin quiniela'}</Badge>}
        {scoring && <Badge tone={official ? 'success' : 'warning'}>{official ? 'Resultados oficiales' : 'Resultados provisionales'}</Badge>}
      </div>

      {round.phase === 'open' && !submitted && (
        <div className="card mb-5 p-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted">Tiempo para enviar</p>
          <Countdown target={round.deadline_at} />
          <ButtonLink to={`/quinielas/${round.id}/jugar`} size="lg" block className="mt-5">{prediction ? 'Continuar borrador' : 'Hacer mi quiniela'}</ButtonLink>
        </div>
      )}

      {submitted && prediction?.submitted_at && (
        <p className="mb-5 flex items-center gap-2 text-sm text-muted">
          <Lock className="size-4 text-aqua" /> Enviada el <span className="capitalize text-ink">{formatDateTime(prediction.submitted_at, timezone)}</span>. Ya no puede modificarse.
        </p>
      )}

      {scoring && submitted && (
        <section aria-label="Resumen de la jornada" className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile accent label="Puntos" value={summary.points} sub={`de ${summary.max_possible} posibles`} />
          <StatTile label="Posición" value={summary.position ? `#${summary.position}` : '—'} sub={`de ${summary.players}${official ? '' : ' · provisional'}`} />
          <StatTile label="Exactos" icon={<Crosshair className="size-4" />} value={summary.exact_hits} />
          <StatTile label="Aciertos 1X2" icon={<Target className="size-4" />} value={summary.outcome_hits} />
        </section>
      )}

      {!official && scoring && (
        <p className="mb-4 flex items-start gap-2 rounded-2xl border border-line bg-surface/60 p-3 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-aqua" /> Los puntos se actualizan con resultados en vivo y quedan oficiales cuando se confirma el resultado final de todos los partidos.
        </p>
      )}

      {d.matches.some((m) => m.is_test_data) && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted"><TestDataBadge /> Partidos ficticios de demostración.</p>
      )}
      <ol className="space-y-3">
        {d.matches.map((m) => {
          const hasReal = m.home_goals !== null && (m.status === 'live' || m.status === 'finished')
          return (
            <li key={m.match_id} className={cn('card p-4', m.score?.exact_hit && 'border-aqua/40')}>
              <div className="mb-3 flex items-center justify-between gap-2 text-xs text-muted">
                <span className="capitalize">{formatShortDate(m.kickoff_at, timezone)} · {formatTime(m.kickoff_at, timezone)}</span>
                <MatchStatusBadge status={m.status} elapsed={m.elapsed} confirmed={m.result_confirmed} />
              </div>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                  <TeamCrest team={m.home} size={44} />
                  <span className="line-clamp-2 text-sm font-semibold leading-tight">{m.home.short_name}</span>
                </div>
                <div className="flex w-32 shrink-0 flex-col items-center gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">{hasReal ? (m.result_confirmed ? 'Resultado oficial' : 'Marcador actual') : 'Por jugar'}</span>
                  <span className="scoreline text-4xl">{hasReal ? <>{m.home_goals}<span className="text-muted">:</span>{m.away_goals}</> : <span className="text-faint">– : –</span>}</span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 text-center">
                  <TeamCrest team={m.away} size={44} />
                  <span className="line-clamp-2 text-sm font-semibold leading-tight">{m.away.short_name}</span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between gap-2 border-t border-line pt-3">
                <span className="text-sm text-muted">Tu pronóstico: <span className="scoreline ml-1 text-xl text-ink">{m.pick ? `${m.pick.home}-${m.pick.away}` : '—'}</span></span>
                {submitted && scoring ? <PointsChip m={m} /> : null}
              </div>
            </li>
          )
        })}
      </ol>

      {scoring && (
        <div className="mt-6 text-center">
          <Link to={`/clasificacion?jornada=${round.id}`} className="text-sm font-semibold text-aqua">Ver clasificación de la jornada →</Link>
        </div>
      )}
    </div>
  )
}
