import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, Radio, Ticket } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { ButtonLink } from '@/components/ui/Button'
import { SectionTitle } from '@/components/PageHeader'
import { InstallCard } from '@/features/install/InstallCard'
import { MatchCard, MatchRow } from '@/components/MatchCard'
import { PoolAccess } from './PoolAccess'
import { PrizePot } from './PrizePot'
import { outcomeLabel } from '@/features/quiniela/PickCard'

/** Inicio: solo equipos y partidos de la quiniela (nada de otras ligas). */
export function HomePage() {
  const { timezone } = useAppConfig()
  const pool = useQuery({ queryKey: qk.pool, queryFn: playerApi.pool, refetchInterval: 60_000 })

  const matches = pool.data?.matches ?? []
  const live = matches.filter((m) => m.status === 'live' || m.status === 'suspended')
  const upcoming = matches.filter((m) => m.status === 'scheduled' && Date.parse(m.kickoff_at) > Date.now())
    .sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at))
  const hero = upcoming[0] ?? null
  const rest = upcoming.slice(1, 9)

  return (
    <div>
      <PrizePot />
      <PoolAccess />
      <div className="mt-4"><InstallCard variant="home" /></div>

      <h2 className="display mb-3 mt-6 text-xl font-semibold uppercase tracking-wide">Próximo partido</h2>
      {pool.isLoading ? (
        <CardSkeleton lines={4} />
      ) : pool.error ? (
        <ErrorState error={pool.error} onRetry={() => void pool.refetch()} />
      ) : hero ? (
        <MatchCard match={hero} tz={timezone}
          footer={<ButtonLink to="/quinielas" variant={hero.pick?.status === 'submitted' ? 'secondary' : 'primary'} block className="mt-4" icon={<Ticket className="size-4" />}>
            {hero.pick?.status === 'submitted' ? `Tu pronóstico: ${outcomeLabel(hero.pick.outcome, hero)}` : 'Hacer pronóstico'}
          </ButtonLink>} />
      ) : (
        <EmptyState icon={<CalendarDays className="size-6" />} title="Aún no hay partidos en la quiniela"
          description="En cuanto se publiquen aparecerán aquí." />
      )}

      {live.length > 0 && (
        <>
          <SectionTitle><span className="inline-flex items-center gap-2"><Radio className="size-4 text-live" /> En vivo</span></SectionTitle>
          <div className="space-y-2">
            {live.map((m) => <Link key={m.match_id} to="/quinielas" className="block"><MatchRow match={m} tz={timezone} /></Link>)}
          </div>
        </>
      )}

      {rest.length > 0 && (
        <>
          <SectionTitle>Más partidos de tu quiniela</SectionTitle>
          <div className="space-y-2">
            {rest.map((m) => <Link key={m.match_id} to="/quinielas" className="block"><MatchRow match={m} tz={timezone} /></Link>)}
          </div>
        </>
      )}
    </div>
  )
}
