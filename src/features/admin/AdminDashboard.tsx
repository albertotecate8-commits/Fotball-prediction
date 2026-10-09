import { Link } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertTriangle, CalendarPlus, ClipboardCheck, RefreshCw, Trophy, Users, ListChecks } from 'lucide-react'
import { adminApi } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDateTime } from '@/lib/time'
import { StatTile } from '@/components/StatTile'
import { SectionTitle } from '@/components/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Skeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'

const QUICK = [
  { to: '/admin/jornadas?nueva=1', label: 'Crear jornada', icon: CalendarPlus },
  { to: '/admin/participantes', label: 'Participantes', icon: Users },
  { to: '/admin/jornadas', label: 'Seleccionar partidos', icon: ListChecks },
  { to: '/admin/resultados', label: 'Revisar resultados', icon: ClipboardCheck },
  { to: '/clasificacion', label: 'Clasificación', icon: Trophy },
]

export function AdminDashboard() {
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.admin.stats, queryFn: adminApi.stats, refetchInterval: 60_000 })
  const s = q.data
  return (
    <div>
      <h1 className="display mb-5 text-3xl font-semibold uppercase">Resumen</h1>
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24 rounded-[var(--radius-card)]" />)}</div>
      ) : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : s && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <StatTile label="Participantes" icon={<Users className="size-4" />} value={s.participants_total} sub={`${s.participants_active} activos`} />
          <StatTile accent={s.pending_approvals > 0} label="Por aprobar" value={s.pending_approvals} sub="solicitudes de grupo" />
          <StatTile label="Jornadas abiertas" value={s.rounds_open} sub={`${s.rounds_draft} en borrador`} />
          <StatTile label="Quinielas enviadas" value={s.predictions_submitted} />
          <StatTile accent={s.matches_pending_result > 0} label="Sin resultado" value={s.matches_pending_result} sub="partidos ya iniciados" />
          <StatTile label="Errores de sync" icon={<AlertTriangle className="size-4" />} value={s.sync_errors_24h} sub="últimas 24 h" />
        </div>
      )}

      <SectionTitle>Última sincronización</SectionTitle>
      <div className="card flex items-center gap-3 p-4">
        <RefreshCw className="size-5 text-olive" />
        {s?.last_sync ? (
          <div className="min-w-0 flex-1 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={s.last_sync.status === 'success' ? 'success' : s.last_sync.status === 'running' ? 'neutral' : 'danger'}>{s.last_sync.status}</Badge>
              <span className="capitalize">{formatDateTime(s.last_sync.started_at, timezone)}</span>
              <span className="text-muted">· {s.last_sync.provider}</span>
            </div>
            <p className="mt-1 text-xs text-muted">{s.last_sync.matches_checked} revisados · {s.last_sync.matches_updated} actualizados{s.last_sync.error_message ? ` · ${s.last_sync.error_message}` : ''}</p>
          </div>
        ) : <span className="text-sm text-muted">Aún no se ha ejecutado ninguna sincronización.</span>}
        <Link to="/admin/resultados" className="text-sm font-semibold text-lime">Ver</Link>
      </div>

      <SectionTitle>Accesos rápidos</SectionTitle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {QUICK.map(({ to, label, icon: Icon }) => (
          <Link key={label} to={to} className="card flex items-center gap-3 p-4 transition hover:border-lime/40">
            <span className="grid size-10 place-items-center rounded-full bg-lime/15 text-lime"><Icon className="size-5" /></span>
            <span className="text-sm font-semibold">{label}</span>
          </Link>
        ))}
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-faint"><Activity className="size-3.5" /> Cobros, premios y pasarelas de pago están desactivados en esta versión.</p>
    </div>
  )
}
