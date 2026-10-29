import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Plus, RotateCcw, Search, Trash2 } from 'lucide-react'
import { adminApi, type TeamCatalogEntry } from '@/services/admin'
import { errorMessage } from '@/lib/errors'
import { formatDate } from '@/lib/time'
import { useAppConfig } from '@/hooks/useAppConfig'
import { TeamCrest } from '@/components/TeamCrest'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { AddTeamFlow } from './AddTeamFlow'
import { NEXT_POOL_KEY } from './AddMatchSheet'

const CATALOG_KEY = ['admin', 'team-catalog'] as const

/** Catálogo de equipos: añadir (API-Football o manual), retirar, restaurar y eliminar sin perder historial. */
export function AdminTeams() {
  const { timezone } = useAppConfig()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState<TeamCatalogEntry | null>(null)
  const list = useQuery({ queryKey: [...CATALOG_KEY, q], queryFn: () => adminApi.teamCatalog(q) })
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: CATALOG_KEY })
    await qc.invalidateQueries({ queryKey: ['admin', 'teams'] })
    await qc.invalidateQueries({ queryKey: NEXT_POOL_KEY })
  }
  const rows = list.data ?? []

  return (
    <div>
      <h1 className="display mb-4 text-3xl font-semibold uppercase">Equipos</h1>
      <div className="mb-4 flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="Buscar en el catálogo" placeholder="Buscar en el catálogo" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Button className="shrink-0" icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>Añadir equipo</Button>
      </div>

      {list.isLoading ? <CardSkeleton lines={4} /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : rows.length === 0 ? (
        <EmptyState title="Sin equipos" description={q ? `«${q}» no está en tu catálogo.` : 'Añade el primero con «Añadir equipo».'}
          action={q.trim().length >= 3 ? <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Buscar «{q.trim()}» en internet y añadirlo</Button> : undefined} />
      ) : (
        <ul className="space-y-1.5">
          {rows.map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => setManaging(t)} className="card-flat flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:border-gold-soft/40">
                <TeamCrest team={{ ...t, code: null }} size={28} className={t.retired ? 'opacity-50 grayscale' : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{t.name}</span>
                  <span className="block text-[11px] text-muted">
                    {t.external_id ? `API-Football #${t.external_id}` : 'Manual'} · {t.matches} {t.matches === 1 ? 'partido' : 'partidos'}{t.pool_picks + t.round_picks ? ` · ${t.pool_picks + t.round_picks} pronósticos` : ''}
                  </span>
                  {t.aliases?.length > 0 && <span className="block truncate text-[11px] text-faint">También: {t.aliases.join(', ')}</span>}
                </span>
                {t.followed && <Badge tone="accent" className="normal-case tracking-normal">Cada semana</Badge>}
                {t.retired ? <Badge tone="danger" className="normal-case tracking-normal">Retirado</Badge>
                  : t.provider === 'manual' ? <Badge tone="gold" className="normal-case tracking-normal">Manual</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={adding} onClose={() => setAdding(false)} title="Añadir equipo">
        <p className="mb-3 text-sm text-muted">Escribe el nombre o un apodo. Se busca solo, primero en tu catálogo y luego en internet, con escudo e identificador oficiales; nunca se duplica.</p>
        {adding && <AddTeamFlow initialName={q} offerFollow onDone={() => { setAdding(false); void refresh() }} onCancel={() => setAdding(false)} />}
      </Sheet>
      <ManageSheet team={managing} tz={timezone} onClose={() => setManaging(null)} onChanged={refresh} />
    </div>
  )
}

function ManageSheet({ team: t, tz, onClose, onChanged }: { team: TeamCatalogEntry | null; tz: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [mode, setMode] = useState<'none' | 'retire' | 'delete'>('none')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => { setMode('none'); setReason(''); onClose() }
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast(ok); await onChanged(); close() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  if (!t) return null
  const history = t.matches > 0
  return (
    <Sheet open={!!t} onClose={close} title={t.name}>
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-3">
          <TeamCrest team={{ ...t, code: null }} size={44} />
          <div className="min-w-0">
            <div className="truncate font-semibold">{t.name}</div>
            <div className="text-xs text-muted">{t.external_id ? `API-Football #${t.external_id}` : 'Equipo manual (sin id oficial)'}</div>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-2 text-xs">
          <div className="card-flat p-2"><dt className="text-muted">Partidos</dt><dd className="scoreline text-lg">{t.matches}</dd></div>
          <div className="card-flat p-2"><dt className="text-muted">En la selección</dt><dd className="scoreline text-lg">{t.selected}</dd></div>
          <div className="card-flat p-2"><dt className="text-muted">Pronósticos (quiniela)</dt><dd className="scoreline text-lg">{t.pool_picks}</dd></div>
          <div className="card-flat p-2"><dt className="text-muted">Pronósticos (jornadas)</dt><dd className="scoreline text-lg">{t.round_picks}</dd></div>
        </dl>
        {!t.retired && t.provider === 'api-football' && (
          <label className="card-flat flex items-center gap-3 p-3 text-sm">
            <input type="checkbox" className="size-5 accent-[var(--color-brand)]" checked={t.followed} disabled={busy}
              onChange={(e) => { const on = e.target.checked; void run(async () => {
                const r = await adminApi.followTeam(t.id, on)
                if (on && r.selected_now) toast(`${r.selected_now} partido(s) agregados a la quiniela`)
              }, on ? 'Se incluirá cada semana en la quiniela' : 'Ya no se incluirá cada semana') }} />
            <span><span className="block font-semibold">Incluir cada semana</span><span className="block text-xs text-muted">Sus partidos entran solos a las quinielas automáticas (en curso y futuras).</span></span>
          </label>
        )}
        {t.retired ? (
          <div className="space-y-2">
            <p className="text-xs text-muted">Retirado el {t.retired_at ? formatDate(t.retired_at, tz) : '—'}{t.retire_reason ? ` · Motivo: ${t.retire_reason}` : ''}. No se sugiere ni se reimporta automáticamente.</p>
            <Button className="w-full" variant="outline" loading={busy} icon={<RotateCcw className="size-4" />}
              onClick={() => { if (confirm(`¿Restaurar ${t.name}? Volverá a ofrecerse en las sugerencias.`)) void run(() => adminApi.restoreTeam(t.id), 'Equipo restaurado') }}>Restaurar equipo</Button>
          </div>
        ) : mode === 'none' ? (
          <div className="space-y-2">
            <Button className="w-full" variant="outline" icon={<Archive className="size-4" />} onClick={() => setMode('retire')}>Retirar equipo</Button>
            <Button className="w-full" variant="danger" icon={<Trash2 className="size-4" />} disabled={!t.deletable} onClick={() => setMode('delete')}>Eliminar del catálogo</Button>
            {!t.deletable && <p className="text-xs text-muted">Tiene historial ({t.matches} {t.matches === 1 ? 'partido' : 'partidos'}): no se puede eliminar para no perder pronósticos, resultados ni puntos. Puedes retirarlo.</p>}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">{mode === 'retire'
              ? 'Retirar: sale del catálogo activo y de las sugerencias, y no se reimporta solo. Sus partidos, pronósticos y resultados se conservan. Se puede restaurar.'
              : history ? 'Este equipo tiene historial y no puede eliminarse.' : 'Eliminar: se borra definitivamente del catálogo (no tiene partidos ni pronósticos). Queda registrado en la auditoría.'}</p>
            {mode === 'retire' && t.selected > 0 && <p className="text-xs text-gold">Está en {t.selected} partido(s) seleccionados: esos se mantienen hasta que los quites en «Próxima quiniela».</p>}
            <Input aria-label="Motivo" placeholder="Motivo (obligatorio, mínimo 5 caracteres)" maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex gap-2">
              <Button size="sm" variant={mode === 'delete' ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 5 || (mode === 'delete' && history)}
                onClick={() => {
                  if (mode === 'retire') void run(() => adminApi.retireTeam(t.id, reason.trim()), 'Equipo retirado')
                  else if (confirm(`¿Eliminar definitivamente a ${t.name} del catálogo?`)) void run(() => adminApi.deleteTeam(t.id, reason.trim()), 'Equipo eliminado')
                }}>{mode === 'retire' ? 'Confirmar retiro' : 'Eliminar definitivamente'}</Button>
              <Button size="sm" variant="ghost" onClick={() => { setMode('none'); setReason('') }}>Cancelar</Button>
            </div>
          </div>
        )}
      </div>
    </Sheet>
  )
}
