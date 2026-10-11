import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Eye, Plus, Save, Search, Send, Undo2, X } from 'lucide-react'
import { adminApi, type NextPoolMatch, type SelectionItem } from '@/services/admin'
import { useAppConfig } from '@/hooks/useAppConfig'
import { dayKey, formatDate, formatShortDate, formatTime } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { setAdminPreview } from '@/lib/adminPreview'
import { cn } from '@/lib/cn'
import { TeamCrest } from '@/components/TeamCrest'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { AddMatchSheet, NEXT_POOL_KEY } from './AddMatchSheet'

type Draft = Record<string, { state: NextPoolMatch['state']; sort: number | null }>

const fromServer = (rows: NextPoolMatch[]): Draft => Object.fromEntries(rows.map((m) => [m.match_id, { state: m.state, sort: m.sort_order }]))

const REVIEW: Record<string, string> = {
  NOT_IN_PROVIDER: 'Ya no aparece en API-Football',
  'STATUS:postponed': 'Aplazado por el proveedor',
  'STATUS:cancelled': 'Cancelado por el proveedor',
  'STATUS:suspended': 'Suspendido',
  'STATUS:abandoned': 'Abandonado',
}

/** Estados visibles del partido: descubierto, seleccionado, publicado, retirado, aplazado/cancelado, en vivo, finalizado. */
function badges(m: NextPoolMatch, state: NextPoolMatch['state']) {
  const out: { label: string; tone: Tone }[] = []
  if (m.status === 'live') out.push({ label: 'En vivo', tone: 'live' })
  else if (m.status === 'finished') out.push({ label: 'Finalizado', tone: 'neutral' })
  else if (m.status === 'postponed') out.push({ label: 'Aplazado', tone: 'warning' })
  else if (m.status === 'cancelled') out.push({ label: 'Cancelado', tone: 'danger' })
  else if (m.status === 'suspended' || m.status === 'abandoned') out.push({ label: 'Suspendido', tone: 'warning' })
  if (m.published && state === 'selected') out.push({ label: 'Publicado', tone: 'success' })
  else if (m.published) out.push({ label: 'Se retirará al publicar', tone: 'danger' })
  else if (state === 'selected') out.push({ label: 'Seleccionado · sin publicar', tone: 'gold' })
  else if (m.withdrawn) out.push({ label: 'Retirado', tone: 'neutral' })
  else if (state === 'dismissed') out.push({ label: 'Descartado', tone: 'neutral' })
  else out.push({ label: 'Descubierto', tone: 'accent' })
  if (m.needs_review) out.push({ label: `Revisar: ${REVIEW[m.review_reason ?? ''] ?? 'cambio en el proveedor'}`, tone: 'warning' })
  if (m.home.retired || m.away.retired) out.push({ label: 'Equipo retirado', tone: 'danger' })
  return out
}

/** «Próxima quiniela»: el admin elige y ordena; la API solo sugiere. Nada se publica sin confirmar. */
export function AdminNextPool() {
  const { timezone: tz } = useAppConfig()
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const q = useQuery({ queryKey: NEXT_POOL_KEY, queryFn: adminApi.nextPool })
  const [draft, setDraft] = useState<Draft>({})
  const [dirty, setDirty] = useState(false)
  const [search, setSearch] = useState('')
  const [day, setDay] = useState('')
  const [showDismissed, setShowDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sheet, setSheet] = useState<'none' | 'publish' | 'preview' | 'add'>('none')
  const [reason, setReason] = useState('')

  // Lo del servidor manda mientras no haya cambios sin guardar.
  useEffect(() => { if (q.data && !dirty) setDraft(fromServer(q.data)) }, [q.data, dirty])

  const rows = useMemo(() => q.data ?? [], [q.data])
  const st = (m: NextPoolMatch) => draft[m.match_id]?.state ?? m.state
  const selected = useMemo(() => rows.filter((m) => st(m) === 'selected')
    .sort((a, b) => (draft[a.match_id]?.sort ?? 1e6) - (draft[b.match_id]?.sort ?? 1e6) || Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, draft])
  const term = search.trim().toLowerCase()
  const matchesFilter = (m: NextPoolMatch) => (!day || dayKey(m.kickoff_at, tz) === day)
    && (!term || [m.home.name, m.away.name, m.competition?.name ?? ''].some((s) => s.toLowerCase().includes(term)))
  // Solo se ofrecen partidos que no han empezado.
  const suggested = rows.filter((m) => st(m) === 'suggested' && m.open)
  const available = suggested.filter(matchesFilter).sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at))
  const dismissed = rows.filter((m) => st(m) === 'dismissed' && m.open && matchesFilter(m))
  const days = [...new Set(rows.filter((m) => m.open && st(m) !== 'selected').map((m) => dayKey(m.kickoff_at, tz)))].sort()

  const toPublish = selected.filter((m) => !m.published && m.open)
  const blocked = selected.filter((m) => !m.published && !m.open)
  const toWithdraw = rows.filter((m) => m.published && st(m) !== 'selected')
  const withdrawPicks = toWithdraw.reduce((n, m) => n + m.picks, 0)
  const orderChanged = selected.some((m) => m.published && (draft[m.match_id]?.sort ?? null) !== m.sort_order)
  const pending = toPublish.length + toWithdraw.length + (orderChanged ? 1 : 0)

  const update = (fn: (d: Draft) => Draft) => { setDraft((d) => fn({ ...d })); setDirty(true) }
  const renumber = (d: Draft, ids: string[]) => { ids.forEach((id, i) => { d[id] = { state: 'selected', sort: i + 1 } }); return d }
  const add = (m: NextPoolMatch) => update((d) => renumber(d, [...selected.map((x) => x.match_id), m.match_id]))
  const remove = (m: NextPoolMatch) => {
    if (m.published && m.picks > 0 && !confirm(`Este partido ya tiene ${m.picks} ${m.picks === 1 ? 'pronóstico enviado' : 'pronósticos enviados'}. Al publicar se retirará de la quiniela: los pronósticos se conservan en el historial, pero dejarán de contar. ¿Quitarlo de la selección?`)) return
    update((d) => { d[m.match_id] = { state: 'suggested', sort: null }; return renumber(d, selected.filter((x) => x.match_id !== m.match_id).map((x) => x.match_id)) })
  }
  const setState = (m: NextPoolMatch, state: 'suggested' | 'dismissed') => update((d) => { d[m.match_id] = { state, sort: null }; return d })
  const move = (i: number, dir: -1 | 1) => {
    const ids = selected.map((x) => x.match_id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    update((d) => renumber(d, ids))
  }

  const changedItems = (): SelectionItem[] => rows.flatMap((m) => {
    const d = draft[m.match_id]
    if (!d || (d.state === m.state && (d.state !== 'selected' || d.sort === m.sort_order))) return []
    return [{ match_id: m.match_id, selected: d.state === 'selected', dismissed: d.state === 'dismissed', sort_order: d.state === 'selected' ? d.sort : null }]
  })
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: NEXT_POOL_KEY })
    await qc.invalidateQueries({ queryKey: ['pool'] })
  }
  const persist = async () => {
    const items = changedItems()
    if (!items.length) return { saved: 0, skipped_started: 0 }
    const r = await adminApi.saveSelection(items)
    if (r.skipped_started) toast(`${r.skipped_started} partido(s) ya iniciaron y no se agregaron.`, 'error')
    return r
  }
  const save = async () => {
    setBusy(true)
    try {
      await persist()
      setDirty(false)
      await refresh()
      toast('Selección guardada (aún sin publicar)')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  const publish = async () => {
    setBusy(true)
    try {
      await persist()
      const r = await adminApi.publishSelection(toWithdraw.length ? reason.trim() : null)
      setDirty(false)
      setSheet('none')
      setReason('')
      await refresh()
      toast(`Quiniela actualizada: ${r.published} publicado(s)${r.withdrawn ? `, ${r.withdrawn} retirado(s)` : ''}`)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  const discard = () => { if (q.data) setDraft(fromServer(q.data)); setDirty(false) }

  if (q.isLoading) return <CardSkeleton lines={5} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />

  return (
    <div className="pb-28">
      <h1 className="display mb-1 text-3xl font-semibold uppercase">Próxima quiniela</h1>
      <p className="mb-4 text-sm text-muted">La API encuentra partidos reales y los deja como sugerencia. Tú eliges, ordenas y publicas. Cada partido cierra a su hora de inicio (hora de Ciudad de México).</p>

      <section aria-labelledby="sel-h" className="mb-7">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 id="sel-h" className="text-xs font-bold uppercase tracking-[0.15em] text-aqua">A · Partidos seleccionados ({selected.length})</h2>
          {pending > 0 && <span className="text-[11px] font-semibold text-gold">{pending} cambio(s) sin publicar</span>}
        </div>
        {selected.length === 0 ? (
          <EmptyState title="Sin partidos seleccionados" description="Agrega partidos de la lista de disponibles." />
        ) : (
          <ol className="space-y-2">
            {selected.map((m, i) => (
              <Row key={m.match_id} m={m} tz={tz} state="selected" index={i + 1}>
                <Button size="sm" variant="ghost" aria-label="Subir" disabled={i === 0} onClick={() => move(i, -1)} icon={<ArrowUp className="size-4" />} />
                <Button size="sm" variant="ghost" aria-label="Bajar" disabled={i === selected.length - 1} onClick={() => move(i, 1)} icon={<ArrowDown className="size-4" />} />
                <Button size="sm" variant="ghost" className="ml-auto" icon={<X className="size-4" />} onClick={() => remove(m)}>Quitar</Button>
              </Row>
            ))}
          </ol>
        )}
        {blocked.length > 0 && <p className="mt-2 text-xs text-gold">{blocked.length} seleccionado(s) ya iniciaron sin publicarse: no se agregarán a la quiniela.</p>}
      </section>

      <section aria-labelledby="av-h">
        <h2 id="av-h" className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-aqua">B · Partidos disponibles para agregar ({suggested.length})</h2>
        <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <Input aria-label="Buscar partido" placeholder="Equipo o competición" className="pl-11" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <Select aria-label="Filtrar por fecha" value={day} onChange={(e) => setDay(e.target.value)}>
            <option value="">Todas las fechas</option>
            {days.map((d) => <option key={d} value={d}>{formatShortDate(`${d}T18:00:00Z`, 'UTC')}</option>)}
          </Select>
        </div>
        <Button variant="outline" className="mb-3 w-full" icon={<Plus className="size-5" />} onClick={() => setSheet('add')}>Agregar partido que no aparece</Button>
        {available.length === 0 ? (
          <EmptyState title="No hay partidos disponibles" description={suggested.length ? 'Ningún partido coincide con el filtro.' : 'Se descubren solos con la sincronización (dentro de la cuota diaria).'} />
        ) : (
          <ul className="space-y-2">
            {available.map((m) => (
              <Row key={m.match_id} m={m} tz={tz} state="suggested">
                <Button size="sm" icon={<Plus className="size-4" />} onClick={() => add(m)}>Agregar</Button>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setState(m, 'dismissed')}>Descartar</Button>
              </Row>
            ))}
          </ul>
        )}
        {dismissed.length > 0 && (
          <div className="mt-4">
            <button type="button" className="text-xs font-semibold text-muted underline-offset-2 hover:underline" onClick={() => setShowDismissed((v) => !v)}>
              {showDismissed ? 'Ocultar' : 'Ver'} descartados ({dismissed.length})
            </button>
            {showDismissed && (
              <ul className="mt-2 space-y-2">
                {dismissed.map((m) => (
                  <Row key={m.match_id} m={m} tz={tz} state="dismissed">
                    <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setState(m, 'suggested')}>Recuperar</Button>
                  </Row>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <div className="glass fixed inset-x-0 bottom-0 z-30 border-t border-line pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-1.5 px-4 py-3">
          <Button size="sm" variant="secondary" className="px-3" icon={<Save className="size-4" />} disabled={!dirty} loading={busy && sheet === 'none'} onClick={() => void save()}>Guardar</Button>
          {dirty && <Button size="sm" variant="ghost" className="px-2.5" aria-label="Deshacer cambios" icon={<Undo2 className="size-4" />} onClick={discard} />}
          <Button size="sm" variant="ghost" className="px-2.5" aria-label="Vista previa" icon={<Eye className="size-4" />} onClick={() => setSheet('preview')}><span className="hidden sm:inline">Vista previa</span></Button>
          <Button size="sm" className="ml-auto px-3.5" icon={<Send className="size-4" />} disabled={pending === 0} onClick={() => setSheet('publish')}>Publicar{pending ? ` (${pending})` : ''}</Button>
        </div>
      </div>

      <Sheet open={sheet === 'publish'} onClose={() => setSheet('none')} title="Publicar la quiniela"
        footer={<Button className="w-full" loading={busy} disabled={toWithdraw.length > 0 && reason.trim().length < 5} onClick={() => void publish()}>Confirmar y publicar</Button>}>
        <div className="space-y-4 text-sm">
          <p className="text-muted">Los participantes verán exactamente los partidos seleccionados, en este orden.</p>
          {toPublish.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold text-success">Se publican ({toPublish.length})</h3>
              <ul className="space-y-1">{toPublish.map((m) => <li key={m.match_id} className="text-xs">{m.home.short_name} vs {m.away.short_name} · {formatShortDate(m.kickoff_at, tz)} {formatTime(m.kickoff_at, tz)}</li>)}</ul>
            </div>
          )}
          {toWithdraw.length > 0 && (
            <div>
              <h3 className="mb-1 font-semibold text-danger">Se retiran ({toWithdraw.length})</h3>
              <ul className="space-y-1">{toWithdraw.map((m) => <li key={m.match_id} className="text-xs">{m.home.short_name} vs {m.away.short_name}{m.picks ? ` · ${m.picks} pronóstico(s) enviados` : ''}</li>)}</ul>
              {withdrawPicks > 0 && <p className="mt-2 rounded-xl border border-gold/40 bg-gold/10 p-2 text-xs text-gold">Hay {withdrawPicks} pronóstico(s) enviados en partidos que se retiran. No se borran ni se modifican: quedan en el historial y dejan de contar. Los puntos no se recalculan en silencio.</p>}
              <Input className="mt-2" aria-label="Motivo del retiro" placeholder="Motivo del retiro (obligatorio, queda en la auditoría)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
          {orderChanged && <p className="text-xs text-muted">También se actualiza el orden de los partidos.</p>}
          {blocked.length > 0 && <p className="text-xs text-gold">{blocked.length} partido(s) seleccionados ya iniciaron y no se publicarán.</p>}
        </div>
      </Sheet>

      <Sheet open={sheet === 'preview'} onClose={() => setSheet('none')} title="Vista previa para participantes"
        footer={<Button variant="outline" className="w-full" icon={<Eye className="size-4" />} onClick={() => { setAdminPreview(true); void navigate('/quinielas') }}>Abrir la app como participante</Button>}>
        <Preview rows={selected.filter((m) => m.published || m.open)} tz={tz} />
      </Sheet>

      <AddMatchSheet open={sheet === 'add'} onClose={() => setSheet('none')} tz={tz} />
    </div>
  )
}

function Row({ m, tz, state, index, children }: { m: NextPoolMatch; tz: string; state: NextPoolMatch['state']; index?: number; children: React.ReactNode }) {
  return (
    <li className={cn('card p-3', state === 'selected' && 'border-aqua/30')}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {index !== undefined && <span className="scoreline mr-1 text-lg text-aqua">{index}</span>}
        {badges(m, state).map((b) => <Badge key={b.label} tone={b.tone} className="normal-case tracking-normal">{b.label}</Badge>)}
        <Badge tone={m.source === 'auto' ? 'accent' : 'gold'} className="normal-case tracking-normal">{m.source === 'auto' ? 'Automático' : 'Manual'}</Badge>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2"><TeamCrest team={m.home} size={28} /><span className="truncate text-sm font-semibold" title={m.home.name}>{m.home.short_name}</span></div>
        <span className="scoreline shrink-0 text-lg">{m.status === 'finished' || m.status === 'live' ? `${m.home_goals ?? 0}:${m.away_goals ?? 0}` : formatTime(m.kickoff_at, tz)}</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2"><span className="truncate text-right text-sm font-semibold" title={m.away.name}>{m.away.short_name}</span><TeamCrest team={m.away} size={28} /></div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-muted">
        <span className="truncate">{m.competition?.name ?? 'Sin competición'} · <span className="capitalize">{formatShortDate(m.kickoff_at, tz)}</span> {formatTime(m.kickoff_at, tz)}</span>
        <span>{m.external_id ? `API-Football #${m.external_id}` : 'Registrado por el admin'}{m.picks ? ` · ${m.picks} pronóstico(s)` : ''}</span>
      </div>
      <div className="mt-2 flex items-center gap-1">{children}</div>
    </li>
  )
}

/** Igual que la verán los jugadores: por día y, dentro del día, en el orden del admin. */
function Preview({ rows, tz }: { rows: NextPoolMatch[]; tz: string }) {
  if (!rows.length) return <EmptyState title="Sin partidos" description="Selecciona partidos para ver la vista previa." />
  const byDay = new Map<string, NextPoolMatch[]>()
  for (const m of rows) { const k = dayKey(m.kickoff_at, tz); byDay.set(k, [...(byDay.get(k) ?? []), m]) }
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted">Así se verá «Mi quiniela» después de publicar ({rows.length} partidos). Cada partido cierra a su hora de inicio.</p>
      {[...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, ms]) => (
        <section key={k}>
          <h3 className="mb-1.5 text-xs font-bold uppercase tracking-[0.15em] text-aqua">{formatDate(ms[0]!.kickoff_at, tz)}</h3>
          <ul className="space-y-1.5">
            {ms.map((m) => (
              <li key={m.match_id} className="card-flat flex items-center gap-2 px-3 py-2 text-sm">
                <TeamCrest team={m.home} size={22} /><span className="min-w-0 flex-1 truncate font-semibold">{m.home.short_name}</span>
                <span className="scoreline text-sm text-muted">{formatTime(m.kickoff_at, tz)}</span>
                <span className="min-w-0 flex-1 truncate text-right font-semibold">{m.away.short_name}</span><TeamCrest team={m.away} size={22} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
