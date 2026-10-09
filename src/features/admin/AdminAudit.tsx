import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { adminApi } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDateTime } from '@/lib/time'
import { Button } from '@/components/ui/Button'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'

const ACTION_LABEL: Record<string, string> = {
  'prediction.submitted': 'Quiniela enviada',
  'round.created': 'Jornada creada',
  'round.updated': 'Jornada editada',
  'round.matches_set': 'Partidos de jornada',
  'round.participants_set': 'Participantes de jornada',
  'round.status_changed': 'Cambio de estado',
  'round.auto_closed': 'Cierre automático',
  'round.auto_finalized': 'Finalización automática',
  'round.recomputed': 'Recalculo de puntos',
  'round.deleted': 'Jornada eliminada',
  'match.result_overridden': 'Corrección manual de resultado',
  'match.result_corrected_by_provider': 'Corrección del proveedor',
  'match.override_released': 'Control devuelto al proveedor',
  'match.kickoff_changed': 'Cambio de horario',
  'user.status_changed': 'Estado de usuario',
  'user.role_changed': 'Rol de usuario',
  'user.invited': 'Invitación',
  'member.updated': 'Membresía',
  'group.created': 'Grupo creado',
  'group.updated': 'Grupo editado',
  'group.invite_regenerated': 'Código regenerado',
  'group.join_requested': 'Solicitud de ingreso',
  'admin.bootstrap': 'Primer administrador',
  'sync.manual_run': 'Sincronización manual',
  'setting.updated': 'Configuración',
}

export function AdminAudit() {
  const { timezone } = useAppConfig()
  const [page, setPage] = useState(0)
  const q = useQuery({ queryKey: qk.admin.audit(page), queryFn: () => adminApi.audit(page) })
  return (
    <div>
      <h1 className="display mb-4 text-3xl font-semibold uppercase">Auditoría</h1>
      {q.isLoading ? <CardSkeleton lines={6} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (q.data ?? []).length === 0 ? (
        <EmptyState title="Sin registros" />
      ) : (
        <ol className="card divide-y divide-line">
          {q.data!.map((l) => (
            <li key={l.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{ACTION_LABEL[l.action] ?? l.action}</span>
                <span className="text-xs capitalize text-muted">{formatDateTime(l.created_at, timezone)}</span>
              </div>
              <div className="text-xs text-muted">{l.actor?.display_name ?? 'Sistema'} · {l.entity_type}{l.entity_id ? ` ${l.entity_id.slice(0, 8)}` : ''}</div>
              {Object.keys(l.details ?? {}).length > 0 && (
                <pre className="mt-1 max-h-32 overflow-auto rounded-xl bg-bg/60 p-2 text-[11px] text-muted">{JSON.stringify(l.details, null, 1)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}
      <div className="mt-4 flex justify-between">
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anteriores</Button>
        <Button variant="secondary" size="sm" disabled={(q.data ?? []).length < 30} onClick={() => setPage((p) => p + 1)}>Siguientes</Button>
      </div>
    </div>
  )
}
