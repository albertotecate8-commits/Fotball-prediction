import { useMemo, useState } from 'react'
import { Ticket } from 'lucide-react'
import { useGroup } from '@/features/groups/GroupProvider'
import { JoinGroupCard } from '@/features/groups/JoinGroup'
import { useAppConfig } from '@/hooks/useAppConfig'
import { PageHeader } from '@/components/PageHeader'
import { RoundCard } from '@/components/RoundCard'
import { PillTabs } from '@/components/ui/Tabs'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useRounds } from './useRounds'
import type { RoundListItem } from '@/types/domain'

type Tab = 'available' | 'mine' | 'live' | 'finished'

const FILTERS: Record<Tab, (r: RoundListItem) => boolean> = {
  available: (r) => r.phase === 'open' || r.phase === 'upcoming',
  mine: (r) => r.my_status !== 'none',
  live: (r) => r.phase === 'in_progress' || r.phase === 'closed',
  finished: (r) => r.phase === 'finished' || r.phase === 'under_review',
}

const EMPTY: Record<Tab, { title: string; description: string }> = {
  available: { title: 'No hay jornadas abiertas', description: 'Te avisaremos aquí cuando el administrador abra la siguiente.' },
  mine: { title: 'Aún no juegas', description: 'Tus borradores y quinielas enviadas aparecerán aquí.' },
  live: { title: 'Nada en curso', description: 'Las jornadas cerradas con partidos en juego se muestran aquí.' },
  finished: { title: 'Sin jornadas finalizadas', description: 'Cuando termine una jornada verás tus puntos y posición.' },
}

export function RoundsPage() {
  const { group, loading } = useGroup()
  const { timezone } = useAppConfig()
  const rounds = useRounds(group?.group_id)
  const [tab, setTab] = useState<Tab>('available')

  const counts = useMemo(() => {
    const list = rounds.data ?? []
    return Object.fromEntries((Object.keys(FILTERS) as Tab[]).map((t) => [t, list.filter(FILTERS[t]).length])) as Record<Tab, number>
  }, [rounds.data])

  if (loading) return <FullPageSpinner />
  if (!group) return <><PageHeader title="Quinielas" /><JoinGroupCard /></>

  const list = (rounds.data ?? []).filter(FILTERS[tab])
  if (tab === 'available') list.sort((a, b) => +new Date(a.deadline_at) - +new Date(b.deadline_at))

  return (
    <div>
      <PageHeader title="Quinielas" subtitle={group.name} />
      <PillTabs label="Filtrar jornadas" value={tab} onChange={setTab} className="mb-5" options={[
        { value: 'available', label: 'Disponibles', count: counts.available },
        { value: 'mine', label: 'Mis quinielas', count: counts.mine },
        { value: 'live', label: 'En curso', count: counts.live },
        { value: 'finished', label: 'Finalizadas', count: counts.finished },
      ]} />
      {rounds.isLoading ? (
        <div className="space-y-3">{Array.from({ length: 3 }, (_, i) => <CardSkeleton key={i} lines={2} />)}</div>
      ) : rounds.error ? (
        <ErrorState error={rounds.error} onRetry={() => void rounds.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState icon={<Ticket className="size-6" />} {...EMPTY[tab]} />
      ) : (
        <div className="space-y-3">{list.map((r) => <RoundCard key={r.round_id} round={r} tz={timezone} />)}</div>
      )}
    </div>
  )
}
