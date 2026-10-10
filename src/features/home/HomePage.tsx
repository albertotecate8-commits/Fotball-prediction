import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, ChevronRight, Radio, Star } from 'lucide-react'
import { useGroup } from '@/features/groups/GroupProvider'
import { pickFeaturedRound, useRounds } from '@/features/rounds/useRounds'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { CardSkeleton, Skeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ButtonLink } from '@/components/ui/Button'
import { SectionTitle } from '@/components/PageHeader'
import { MatchRow } from '@/components/MatchCard'
import { TestDataBadge } from '@/components/ui/Badge'
import { FeaturedHero, FeaturedRow } from './Featured'
import { NoQuiniela, QuinielaAccess } from './QuinielaAccess'
import type { FeaturedMatch } from '@/types/domain'

const upcomingFirst = (a: FeaturedMatch, b: FeaturedMatch) => b.priority - a.priority || Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at)

export function HomePage() {
  const { group, loading: groupLoading } = useGroup()
  const { timezone } = useAppConfig()
  const gid = group?.group_id
  const rounds = useRounds(gid)
  const featured = useQuery({ queryKey: qk.featured, queryFn: playerApi.featured, refetchInterval: 120_000 })
  const part = useQuery({ queryKey: qk.participation(null), queryFn: () => playerApi.participation(null), staleTime: 30_000 })
  const upcoming = useQuery({ queryKey: qk.upcoming(gid ?? ''), queryFn: () => playerApi.upcoming(gid!), enabled: !!gid, refetchInterval: 60_000 })

  const officialRound = rounds.data ? pickFeaturedRound(rounds.data) : null
  const list = featured.data ?? []
  const live = list.filter((m) => m.status === 'live')
  const next = list.filter((m) => m.status === 'scheduled' && Date.parse(m.kickoff_at) > Date.now() - 15 * 60e3).sort(upcomingFirst)
  const hero = next[0] ?? live[0] ?? null
  const rest = next.filter((m) => m !== hero)
  const officialLive = (upcoming.data ?? []).filter((m) => m.status === 'live')

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h1 className="display text-2xl font-semibold uppercase tracking-wide">Partidos destacados</h1>
        <span className="inline-flex items-center gap-1 text-xs text-muted"><Star className="size-3.5 text-gold" /> API-Football</span>
      </div>
      {featured.isLoading ? (
        <CardSkeleton lines={4} />
      ) : featured.error ? (
        <ErrorState error={featured.error} onRetry={() => void featured.refetch()} />
      ) : hero ? (
        <FeaturedHero match={hero} tz={timezone} />
      ) : (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Sin partidos destacados por ahora"
          description="Los destacados de Liga MX, Barcelona, Real Madrid y Durango aparecen aquí cuando el proveedor publica partidos de hoy o mañana."
          action={<ButtonLink to="/quinielas" variant="secondary">Ver la quiniela</ButtonLink>} />
      )}

      {/* Acceso visible a la quiniela oficial */}
      <div className="mt-4">
      {groupLoading || (gid && rounds.isLoading) ? <CardSkeleton lines={3} /> : rounds.error ? (
        <ErrorState error={rounds.error} onRetry={() => void rounds.refetch()} />
      ) : officialRound ? (
        <QuinielaAccess round={officialRound} tz={timezone} explore={part.data ? !part.data.can_participate : false} />
      ) : (
        <NoQuiniela />
      )}
      </div>

      {(live.length > 0 || officialLive.length > 0) && (
        <>
          <SectionTitle><span className="inline-flex items-center gap-2"><Radio className="size-4 text-red" /> En vivo</span></SectionTitle>
          <div className="space-y-2">
            {officialLive.map((m) => (
              <Link key={m.match_id} to={`/quinielas/${m.round_id}`} className="block"><MatchRow match={m} tz={timezone} /></Link>
            ))}
            {live.filter((m) => m !== hero).map((m) => <FeaturedRow key={m.external_id} match={m} tz={timezone} />)}
            {hero && hero.status === 'live' && <FeaturedRow match={hero} tz={timezone} />}
          </div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <SectionTitle>Próximos partidos</SectionTitle>
          <div className="space-y-2">{rest.slice(0, 8).map((m) => <FeaturedRow key={m.external_id} match={m} tz={timezone} />)}</div>
        </>
      )}

      {(upcoming.data ?? []).some((m) => m.status === 'scheduled') && (
        <>
          <SectionTitle action={<Link to="/quinielas" className="flex items-center text-sm font-semibold text-aqua">Quiniela <ChevronRight className="size-4" /></Link>}>
            En tu quiniela
          </SectionTitle>
          {upcoming.isLoading ? <Skeleton className="h-16 rounded-[var(--radius-card)]" /> : (
            <div className="space-y-2">
              {(upcoming.data ?? []).filter((m) => m.status === 'scheduled').slice(0, 5).map((m) => (
                <Link key={m.match_id} to={`/quinielas/${m.round_id}`} className="block transition hover:opacity-90"><MatchRow match={m} tz={timezone} /></Link>
              ))}
              {(upcoming.data ?? []).some((m) => m.is_test_data) && <div className="pt-1 text-center"><TestDataBadge /></div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
