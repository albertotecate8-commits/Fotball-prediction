import { useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Minus, Trophy } from 'lucide-react'
import { useGroup } from '@/features/groups/GroupProvider'
import { JoinGroupCard } from '@/features/groups/JoinGroup'
import { useRounds } from '@/features/rounds/useRounds'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { Podium, LeaderboardTable } from '@/components/Leaderboard'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Field'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/cn'

export function LeaderboardPage() {
  const { group, loading } = useGroup()
  const { timezone } = useAppConfig()
  const [params, setParams] = useSearchParams()
  const roundId = params.get('jornada')
  const gid = group?.group_id
  const rounds = useRounds(gid)
  const board = useQuery({
    queryKey: qk.leaderboard(gid ?? '', roundId),
    queryFn: () => playerApi.leaderboard(gid!, roundId),
    enabled: !!gid,
    refetchInterval: 60_000,
  })
  const history = useQuery({ queryKey: qk.history(gid ?? ''), queryFn: () => playerApi.history(gid!), enabled: !!gid })

  if (loading) return <FullPageSpinner />
  if (!group) return <><PageHeader title="Clasificación" /><JoinGroupCard /></>

  const scoredRounds = (rounds.data ?? []).filter((r) => ['in_progress', 'closed', 'finished', 'under_review'].includes(r.phase))
  const rows = board.data ?? []
  const provisional = rows.some((r) => r.is_provisional)
  const hist = history.data ?? []

  return (
    <div>
      <PageHeader title="Clasificación" subtitle={group.name} />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative sm:w-72">
          <span className="sr-only">Jornada</span>
          <Select value={roundId ?? ''} onChange={(e) => setParams(e.target.value ? { jornada: e.target.value } : {})}>
            <option value="">Clasificación acumulada</option>
            {scoredRounds.map((r) => <option key={r.round_id} value={r.round_id}>{r.name}</option>)}
          </Select>
        </label>
        <div className="flex items-center gap-2 text-xs text-muted">
          {rows.length > 0 && <Badge tone={provisional ? 'warning' : 'success'}>{provisional ? 'Provisional' : 'Oficial'}</Badge>}
          {board.dataUpdatedAt > 0 && <span>Actualizado {formatDateTime(new Date(board.dataUpdatedAt), timezone)}</span>}
        </div>
      </div>

      {board.isLoading ? <CardSkeleton lines={6} /> : board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Trophy className="size-6" />} title="Aún no hay posiciones"
          description="La clasificación aparece cuando cierra la primera jornada con quinielas enviadas." />
      ) : (
        <>
          <section className="card pitch-lines mb-5 px-4 pb-0 pt-6"><Podium rows={rows} /></section>
          <LeaderboardTable rows={rows} />
          <p className="mt-3 text-xs text-faint">Desempate: puntos, marcadores exactos, menor error de goles y aciertos 1X2. Empate total = posición compartida.</p>
        </>
      )}

      {hist.length > 0 && !roundId && (
        <>
          <SectionTitle>Tu historial de posiciones</SectionTitle>
          <ol className="card divide-y divide-line">
            {[...hist].reverse().map((h, i, arr) => {
              const prev = arr[i + 1]
              const delta = prev ? prev.cumulative_position - h.cumulative_position : 0
              return (
                <li key={h.round_id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{h.round_name}</div>
                    <div className="text-xs text-muted">{h.round_points ?? 0} pts en la jornada{h.round_position ? ` · #${h.round_position}` : ''}{h.is_official ? '' : ' · provisional'}</div>
                  </div>
                  <span className={cn('inline-flex items-center gap-0.5 text-xs font-bold', delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-muted')}
                    aria-label={delta > 0 ? `Subiste ${delta}` : delta < 0 ? `Bajaste ${-delta}` : 'Sin cambio'}>
                    {delta > 0 ? <ArrowUp className="size-3.5" /> : delta < 0 ? <ArrowDown className="size-3.5" /> : <Minus className="size-3.5" />}
                    {delta !== 0 && Math.abs(delta)}
                  </span>
                  <div className="w-16 text-right">
                    <div className="scoreline text-2xl">#{h.cumulative_position}</div>
                    <div className="text-[10px] text-muted">{h.cumulative_points} pts</div>
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      )}
    </div>
  )
}
