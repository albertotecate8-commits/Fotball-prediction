import { useQuery } from '@tanstack/react-query'
import { Ticket } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDateTime } from '@/lib/time'
import { ButtonLink } from '@/components/ui/Button'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'

/** Acceso directo a Mi quiniela con lo que falta por hacer. */
export function PoolAccess() {
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.pool, queryFn: playerApi.pool, refetchInterval: 60_000 })
  if (q.isLoading) return <CardSkeleton lines={3} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const open = q.data!.matches.filter((m) => m.open)
  const pending = open.filter((m) => m.pick?.status !== 'submitted')
  const noPick = open.filter((m) => !m.pick)
  const next = open[0]
  return (
    <section className="card p-4" aria-labelledby="mi-quiniela">
      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-aqua">Quiniela oficial</p>
      <h2 id="mi-quiniela" className="display mt-1 text-2xl font-semibold uppercase leading-none">
        {open.length ? `${open.length} ${open.length === 1 ? 'partido abierto' : 'partidos abiertos'}` : 'Sin partidos abiertos'}
      </h2>
      <p className="mt-1.5 text-xs text-muted">
        {open.length === 0 ? 'Cuando haya partidos nuevos aparecerán aquí.'
          : pending.length === 0 ? 'Ya enviaste todos tus pronósticos abiertos.'
          : `${noPick.length ? `${noPick.length} sin elegir · ` : ''}el próximo cierra ${formatDateTime(next!.kickoff_at, timezone)}`}
      </p>
      <ButtonLink to="/quinielas" block size="lg" className="mt-4" variant={pending.length ? 'primary' : 'secondary'} icon={<Ticket className="size-5" />}>
        {pending.length ? 'Llenar mi quiniela' : 'Ver mi quiniela'}
      </ButtonLink>
    </section>
  )
}
