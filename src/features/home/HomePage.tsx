import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Crosshair, Medal, Sparkles, Target, Trophy, CalendarDays } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from '@/features/groups/GroupProvider'
import { JoinGroupCard } from '@/features/groups/JoinGroup'
import { pickFeaturedRound, useRounds } from '@/features/rounds/useRounds'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { Avatar } from '@/components/ui/Avatar'
import { CardSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { StatTile } from '@/components/StatTile'
import { SectionTitle } from '@/components/PageHeader'
import { MatchRow } from '@/components/MatchCard'
import { RoundCard } from '@/components/RoundCard'
import { TestDataBadge } from '@/components/ui/Badge'
import { NextRoundCard } from './NextRoundCard'
import { GroupSwitcher } from './GroupSwitcher'
import { serverNow } from '@/lib/time'
import { TZDate } from '@date-fns/tz'

function greeting(tz: string) {
  const h = new TZDate(serverNow().getTime(), tz).getHours()
  return h < 12 ? 'Buenos días' : h < 19 ? 'Buenas tardes' : 'Buenas noches'
}

export function HomePage() {
  const { profile } = useAuth()
  const { group, loading: groupLoading, error: groupError, refetch } = useGroup()
  const { timezone } = useAppConfig()
  const gid = group?.group_id
  const rounds = useRounds(gid)
  const summary = useQuery({ queryKey: qk.summary(gid ?? ''), queryFn: () => playerApi.summary(gid!), enabled: !!gid })
  const upcoming = useQuery({ queryKey: qk.upcoming(gid ?? ''), queryFn: () => playerApi.upcoming(gid!), enabled: !!gid, refetchInterval: 60_000 })

  if (groupLoading) return <FullPageSpinner />

  const header = (
    <header className="mb-6 flex items-center gap-3 animate-fade-up">
      <Link to="/perfil" aria-label="Ir a mi perfil"><Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={48} /></Link>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-muted">{greeting(timezone)},</p>
        <h1 className="display truncate text-2xl font-semibold uppercase leading-tight">{profile?.display_name}</h1>
      </div>
      <GroupSwitcher />
    </header>
  )

  if (groupError) return <>{header}<ErrorState error={groupError} onRetry={refetch} /></>
  if (!group) return <>{header}<JoinGroupCard /></>

  const featured = rounds.data ? pickFeaturedRound(rounds.data) : null
  const recent = (rounds.data ?? []).filter((r) => r.round_id !== featured?.round_id && r.phase !== 'open' && r.phase !== 'upcoming').slice(0, 4)
  const s = summary.data

  return (
    <div>
      {header}

      {rounds.isLoading ? <CardSkeleton lines={5} className="h-80" /> : rounds.error ? (
        <ErrorState error={rounds.error} onRetry={() => void rounds.refetch()} />
      ) : featured ? (
        <NextRoundCard round={featured} tz={timezone} />
      ) : (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Sin jornadas todavía" description="Cuando el administrador publique una jornada aparecerá aquí con su cuenta regresiva." />
      )}

      <SectionTitle action={<Link to="/clasificacion" className="flex items-center text-sm font-semibold text-lime">Clasificación <ChevronRight className="size-4" /></Link>}>
        Tu rendimiento
      </SectionTitle>
      {summary.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />)}</div>
      ) : summary.error ? (
        <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
      ) : s ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile accent label="Posición" icon={<Trophy className="size-4" />} value={s.position ? `#${s.position}` : '—'} sub={s.players ? `de ${s.players} jugadores${s.is_provisional ? ' · provisional' : ''}` : 'Aún sin puntos'} />
          <StatTile label="Puntos totales" icon={<Sparkles className="size-4" />} value={s.total_points} sub={`${s.rounds_played} jornadas jugadas`} />
          <StatTile label="Última jornada" icon={<Medal className="size-4" />} value={s.last_round ? s.last_round.points : '—'} sub={s.last_round ? `${s.last_round.name}${s.last_round.position ? ` · #${s.last_round.position}` : ''}` : 'Sin jornadas cerradas'} />
          <StatTile label="Marcadores exactos" icon={<Crosshair className="size-4" />} value={s.exact_hits} sub="+5 pts cada uno" />
          <StatTile label="Aciertos 1X2" icon={<Target className="size-4" />} value={s.outcome_hits} sub="Ganador o empate" className="col-span-2 sm:col-span-1" />
        </div>
      ) : null}

      {recent.length > 0 && (
        <>
          <SectionTitle action={<Link to="/quinielas" className="flex items-center text-sm font-semibold text-lime">Ver todas <ChevronRight className="size-4" /></Link>}>
            Actividad reciente
          </SectionTitle>
          <div className="space-y-3">{recent.map((r) => <RoundCard key={r.round_id} round={r} tz={timezone} />)}</div>
        </>
      )}

      <SectionTitle>Próximos partidos</SectionTitle>
      {upcoming.isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className="h-16 rounded-[var(--radius-card)]" />)}</div>
      ) : upcoming.error ? (
        <ErrorState error={upcoming.error} onRetry={() => void upcoming.refetch()} />
      ) : upcoming.data && upcoming.data.length > 0 ? (
        <div className="space-y-2">
          {upcoming.data.map((m) => (
            <Link key={m.match_id} to={`/quinielas/${m.round_id}`} className="block transition hover:opacity-90">
              <MatchRow match={m} tz={timezone} />
            </Link>
          ))}
          {upcoming.data.some((m) => m.is_test_data) && <div className="pt-1 text-center"><TestDataBadge /></div>}
        </div>
      ) : (
        <EmptyState title="Sin partidos próximos" description="Solo se muestran los partidos incluidos en jornadas de tu grupo." />
      )}
    </div>
  )
}
