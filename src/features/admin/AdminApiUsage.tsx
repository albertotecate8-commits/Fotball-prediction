import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, RefreshCw } from 'lucide-react'
import { adminApi, type ApiUsage, type ApiUsageRequest } from '@/services/admin'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDateTime, formatTime } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

const STATUS: Record<ApiUsage['status'], { label: string; tone: Tone; text: string }> = {
  normal: { label: 'Normal', tone: 'success', text: 'Consultas según prioridad y saldo.' },
  low: { label: 'Cuota baja', tone: 'warning', text: 'Solo se consulta lo importante (en vivo y próximos).' },
  paused: { label: 'Pausado', tone: 'red', text: 'No se consulta al proveedor hasta que se restablezca la cuota. Se muestran los últimos datos.' },
  error: { label: 'Error', tone: 'danger', text: 'Las últimas consultas fallaron. Se reintenta con espera progresiva.' },
}
const OUTCOME: Record<ApiUsageRequest['outcome'], { label: string; cls: string }> = {
  success: { label: 'Éxito', cls: 'text-success' }, empty: { label: 'Vacía', cls: 'text-muted' }, error: { label: 'Error', cls: 'text-danger' },
  rate_limited: { label: '429 / límite', cls: 'text-danger' }, quota_exhausted: { label: 'Cuota agotada', cls: 'text-danger' },
  blocked: { label: 'Bloqueada', cls: 'text-gold' }, pending: { label: 'En curso', cls: 'text-muted' },
}
const PRIORITY: Record<number, string> = { 1: 'En vivo', 2: 'Próximos', 3: 'Calendario', 4: 'Inicio', 5: 'Panel' }

/** Consumo de API-Football: presupuesto interno, saldo estimado y registro de solicitudes. */
export function AdminApiUsage() {
  const { timezone } = useAppConfig()
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'apiUsage'], queryFn: adminApi.apiUsage, refetchInterval: 60_000 })
  const [checking, setChecking] = useState(false)
  const contrast = async () => {
    setChecking(true)
    try {
      await adminApi.providerStatus()
      await qc.invalidateQueries({ queryKey: ['admin', 'apiUsage'] })
      toast('Saldo contrastado con el proveedor')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setChecking(false) }
  }

  const [saving, setSaving] = useState(false)
  // Consultas por día: todo el plan (100, sin margen) o el modo prudente (80 con margen de 20).
  const setDaily = async (budget: 100 | 80) => {
    if (budget === 100 && !confirm('¿Usar las 100 consultas diarias del plan, sin margen? Si se agotan, los resultados siguen llegando por el respaldo gratuito.')) return
    setSaving(true)
    try {
      await adminApi.updateSetting('api_daily_budget', budget)
      await adminApi.updateSetting('api_provider_margin', budget === 100 ? 0 : 20)
      await qc.invalidateQueries({ queryKey: ['admin', 'apiUsage'] })
      toast(`Consultas al día: ${budget}`)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setSaving(false) }
  }

  if (q.isLoading) return <CardSkeleton lines={6} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const u = q.data!
  const st = STATUS[u.status]
  const pct = Math.min(100, Math.round((u.used / Math.max(u.budget, 1)) * 100))

  return (
    <div>
      <h1 className="display mb-1 text-3xl font-semibold uppercase">Consumo API</h1>
      <p className="mb-4 text-sm text-muted">API-Football · plan gratuito de 100 consultas diarias. El día reinicia a las 00:00 UTC (18:00 en Ciudad de México).</p>

      <section className="card mb-4 p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Badge tone={st.tone} icon={<Activity className="size-3" />}>{st.label}</Badge>
          <span className="text-[11px] text-muted">Actualizado {formatTime(u.server_time, timezone)}</span>
        </div>
        <div className="flex items-end justify-between">
          <div>
            <div className="scoreline text-4xl">{u.used}<span className="text-xl text-muted">/{u.budget}</span></div>
            <div className="text-xs text-muted">consultas de SHABEX hoy · presupuesto interno</div>
          </div>
          <div className="text-right">
            <div className="scoreline text-3xl text-aqua">{u.remaining_internal}</div>
            <div className="text-xs text-muted">restantes</div>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={u.used} aria-valuemin={0} aria-valuemax={u.budget} aria-label="Consumo del presupuesto">
          <div className={cn('h-full rounded-full', pct >= 90 ? 'bg-red' : pct >= 70 ? 'bg-gold' : 'bg-aqua')} style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-3 text-xs text-muted">{st.text}{u.paused && u.paused_until ? ` Se reanuda: ${formatDateTime(u.paused_until, timezone)}.` : ''}</p>
      </section>

      <div className="mb-4 grid grid-cols-2 gap-2">
        <Tile label="Bloqueadas por el límite interno" value={u.blocked} />
        <Tile label="Respuestas desde caché (no cuentan)" value={u.cache_hits} />
        <Tile label="Partidos en vivo" value={u.live_matches} hint={u.live_featured ? `+${u.live_featured} destacados` : undefined} />
        <Tile label="Fallidas hoy" value={u.failed} />
      </div>

      <section className="card mb-4 p-4 text-sm">
        <h2 className="mb-2 font-semibold">Saldo del proveedor</h2>
        {u.provider_remaining_estimate !== null ? (
          <p><span className="scoreline text-2xl">{u.provider_remaining_estimate}</span> <span className="text-muted">restantes de {u.provider_limit ?? 100} · <strong>estimación</strong> con lo último que informó el proveedor{u.provider_reported_at ? ` (${formatTime(u.provider_reported_at, timezone)})` : ''}.</span></p>
        ) : (
          <p className="text-muted">Aún no hay dato del proveedor hoy. No existe una forma garantizada de conocer el saldo exacto: se usa lo que informa en cada respuesta.</p>
        )}
        {u.provider_current !== null && <p className="mt-1 text-xs text-muted">Contraste directo: el proveedor registra {u.provider_current} consultas hoy ({u.provider_checked_at ? formatTime(u.provider_checked_at, timezone) : '—'}).</p>}
        {u.external_usage && <p className="mt-2 text-xs font-semibold text-gold">El proveedor cuenta más consultas que SHABEX: otra aplicación podría estar usando la misma clave.</p>}
        <p className="mt-2 text-xs text-muted">SHABEX nunca baja de {u.margin} consultas del proveedor (margen de seguridad).</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <span className="text-xs font-semibold">Consultas al día: {u.budget}</span>
          {u.budget < 100
            ? <Button size="sm" loading={saving} onClick={() => void setDaily(100)}>Usar las 100</Button>
            : <Button size="sm" variant="secondary" loading={saving} onClick={() => void setDaily(80)}>Volver a 80 (con margen)</Button>}
        </div>
        <Button size="sm" variant="ghost" className="mt-2" loading={checking} icon={<RefreshCw className="size-4" />} onClick={() => void contrast()}>Contrastar con el proveedor</Button>
      </section>

      <p className="mb-4 text-xs text-muted">Última sincronización exitosa: {u.last_success_sync ? formatDateTime(u.last_success_sync, timezone) : 'sin registro'}</p>

      <h2 className="mb-2 font-semibold">Solicitudes recientes</h2>
      <ul className="space-y-1.5">
        {u.recent.length === 0 && <li className="text-sm text-muted">Sin solicitudes registradas.</li>}
        {u.recent.map((r, i) => (
          <li key={i} className="card-flat px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="shrink-0 tabular-nums text-muted">{formatTime(r.at, timezone)}</span>
              <span className={cn('shrink-0 font-semibold', OUTCOME[r.outcome].cls)}>{OUTCOME[r.outcome].label}</span>
              <span className="min-w-0 flex-1 truncate">{PRIORITY[r.priority] ?? r.priority} · {r.purpose}</span>
              <span className="shrink-0 text-muted">{r.counted ? (r.results !== null ? `${r.results} res.` : '') : 'no cuenta'}</span>
            </div>
            <div className="mt-0.5 truncate text-[10px] text-faint">{r.endpoint}{r.http ? ` · HTTP ${r.http}` : ''}{r.ms !== null ? ` · ${r.ms} ms` : ''}</div>
            {(r.reason || r.error) && <div className="mt-0.5 text-[10px] text-gold">{r.reason ?? r.error}</div>}
          </li>
        ))}
      </ul>

      {u.history.length > 1 && (
        <>
          <h2 className="mb-2 mt-5 font-semibold">Últimos días</h2>
          <ul className="space-y-1 text-xs">
            {u.history.map((h) => (
              <li key={h.usage_date} className="flex justify-between border-b border-line py-1.5">
                <span className="shrink-0 whitespace-nowrap pr-2">{h.usage_date}</span>
                <span className="text-right text-muted">{h.requests} consultas · {h.blocked} bloqueadas · {h.failed} fallidas · {h.cache_hits} caché</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-5 text-[11px] text-faint">Prioridad: en vivo → próximos → calendario → Inicio → panel. Con poca cuota se suspenden primero las de menor prioridad.</p>
    </div>
  )
}

function Tile({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="card-flat p-3">
      <div className="scoreline text-2xl">{value}</div>
      <div className="text-[11px] leading-tight text-muted">{label}</div>
      {hint && <div className="text-[10px] text-faint">{hint}</div>}
    </div>
  )
}
