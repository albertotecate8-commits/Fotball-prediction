import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { PageHeader } from '@/components/PageHeader'
import { Podium, LeaderboardTable } from '@/components/Leaderboard'
import { Badge } from '@/components/ui/Badge'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { formatDateTime } from '@/lib/time'

/** Clasificación general: suma de los puntos de todos los partidos de la quiniela. */
export function LeaderboardPage() {
  const { timezone } = useAppConfig()
  const board = useQuery({ queryKey: qk.poolBoard, queryFn: playerApi.poolLeaderboard, refetchInterval: 60_000 })
  const rows = board.data ?? []
  const provisional = rows.some((r) => r.is_provisional)
  return (
    <div>
      <PageHeader title="Clasificación" subtitle="Quiniela oficial" />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        {rows.length > 0 && <Badge tone={provisional ? 'warning' : 'success'}>{provisional ? 'Con resultados provisionales' : 'Resultados oficiales'}</Badge>}
        {board.dataUpdatedAt > 0 && <span>Actualizado {formatDateTime(new Date(board.dataUpdatedAt), timezone)}</span>}
      </div>
      {board.isLoading ? <CardSkeleton lines={6} /> : board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Trophy className="size-6" />} title="Aún no hay posiciones" description="La clasificación aparece cuando termine el primer partido con pronósticos enviados." />
      ) : (
        <>
          <section className="card pitch-lines mb-5 px-4 pb-0 pt-6"><Podium rows={rows} /></section>
          <LeaderboardTable rows={rows} />
          <p className="mt-3 text-xs text-faint">1X2 acertado: 3 pts · marcador exacto: 5 pts. Desempate: puntos, exactos, menor error de goles y aciertos 1X2.</p>
        </>
      )}
    </div>
  )
}
