import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Ticket } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from '@/features/groups/GroupProvider'
import { useAppConfig } from '@/hooks/useAppConfig'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { RoundCard, roundHref } from '@/components/RoundCard'
import { TeamCrest } from '@/components/TeamCrest'
import { MatchStatusBadge } from '@/components/StatusBadge'
import { TestDataBadge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { QuinielaAccess } from '@/features/home/QuinielaAccess'
import { ParticipationNotice } from '@/features/participation/ParticipationNotice'
import { formatShortDate, formatTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import { pickFeaturedRound, useRounds } from './useRounds'
import type { RoundListItem, RoundMatch } from '@/types/domain'

const showsScore = (m: RoundMatch) => (m.status === 'live' || m.status === 'finished') && m.home_goals !== null

/** Un partido de la quiniela con el pronóstico del jugador y, si aplica, sus puntos. */
function QuinielaMatch({ m, tz, to }: { m: RoundMatch; tz: string; to: string }) {
  return (
    <Link to={to} className={cn('card-flat group block border-l-2 px-3 py-3 transition hover:border-r-line-strong', m.status === 'live' ? 'border-l-live' : m.pick ? 'border-l-gold-soft' : 'border-l-line-strong')}>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted">
        <span className="truncate">{m.competition?.name ?? 'Partido'}</span>
        <span className="flex items-center gap-2">
          <MatchStatusBadge status={m.status} elapsed={m.elapsed} confirmed={m.result_confirmed} />
          {!showsScore(m) && <span className="capitalize">{formatShortDate(m.kickoff_at, tz)}</span>}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
          <span className="truncate text-sm font-semibold">{m.home.short_name}</span>
          <TeamCrest team={m.home} size={28} />
        </div>
        <div className="w-16 shrink-0 text-center">
          {showsScore(m) ? <span className="scoreline text-xl">{m.home_goals}:{m.away_goals}</span> : <span className="scoreline text-lg">{formatTime(m.kickoff_at, tz)}</span>}
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <TeamCrest team={m.away} size={28} />
          <span className="truncate text-sm font-semibold">{m.away.short_name}</span>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-xs">
        {m.pick ? <span className="text-muted">Tu pronóstico: <span className="scoreline text-sm text-ink">{m.pick.home}-{m.pick.away}</span></span> : <span className="text-brand">Sin pronóstico</span>}
        {m.score ? <span className={cn('scoreline text-base', m.score.points === 5 ? 'text-gold-soft' : m.score.points === 3 ? 'text-success' : 'text-muted')}>+{m.score.points} pts</span>
          : <ChevronRight className="size-4 text-faint transition group-hover:text-gold-soft" />}
      </div>
    </Link>
  )
}

function CurrentRound({ round, tz, explore }: { round: RoundListItem; tz: string; explore: boolean }) {
  const detail = useQuery({ queryKey: qk.round(round.round_id), queryFn: () => playerApi.roundDetail(round.round_id), refetchInterval: 60_000 })
  const to = roundHref(round)
  return (
    <>
      <QuinielaAccess round={round} tz={tz} explore={explore} />
      <SectionTitle>Partidos de la quiniela</SectionTitle>
      {detail.isLoading ? <CardSkeleton lines={4} /> : detail.error ? <ErrorState error={detail.error} onRetry={() => void detail.refetch()} /> : (
        <div className="space-y-2">
          {detail.data!.matches.map((m) => <QuinielaMatch key={m.match_id} m={m} tz={tz} to={to} />)}
          {detail.data!.matches.some((m) => m.is_test_data) && <div className="pt-1 text-center"><TestDataBadge /></div>}
        </div>
      )}
    </>
  )
}

export function RoundsPage() {
  const { group, loading } = useGroup()
  const { isAdmin } = useAuth()
  const { timezone } = useAppConfig()
  const rounds = useRounds(group?.group_id)
  const part = useQuery({ queryKey: qk.participation(null), queryFn: () => playerApi.participation(null), staleTime: 30_000 })
  const current = rounds.data ? pickFeaturedRound(rounds.data.filter((r) => r.phase !== 'draft')) : null
  const others = (rounds.data ?? []).filter((r) => r.round_id !== current?.round_id)

  return (
    <div>
      <PageHeader title="Quiniela" subtitle="Partidos oficiales, tus pronósticos y puntos" />
      {loading || rounds.isLoading ? <CardSkeleton lines={6} /> : rounds.error ? (
        <ErrorState error={rounds.error} onRetry={() => void rounds.refetch()} />
      ) : current ? (
        <>
          {part.data && <ParticipationNotice participation={part.data} className="mb-4" />}
          <CurrentRound round={current} tz={timezone} explore={part.data ? !part.data.can_participate : false} />
        </>
      ) : (
        <EmptyState icon={<Ticket className="size-6" />} title="Aún no hay partidos en la quiniela"
          description="Cuando se publique la jornada oficial verás aquí sus partidos para pronosticar. Mientras, revisa los partidos destacados."
          action={isAdmin
            ? <ButtonLink to="/admin/jornadas?nueva=1">Crear la jornada</ButtonLink>
            : <ButtonLink to="/" variant="secondary">Ver partidos destacados</ButtonLink>} />
      )}
      {others.length > 0 && (
        <>
          <SectionTitle>Otras jornadas</SectionTitle>
          <div className="space-y-3">{others.map((r) => <RoundCard key={r.round_id} round={r} tz={timezone} />)}</div>
        </>
      )}
    </div>
  )
}
