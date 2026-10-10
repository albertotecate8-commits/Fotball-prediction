import { CheckCircle2, Users } from 'lucide-react'
import { useGroup } from './GroupProvider'
import { JoinGroupCard } from './JoinGroup'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'
import { cn } from '@/lib/cn'

const STATUS = {
  active: { label: 'Activo', tone: 'success' as const },
  pending: { label: 'Pendiente', tone: 'warning' as const },
  suspended: { label: 'Suspendido', tone: 'danger' as const },
}

export function GroupsPage() {
  const { groups, group, loading, error, select, refetch } = useGroup()
  return (
    <div>
      <PageHeader title="Grupos" subtitle="Tu grupo activo define la quiniela y la clasificación que ves." />
      {loading ? <CardSkeleton lines={3} /> : error ? <ErrorState error={error} onRetry={refetch} /> : groups.length > 0 && (
        <ul className="space-y-2">
          {groups.map((g) => {
            const isActive = g.group_id === group?.group_id
            const st = STATUS[g.member_status as keyof typeof STATUS] ?? STATUS.pending
            return (
              <li key={g.group_id}>
                <div className={cn('card-flat flex items-center gap-3 px-4 py-3', isActive && 'border-aqua/40')}>
                  <span className={cn('grid size-10 shrink-0 place-items-center rounded-full', isActive ? 'bg-aqua/12 text-aqua' : 'bg-surface-2 text-muted')}><Users className="size-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{g.name}</div>
                    <div className="text-xs text-muted">{g.members_count} jugadores</div>
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {g.member_status === 'active' && (isActive ? (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-aqua"><CheckCircle2 className="size-4" /> Activo</span>
                  ) : (
                    <button type="button" onClick={() => select(g.group_id)} className="h-9 rounded-full border border-line-strong px-3 text-xs font-semibold transition hover:border-aqua/50 hover:text-aqua">Usar</button>
                  ))}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <SectionTitle>{groups.length ? 'Unirme a otro grupo' : 'Unirme a un grupo'}</SectionTitle>
      <JoinGroupCard />
    </div>
  )
}
