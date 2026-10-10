import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, CloudDownload, Lock, Plus, Search, Trash2, X } from 'lucide-react'
import { adminApi, type AdminMatch, type AdminRound } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { dayKey, formatDateTime, formatShortDate, formatTime, fromLocalInput, toLocalInput } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { TeamCrest } from '@/components/TeamCrest'
import { MATCH_STATUS_LABEL } from '@/components/StatusBadge'
import { Badge, TestDataBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState, InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { ROUND_STATUS } from './AdminRounds'
import type { MatchStatus, RoundStatus } from '@/types/domain'

export function AdminRoundEditor() {
  const { roundId = '' } = useParams()
  const q = useQuery({ queryKey: qk.admin.round(roundId), queryFn: () => adminApi.round(roundId) })
  if (q.isLoading) return <CardSkeleton lines={8} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return <Editor key={q.data!.id + q.dataUpdatedAt} round={q.data!} />
}

function Editor({ round }: { round: AdminRound }) {
  const qc = useQueryClient()
  const toast = useToast()
  const navigate = useNavigate()
  const { timezone } = useAppConfig()
  const submissions = useQuery({ queryKey: qk.admin.submissions(round.id), queryFn: () => adminApi.submissions(round.id) })
  const submittedCount = (submissions.data ?? []).filter((s) => s.prediction_status === 'submitted').length
  const editableMatches = (round.status === 'draft' || round.status === 'open') && submittedCount === 0
  const editableDetails = round.status === 'draft' || round.status === 'open' || round.status === 'closed'

  const [name, setName] = useState(round.name)
  const [description, setDescription] = useState(round.description ?? '')
  const [opensAt, setOpensAt] = useState(toLocalInput(round.opens_at, timezone))
  const [deadline, setDeadline] = useState(toLocalInput(round.deadline_at, timezone))
  const [participation, setParticipation] = useState(round.participation)
  const [matches, setMatches] = useState<AdminMatch[]>(round.round_matches.map((rm) => rm.match))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const matchesDirty = matches.map((m) => m.id).join() !== round.round_matches.map((rm) => rm.match.id).join()
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      toast(ok)
      await refresh()
    } catch (e) {
      setError(e)
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveDetails = () => act(async () => {
    const d = fromLocalInput(deadline, timezone)
    if (!d) throw new Error('DEADLINE_REQUIRED')
    await adminApi.saveRound({
      id: round.id, group_id: round.group_id, name, description,
      opens_at: opensAt ? fromLocalInput(opensAt, timezone) : null, deadline_at: d, participation,
    })
  }, 'Datos guardados')

  const changeStatus = (to: RoundStatus, confirmText?: string) => {
    let reason: string | undefined
    if (to === 'under_review') {
      reason = prompt('Motivo de la revisión (queda en auditoría):') ?? undefined
      if (!reason) return
    } else if (confirmText && !confirm(confirmText)) return
    void act(() => adminApi.setRoundStatus(round.id, to, reason), `Jornada: ${ROUND_STATUS[to].label}`)
  }

  const firstKickoff = matches.length ? matches.reduce((a, m) => (m.kickoff_at < a ? m.kickoff_at : a), matches[0]!.kickoff_at) : null
  const deadlineIso = fromLocalInput(deadline, timezone)
  const deadlineWarning = firstKickoff && deadlineIso && deadlineIso > firstKickoff ? 'La fecha límite es posterior al primer partido.' : null

  return (
    <div>
      <PageHeader title={round.name} back="/admin/jornadas" subtitle={round.group?.name} />
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Badge tone={ROUND_STATUS[round.status].tone}>{ROUND_STATUS[round.status].label}</Badge>
        <Badge tone="neutral">{submittedCount} enviadas</Badge>
        {!editableMatches && <Badge tone="neutral" icon={<Lock className="size-3" />}>Partidos bloqueados</Badge>}
      </div>
      <InlineError error={error} />

      <SectionTitle>Estado</SectionTitle>
      <div className="card flex flex-wrap gap-2 p-4">
        {round.status === 'draft' && <Button disabled={busy || matchesDirty} onClick={() => changeStatus('open', '¿Abrir la jornada? Los jugadores podrán enviar pronósticos.')}>Abrir jornada</Button>}
        {round.status === 'open' && <Button variant="secondary" disabled={busy} onClick={() => changeStatus('closed', '¿Cerrar la jornada ahora? Nadie más podrá enviar.')}>Cerrar ahora</Button>}
        {round.status === 'open' && <Button variant="ghost" disabled={busy} onClick={() => changeStatus('draft')}>Volver a borrador</Button>}
        {round.status === 'closed' && <Button variant="secondary" disabled={busy} onClick={() => changeStatus('open', '¿Reabrir? Solo es posible si la fecha límite está en el futuro.')}>Reabrir</Button>}
        {round.status === 'closed' && <Button disabled={busy} onClick={() => changeStatus('finished', '¿Finalizar y hacer oficiales los puntos?')}>Finalizar</Button>}
        {round.status === 'finished' && <Button variant="secondary" disabled={busy} onClick={() => changeStatus('under_review')}>Poner en revisión</Button>}
        {round.status === 'under_review' && <Button disabled={busy} onClick={() => changeStatus('finished')}>Confirmar como finalizada</Button>}
        {round.status !== 'draft' && <Button variant="ghost" disabled={busy} onClick={() => void act(() => adminApi.recompute(round.id), 'Puntos recalculados')}>Recalcular puntos</Button>}
        {round.status === 'draft' && (
          <Button variant="danger" disabled={busy} icon={<Trash2 className="size-4" />}
            onClick={() => { if (confirm('¿Eliminar este borrador?')) void act(async () => { await adminApi.deleteRound(round.id); navigate('/admin/jornadas') }, 'Jornada eliminada') }}>
            Eliminar
          </Button>
        )}
        {matchesDirty && round.status === 'draft' && <p className="w-full text-xs text-muted">Guarda los partidos antes de abrir.</p>}
      </div>

      <SectionTitle>Datos</SectionTitle>
      <div className="card space-y-4 p-4">
        <Field label="Nombre">{(id) => <Input id={id} value={name} maxLength={80} disabled={!editableDetails} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Descripción">{(id) => <Textarea id={id} value={description} maxLength={500} disabled={!editableDetails} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Visible desde (opcional)" hint="Antes de esta hora se muestra como «Próxima».">{(id) => <Input id={id} type="datetime-local" value={opensAt} disabled={!editableDetails} onChange={(e) => setOpensAt(e.target.value)} />}</Field>
          <Field label="Fecha límite" hint={`Zona horaria: ${timezone}`} error={deadlineWarning}>{(id) => <Input id={id} type="datetime-local" value={deadline} disabled={!editableDetails} onChange={(e) => setDeadline(e.target.value)} />}</Field>
        </div>
        <Field label="¿Quién participa?">{(id) => (
          <Select id={id} value={participation} disabled={!editableDetails || submittedCount > 0} onChange={(e) => setParticipation(e.target.value as 'all_members')}>
            <option value="all_members">Todos los miembros activos del grupo</option>
            <option value="selected">Solo jugadores seleccionados</option>
          </Select>
        )}</Field>
        {editableDetails && <Button disabled={busy} onClick={() => void saveDetails()}>Guardar datos</Button>}
        {submittedCount > 0 && <p className="text-xs text-muted">Hay quinielas enviadas: cualquier cambio queda registrado en la auditoría.</p>}
      </div>

      <SectionTitle action={editableMatches && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setPickerOpen(true)}>Agregar</Button>}>
        Partidos ({matches.length})
      </SectionTitle>
      {matches.length === 0 ? (
        <EmptyState title="Sin partidos" description="Selecciona manualmente los partidos de esta jornada." action={editableMatches && <Button onClick={() => setPickerOpen(true)}>Seleccionar partidos</Button>} />
      ) : (
        <ol className="space-y-2">
          {matches.map((m, i) => (
            <li key={m.id} className="card-flat flex items-center gap-2 px-3 py-2.5">
              <span className="scoreline w-6 text-lg text-muted">{i + 1}</span>
              <MatchLine m={m} tz={timezone} />
              {editableMatches && (
                <div className="flex shrink-0 gap-1">
                  <button type="button" aria-label="Subir" disabled={i === 0} className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/5 disabled:opacity-30"
                    onClick={() => setMatches((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i]!, n[i - 1]!]; return n })}><ArrowUp className="size-4" /></button>
                  <button type="button" aria-label="Bajar" disabled={i === matches.length - 1} className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/5 disabled:opacity-30"
                    onClick={() => setMatches((l) => { const n = [...l]; [n[i + 1], n[i]] = [n[i]!, n[i + 1]!]; return n })}><ArrowDown className="size-4" /></button>
                  <button type="button" aria-label="Quitar" className="grid size-8 place-items-center rounded-full text-danger hover:bg-danger/10"
                    onClick={() => setMatches((l) => l.filter((x) => x.id !== m.id))}><X className="size-4" /></button>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
      {matchesDirty && (
        <div className="mt-3 flex gap-2">
          <Button disabled={busy} onClick={() => void act(() => adminApi.setRoundMatches(round.id, matches.map((m) => m.id)), 'Partidos guardados')}>Guardar partidos</Button>
          <Button variant="ghost" onClick={() => setMatches(round.round_matches.map((rm) => rm.match))}>Descartar</Button>
        </div>
      )}

      {participation === 'selected' && round.participation === 'selected' && <ParticipantsPicker round={round} disabled={!editableDetails || busy} onSave={act} />}

      <SectionTitle>Envíos</SectionTitle>
      {submissions.isLoading ? <CardSkeleton lines={2} /> : (
        <ul className="card divide-y divide-line">
          {(submissions.data ?? []).map((s) => (
            <li key={s.user_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="flex-1 font-semibold">{s.display_name}</span>
              {s.prediction_status === 'submitted'
                ? <span className="text-xs capitalize text-muted">{formatDateTime(s.submitted_at!, timezone)}</span>
                : <span className="text-xs text-muted">{s.items}/{matches.length}</span>}
              <Badge tone={s.prediction_status === 'submitted' ? 'success' : s.prediction_status === 'draft' ? 'olive' : 'neutral'}>
                {s.prediction_status === 'submitted' ? 'Enviada' : s.prediction_status === 'draft' ? 'Borrador' : 'Sin iniciar'}
              </Badge>
              {s.points !== null && <span className="scoreline w-10 text-right text-lg text-lime">{s.points}</span>}
            </li>
          ))}
          {(submissions.data ?? []).length === 0 && <li className="px-4 py-3 text-sm text-muted">Sin jugadores elegibles.</li>}
        </ul>
      )}

      {pickerOpen && <MatchPicker selected={matches} onClose={() => setPickerOpen(false)} onAdd={(add) => { setMatches((l) => [...l, ...add]); setPickerOpen(false) }} />}
    </div>
  )
}

function MatchLine({ m, tz }: { m: AdminMatch; tz: string }) {
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <TeamCrest team={m.home} size={22} /><span className="truncate">{m.home.short_name}</span>
        <span className="text-muted">vs</span>
        <span className="truncate">{m.away.short_name}</span><TeamCrest team={m.away} size={22} />
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
        <span className="capitalize">{formatShortDate(m.kickoff_at, tz)} {formatTime(m.kickoff_at, tz)}</span>
        {m.competition && <span>· {m.competition.name}</span>}
        <span>· {MATCH_STATUS_LABEL[m.status]}</span>
        <span className="font-mono">· #{m.external_id}</span>
        {m.is_test_data && <TestDataBadge />}
      </div>
    </div>
  )
}

function MatchPicker({ selected, onClose, onAdd }: { selected: AdminMatch[]; onClose: () => void; onAdd: (m: AdminMatch[]) => void }) {
  const { timezone } = useAppConfig()
  const toast = useToast()
  const today = dayKey(new Date(), timezone)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(dayKey(new Date(Date.now() + 7 * 86400e3), timezone))
  const [team, setTeam] = useState('')
  const [competitionId, setCompetitionId] = useState('')
  const [status, setStatus] = useState<MatchStatus | ''>('scheduled')
  const [providerCompetition, setProviderCompetition] = useState('')
  const [season, setSeason] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<unknown>(null)

  const filters = useMemo(() => ({
    competitionId: competitionId || undefined,
    from: fromLocalInput(`${from}T00:00`, timezone) ?? undefined,
    to: fromLocalInput(`${to}T23:59`, timezone) ?? undefined,
    status, team,
  }), [competitionId, from, to, status, team, timezone])
  const competitions = useQuery({ queryKey: ['admin', 'competitions'], queryFn: adminApi.competitions })
  const results = useQuery({ queryKey: qk.admin.matches(filters), queryFn: () => adminApi.searchMatches(filters) })
  const providerStatus = useQuery({ queryKey: ['admin', 'providerStatus'], queryFn: adminApi.providerStatus, retry: 0, staleTime: 300_000 })
  const [providerChoice, setProviderChoice] = useState('')
  const providerId = providerChoice || providerStatus.data?.default_provider || ''
  const providerInfo = providerStatus.data?.providers?.find((p) => p.id === providerId)
  const providerComps = useQuery({
    queryKey: ['admin', 'providerCompetitions', providerId], queryFn: () => adminApi.providerCompetitions(providerId),
    enabled: !!providerId && providerInfo?.configured !== false, retry: 0, staleTime: 3600_000,
  })
  const selectedIds = new Set(selected.map((m) => m.id))

  useEffect(() => { setPicked(new Set()) }, [filters])

  const importFromProvider = async () => {
    setImporting(true)
    setImportError(null)
    try {
      const r = await adminApi.importFromProvider(providerId, {
        competitionId: providerCompetition || undefined, season: season || undefined,
        // Sin competición, el proveedor real busca un solo día (una solicitud).
        from, to: providerCompetition || providerInfo?.is_test_data ? to : from, team: team || undefined,
      })
      toast(`${r.match_ids.length} partidos del proveedor (${r.inserted} nuevos)${r.cached ? ' · desde caché' : ''}${r.is_test_data ? ' · datos de prueba' : ''}`)
      await results.refetch()
      await competitions.refetch()
    } catch (e) { setImportError(e) } finally { setImporting(false) }
  }

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const list = results.data ?? []

  return (
    <Sheet open onClose={onClose} title="Seleccionar partidos" className="sm:max-w-2xl"
      footer={<Button block size="lg" disabled={picked.size === 0} onClick={() => onAdd(list.filter((m) => picked.has(m.id)))}>Agregar {picked.size || ''} partidos</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Desde">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="Hasta">{(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
          <Field label="Competición">{(id) => (
            <Select id={id} value={competitionId} onChange={(e) => setCompetitionId(e.target.value)}>
              <option value="">Todas</option>
              {(competitions.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_test_data ? ' (prueba)' : ''}</option>)}
            </Select>
          )}</Field>
          <Field label="Estado">{(id) => (
            <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as MatchStatus)}>
              <option value="">Todos</option>
              {(['scheduled', 'live', 'finished', 'postponed'] as const).map((s) => <option key={s} value={s}>{MATCH_STATUS_LABEL[s]}</option>)}
            </Select>
          )}</Field>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input aria-label="Equipo" placeholder="Buscar equipo" className="pl-11" value={team} onChange={(e) => setTeam(e.target.value)} />
        </div>

        <details className="card-flat p-3">
          <summary className="cursor-pointer text-sm font-semibold">Traer partidos del proveedor deportivo</summary>
          <div className="mt-3 space-y-3">
            {providerStatus.data?.providers && (
              <Field label="Fuente de datos">{(id) => (
                <Select id={id} value={providerId} onChange={(e) => { setProviderChoice(e.target.value); setProviderCompetition('') }}>
                  {providerStatus.data.providers.map((p) => (
                    <option key={p.id} value={p.id} disabled={!p.configured}>
                      {p.id === 'api-football' ? 'API-Football · datos reales' : 'Demostración · datos de prueba'}{p.configured ? '' : ' (sin clave)'}
                    </option>
                  ))}
                </Select>
              )}</Field>
            )}
            {providerInfo && (
              <p className="text-xs text-muted">
                {providerInfo.is_test_data ? <TestDataBadge /> : <>Consultas hoy: <span className="font-semibold text-ink">{providerInfo.usage?.requests ?? 0} / {providerInfo.budget_daily}</span>
                  {providerInfo.usage?.reported_remaining != null && <> · el proveedor informa {providerInfo.usage.reported_remaining} restantes</>}
                  {!providerCompetition && <> · sin competición se busca solo el día «Desde»</>}</>}
              </p>
            )}
            {providerStatus.error ? <InlineError error={providerStatus.error} /> : null}
            {providerComps.error ? <InlineError error={providerComps.error} /> : null}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Competición del proveedor">{(id) => (
                <Select id={id} value={providerCompetition} onChange={(e) => {
                  setProviderCompetition(e.target.value)
                  const c = providerComps.data?.competitions.find((x) => x.external_id === e.target.value)
                  if (c?.season) setSeason(c.season)
                }}>
                  <option value="">Cualquiera</option>
                  {(providerComps.data?.competitions ?? []).slice(0, 300).map((c) => <option key={c.external_id} value={c.external_id}>{c.name}{c.country ? ` · ${c.country}` : ''}</option>)}
                </Select>
              )}</Field>
              <Field label="Temporada">{(id) => <Input id={id} inputMode="numeric" placeholder="2026" value={season} onChange={(e) => setSeason(e.target.value)} />}</Field>
            </div>
            <InlineError error={importError} />
            <Button variant="secondary" block loading={importing} disabled={!providerId || providerInfo?.configured === false} icon={<CloudDownload className="size-4" />} onClick={() => void importFromProvider()}>Buscar en el proveedor</Button>
          </div>
        </details>

        {results.isLoading ? <CardSkeleton lines={4} /> : results.error ? <ErrorState error={results.error} /> : list.length === 0 ? (
          <EmptyState title="Sin partidos" description="Ajusta los filtros o tráelos del proveedor deportivo." />
        ) : (
          <ul className="space-y-2">
            {list.map((m) => {
              const already = selectedIds.has(m.id)
              return (
                <li key={m.id}>
                  <label className={`card-flat flex items-center gap-3 px-3 py-2.5 ${already ? 'opacity-50' : 'cursor-pointer hover:border-lime/30'}`}>
                    <input type="checkbox" className="size-5 shrink-0 accent-[var(--color-lime)]" disabled={already} checked={already || picked.has(m.id)} onChange={() => toggle(m.id)} />
                    <MatchLine m={m} tz={timezone} />
                    {already && <Badge tone="neutral">Ya incluido</Badge>}
                  </label>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Sheet>
  )
}

function ParticipantsPicker({ round, disabled, onSave }: { round: AdminRound; disabled: boolean; onSave: (fn: () => Promise<unknown>, ok: string) => Promise<void> }) {
  const members = useQuery({ queryKey: qk.admin.groupMembers(round.group_id), queryFn: () => adminApi.groupMembers(round.group_id) })
  const [sel, setSel] = useState<Set<string>>(new Set(round.round_participants.map((p) => p.user_id)))
  return (
    <>
      <SectionTitle>Jugadores que participan</SectionTitle>
      <div className="card p-4">
        <ul className="space-y-2">
          {(members.data ?? []).filter((m) => m.member_status === 'active').map((m) => (
            <li key={m.user_id}>
              <label className="flex items-center gap-3 text-sm">
                <input type="checkbox" className="size-5 accent-[var(--color-lime)]" disabled={disabled} checked={sel.has(m.user_id)}
                  onChange={() => setSel((s) => { const n = new Set(s); if (n.has(m.user_id)) n.delete(m.user_id); else n.add(m.user_id); return n })} />
                {m.display_name} <span className="text-xs text-muted">{m.email}</span>
              </label>
            </li>
          ))}
        </ul>
        <Button className="mt-4" disabled={disabled} onClick={() => void onSave(() => adminApi.setRoundParticipants(round.id, [...sel]), 'Participantes guardados')}>Guardar participantes</Button>
      </div>
    </>
  )
}
