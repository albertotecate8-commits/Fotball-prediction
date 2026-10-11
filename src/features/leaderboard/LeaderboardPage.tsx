import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Goal, Trophy } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { PageHeader } from '@/components/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Field'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { formatDateTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { WeekBoardRow } from '@/types/domain'

const MEDAL = ['text-gold', 'text-ink/80', 'text-[#c98a4b]']

/** Clasificación de la semana: gana quien más acierta; en empate, quien más se acerca al total de goles. */
export function LeaderboardPage() {
  const { timezone } = useAppConfig()
  const [weekId, setWeekId] = useState<string | null>(null)
  const board = useQuery({ queryKey: [...qk.poolBoard, 'week', weekId], queryFn: () => playerApi.weekBoard(weekId), refetchInterval: 60_000 })
  const data = board.data
  const rows = data?.rows ?? []
  const real = data?.week?.real
  return (
    <div>
      <PageHeader title="Clasificación" subtitle={data?.week ? `Quiniela de la ${data.week.label.toLowerCase()}` : 'Quiniela de la semana'} />
      {data && data.weeks.length > 1 && (
        <Select aria-label="Semana" className="mb-3" value={weekId ?? data.week?.id ?? ''} onChange={(e) => setWeekId(e.target.value || null)}>
          {data.weeks.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </Select>
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
        {real && <Badge tone={real.final ? 'success' : 'warning'}>{real.final ? 'Resultados oficiales' : 'En juego · provisional'}</Badge>}
        {real && (
          <span className="inline-flex items-center gap-1"><Goal className="size-3.5 text-gold" /> Goles de la jornada: <span className="font-semibold text-ink">{real.goals}</span> ({real.counted} de {real.total} partidos)</span>
        )}
        {board.dataUpdatedAt > 0 && <span>· Actualizado {formatDateTime(new Date(board.dataUpdatedAt), timezone)}</span>}
      </div>
      {board.isLoading ? <CardSkeleton lines={6} /> : board.error ? (
        <ErrorState error={board.error} onRetry={() => void board.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Trophy className="size-6" />} title="Aún no hay posiciones" description="La clasificación aparece cuando alguien envíe su quiniela de la semana." />
      ) : (
        <>
          <ol className="space-y-2">{rows.map((r) => <Row key={r.user_id} r={r} realGoals={real?.goals ?? 0} />)}</ol>
          <p className="mt-4 text-xs text-faint">Cada acierto (quién gana o empate) cuenta 1. Gana quien tenga más aciertos; si empatan, quien más se acerque al total de goles de la jornada.</p>
        </>
      )}
    </div>
  )
}

function Row({ r, realGoals }: { r: WeekBoardRow; realGoals: number }) {
  return (
    <li className={cn('card flex items-center gap-3 p-3', r.is_me && 'border-aqua/50')}>
      <span className={cn('scoreline w-7 shrink-0 text-center text-2xl', MEDAL[r.rank_position - 1] ?? 'text-muted')}>{r.rank_position}</span>
      <Avatar name={r.display_name} url={r.avatar_url} size={36} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{r.display_name}{r.is_me && <span className="ml-1.5 text-[11px] text-aqua">(tú)</span>}</div>
        <div className="text-[11px] text-muted">
          {r.guess === null ? 'Sin total de goles' : `Dijo ${r.guess} goles · ${r.diff === 0 ? '¡exacto!' : `a ${r.diff} de ${realGoals}`}`}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="scoreline text-2xl leading-none">{r.hits}<span className="text-sm text-muted">/{r.picks}</span></div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">aciertos</div>
      </div>
    </li>
  )
}
