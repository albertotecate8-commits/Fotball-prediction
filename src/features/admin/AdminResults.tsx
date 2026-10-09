import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, PencilLine, RefreshCw, Undo2 } from 'lucide-react'
import { adminApi, type AdminMatch } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDateTime } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { MatchCard } from '@/components/MatchCard'
import { MATCH_STATUS_LABEL } from '@/components/StatusBadge'
import { SectionTitle } from '@/components/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { PillTabs } from '@/components/ui/Tabs'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState, InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import type { MatchStatus } from '@/types/domain'

type Tab = 'pending' | 'live' | 'confirmed' | 'issues'

export function AdminResults() {
  const qc = useQueryClient()
  const toast = useToast()
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.admin.results, queryFn: adminApi.resultsBoard, refetchInterval: 60_000 })
  const runs = useQuery({ queryKey: qk.admin.syncRuns, queryFn: adminApi.syncRuns })
  const [tab, setTab] = useState<Tab>('pending')
  const [editing, setEditing] = useState<AdminMatch | null>(null)
  const [syncing, setSyncing] = useState(false)

  const now = Date.now()
  const all = q.data ?? []
  const filters: Record<Tab, (m: AdminMatch) => boolean> = {
    pending: (m) => !m.result_confirmed && m.status !== 'live' && new Date(m.kickoff_at).getTime() <= now && !['cancelled', 'abandoned'].includes(m.status),
    live: (m) => m.status === 'live',
    confirmed: (m) => m.result_confirmed,
    issues: (m) => !!m.last_sync_error || ['postponed', 'suspended', 'cancelled', 'abandoned', 'unknown'].includes(m.status) || m.result_source === 'admin',
  }
  const list = all.filter(filters[tab])

  const syncNow = async () => {
    setSyncing(true)
    try {
      const r = await adminApi.syncNow()
      toast(`Sincronización ${r.status}: ${r.checked} revisados, ${r.updated} actualizados`, r.status === 'error' ? 'error' : 'success')
      await qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (e) { toast(errorMessage(e), 'error') } finally { setSyncing(false) }
  }

  const release = async (m: AdminMatch) => {
    if (!confirm('El proveedor volverá a controlar este marcador en la próxima sincronización. ¿Continuar?')) return
    try {
      await adminApi.releaseOverride(m.id)
      toast('Control devuelto al proveedor')
      await qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="display text-3xl font-semibold uppercase">Resultados</h1>
        <Button size="sm" loading={syncing} icon={<RefreshCw className="size-4" />} onClick={() => void syncNow()}>Sincronizar</Button>
      </div>
      <PillTabs label="Filtrar partidos" value={tab} onChange={setTab} className="mb-4" options={[
        { value: 'pending', label: 'Pendientes', count: all.filter(filters.pending).length },
        { value: 'live', label: 'En vivo', count: all.filter(filters.live).length },
        { value: 'confirmed', label: 'Confirmados', count: all.filter(filters.confirmed).length },
        { value: 'issues', label: 'Incidencias', count: all.filter(filters.issues).length },
      ]} />

      {q.isLoading ? <CardSkeleton lines={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <EmptyState title="Nada por aquí" description="Solo aparecen partidos incluidos en jornadas publicadas." />
      ) : (
        <ul className="space-y-3">
          {list.map((m) => (
            <li key={m.id}>
              <MatchCard match={m} tz={timezone} footer={
                <div className="flex w-full flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Badge tone={m.result_confirmed ? 'success' : 'neutral'}>{m.result_confirmed ? 'Confirmado' : 'Sin confirmar'}</Badge>
                    {m.result_source === 'admin' && <Badge tone="warning">Corrección manual</Badge>}
                    <span>{m.round_matches.map((rm) => rm.round.name).join(', ')}</span>
                  </div>
                  <div className="text-center">
                    Última actualización: <span className="capitalize">{m.last_synced_at ? formatDateTime(m.last_synced_at, timezone) : 'nunca'}</span> · {m.provider} #{m.external_id}
                  </div>
                  {m.last_sync_error && <div className="flex items-center justify-center gap-1 text-danger"><AlertTriangle className="size-3.5" /> {m.last_sync_error}</div>}
                  <div className="flex justify-center gap-2">
                    <Button size="sm" variant="secondary" icon={<PencilLine className="size-4" />} onClick={() => setEditing(m)}>Corregir</Button>
                    {m.result_source === 'admin' && <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => void release(m)}>Devolver al proveedor</Button>}
                  </div>
                </div>
              } />
            </li>
          ))}
        </ul>
      )}

      <SectionTitle>Historial de sincronización</SectionTitle>
      <ul className="card divide-y divide-line">
        {(runs.data ?? []).map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-sm">
            <Badge tone={r.status === 'success' ? 'success' : r.status === 'running' ? 'neutral' : 'danger'}>{r.status}</Badge>
            <span className="capitalize">{formatDateTime(r.started_at, timezone)}</span>
            <span className="text-xs text-muted">{r.trigger_source} · {r.provider} · {r.matches_checked} revisados · {r.matches_updated} actualizados</span>
            {r.error_message && <span className="w-full truncate text-xs text-danger">{r.error_message}</span>}
          </li>
        ))}
        {(runs.data ?? []).length === 0 && <li className="px-4 py-3 text-sm text-muted">Sin ejecuciones.</li>}
      </ul>

      {editing && <ResultSheet match={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ResultSheet({ match, onClose }: { match: AdminMatch; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState<MatchStatus>(match.status === 'unknown' ? 'finished' : match.status)
  const [home, setHome] = useState(match.home_goals?.toString() ?? '')
  const [away, setAway] = useState(match.away_goals?.toString() ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const needsScore = status === 'finished' || status === 'live'

  const save = async () => {
    setLoading(true)
    setError(null)
    try {
      await adminApi.recordResult(match.id, home === '' ? null : Number(home), away === '' ? null : Number(away), status, reason)
      toast('Resultado registrado y puntos recalculados')
      await qc.invalidateQueries()
      onClose()
    } catch (e) { setError(e) } finally { setLoading(false) }
  }

  return (
    <Sheet open onClose={onClose} title="Corregir resultado"
      footer={<Button block size="lg" loading={loading} disabled={reason.trim().length < 5 || (needsScore && (home === '' || away === ''))} onClick={() => void save()}>Guardar corrección</Button>}>
      <div className="space-y-4">
        <p className="text-sm font-semibold">{match.home.name} vs {match.away.name}</p>
        <Field label="Estado">{(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as MatchStatus)}>
            {(['scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled', 'abandoned'] as const).map((s) => <option key={s} value={s}>{MATCH_STATUS_LABEL[s]}</option>)}
          </Select>
        )}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Goles ${match.home.short_name}`}>{(id) => <Input id={id} inputMode="numeric" value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, '').slice(0, 2))} />}</Field>
          <Field label={`Goles ${match.away.short_name}`}>{(id) => <Input id={id} inputMode="numeric" value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, '').slice(0, 2))} />}</Field>
        </div>
        <Field label="Motivo (obligatorio)" hint="Queda registrado en la auditoría junto con el valor anterior.">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        <p className="text-xs text-muted">Mientras exista una corrección manual, el proveedor no sobrescribirá este marcador.</p>
        <InlineError error={error} />
      </div>
    </Sheet>
  )
}
