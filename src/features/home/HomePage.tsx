import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Radio } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ButtonLink } from '@/components/ui/Button'
import { SectionTitle } from '@/components/PageHeader'
import { MatchRow } from '@/components/MatchCard'
import { FeaturedHero, FeaturedRow } from './Featured'
import { PoolAccess } from './PoolAccess'
import { PrizePot } from './PrizePot'
import type { FeaturedMatch } from '@/types/domain'

const upcomingFirst = (a: FeaturedMatch, b: FeaturedMatch) => b.priority - a.priority || Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at)

export function HomePage() {
  const { timezone } = useAppConfig()
  const featured = useQuery({ queryKey: qk.featured, queryFn: playerApi.featured, refetchInterval: 120_000 })
  const pool = useQuery({ queryKey: qk.pool, queryFn: playerApi.pool, refetchInterval: 60_000 })

  const list = featured.data ?? []
  const live = list.filter((m) => m.status === 'live')
  const next = list.filter((m) => m.status === 'scheduled' && Date.parse(m.kickoff_at) > Date.now() - 15 * 60e3).sort(upcomingFirst)
  const hero = next[0] ?? live[0] ?? null
  const rest = next.filter((m) => m !== hero)
  const featuredIds = new Set(list.map((m) => m.in_round_id).filter(Boolean))
  const officialLive = (pool.data?.matches ?? []).filter((m) => m.status === 'live' && !featuredIds.has(m.match_id))

  return (
    <div>
      <PrizePot />
      <PoolAccess />

      <h2 className="display mb-3 mt-6 text-xl font-semibold uppercase tracking-wide">Partidos destacados</h2>
      {featured.isLoading ? (
        <CardSkeleton lines={4} />
      ) : featured.error ? (
        <ErrorState error={featured.error} onRetry={() => void featured.refetch()} />
      ) : hero ? (
        <FeaturedHero match={hero} tz={timezone} />
      ) : (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Sin partidos destacados por ahora"
          description="Aquí verás los partidos importantes de hoy y mañana."
          action={<ButtonLink to="/quinielas" variant="secondary">Ir a Mi quiniela</ButtonLink>} />
      )}

      {(live.length > 0 || officialLive.length > 0) && (
        <>
          <SectionTitle><span className="inline-flex items-center gap-2"><Radio className="size-4 text-red" /> En vivo</span></SectionTitle>
          <div className="space-y-2">
            {officialLive.map((m) => (
              <Link key={m.match_id} to="/quinielas" className="block"><MatchRow match={m} tz={timezone} /></Link>
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

    </div>
  )
}
