import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, EyeOff, Eye, Plus } from 'lucide-react'
import { adminApi, type CatalogTeam, type ManualCandidate, type PoolAdminMatch } from '@/services/admin'
import { useAppConfig } from '@/hooks/useAppConfig'
import { dayKey, formatDate, formatShortDate, formatTime, fromLocalInput, toLocalInput } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { TeamCrest } from '@/components/TeamCrest'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { TeamPicker } from './TeamPicker'

const POOL_KEY = ['admin', 'pool'] as const

/** Partidos de la quiniela: automáticos (API) y añadidos por el admin. */
export function AdminPool() {
  const { timezone } = useAppConfig()
  const list = useQuery({ queryKey: POOL_KEY, queryFn: adminApi.poolList })
  const [adding, setAdding] = useState(false)
  const days = useMemo(() => {
    const map = new Map<string, PoolAdminMatch[]>()
    for (const m of list.data ?? []) {
      const k = dayKey(m.kickoff_at, timezone)
      map.set(k, [...(map.get(k) ?? []), m])
    }
    return [...map.entries()]
  }, [list.data, timezone])

  return (
    <div>
      <h1 className="display mb-1 text-3xl font-semibold uppercase">Partidos</h1>
      <p className="mb-4 text-sm text-muted">Los partidos de las ligas configuradas se importan solos. Cada uno cierra a su hora de inicio.</p>
      <Button className="mb-5 w-full" icon={<Plus className="size-5" />} onClick={() => setAdding(true)}>Añadir partido</Button>
      {list.isLoading ? <CardSkeleton lines={4} /> : list.error ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : days.length === 0 ? (
        <EmptyState title="Aún no hay partidos" description="Se importarán automáticamente o puedes añadir uno." />
      ) : (
        <div className="space-y-5">
          {days.map(([k, ms]) => (
            <section key={k}>
              <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.15em] text-aqua">{formatDate(ms[0]!.kickoff_at, timezone)}</h2>
              <ul className="space-y-2">{ms.map((m) => <PoolRow key={m.match_id} m={m} tz={timezone} />)}</ul>
            </section>
          ))}
        </div>
      )}
      <AddMatchSheet open={adding} onClose={() => setAdding(false)} tz={timezone} />
    </div>
  )
}

function PoolRow({ m, tz }: { m: PoolAdminMatch; tz: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [mode, setMode] = useState<'none' | 'status' | 'time'>('none')
  const [reason, setReason] = useState('')
  const [kickoff, setKickoff] = useState(toLocalInput(m.kickoff_at, tz))
  const [busy, setBusy] = useState(false)
  const published = m.pool_status === 'published'
  const manual = m.provider === 'manual'
  const started = Date.parse(m.kickoff_at) <= Date.now() || m.status !== 'scheduled'

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try {
      await fn()
      toast(ok)
      setMode('none')
      setReason('')
      await qc.invalidateQueries({ queryKey: POOL_KEY })
      await qc.invalidateQueries({ queryKey: ['pool'] })
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  return (
    <li className="card p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[11px]">
        <Badge tone={m.source === 'auto' ? 'accent' : 'gold'}>{m.source === 'auto' ? 'Automático' : 'Añadido por admin'}</Badge>
        <Badge tone={published ? 'success' : 'neutral'}>{published ? 'Publicado' : 'Retirado'}</Badge>
        <Badge tone={m.open ? 'success' : 'neutral'}>{m.open ? 'Abierto' : 'Cerrado'}</Badge>
        <span className="ml-auto text-muted">{manual ? 'Manual' : `API-Football #${m.external_id}`}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2"><TeamCrest team={m.home} size={26} /><span className="truncate text-sm font-semibold">{m.home.short_name}</span></div>
        <span className="scoreline shrink-0 text-lg">{m.status === 'finished' ? `${m.home_goals}:${m.away_goals}` : formatTime(m.kickoff_at, tz)}</span>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2"><span className="truncate text-right text-sm font-semibold">{m.away.short_name}</span><TeamCrest team={m.away} size={26} /></div>
      </div>
      <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted">
        <span className="truncate">{m.competition?.name ?? 'Sin competición'}</span>
        <span>{m.picks} {m.picks === 1 ? 'pronóstico enviado' : 'pronósticos enviados'}</span>
      </div>
      {m.change_reason && <p className="mt-1 text-[11px] text-faint">Último cambio: {m.change_reason}</p>}

      {mode === 'none' ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" icon={published ? <EyeOff className="size-4" /> : <Eye className="size-4" />} onClick={() => setMode('status')}>{published ? 'Retirar' : 'Publicar'}</Button>
          {manual && !started && <Button size="sm" variant="ghost" icon={<CalendarClock className="size-4" />} onClick={() => setMode('time')}>Editar horario</Button>}
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {mode === 'time' && (
            <Input type="datetime-local" aria-label="Nueva fecha y hora" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />
          )}
          <Input aria-label="Motivo" placeholder={mode === 'status' ? (published ? 'Motivo para retirarlo' : 'Motivo para publicarlo') : 'Motivo del cambio de horario'}
            value={reason} onChange={(e) => setReason(e.target.value)} />
          {mode === 'status' && published && m.picks > 0 && <p className="text-xs text-gold">Tiene pronósticos enviados: dejarán de contar mientras esté retirado.</p>}
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={reason.trim().length < 5 || (mode === 'time' && !fromLocalInput(kickoff, tz))}
              onClick={() => {
                if (mode === 'status') {
                  if (!confirm(published ? '¿Retirar este partido de la quiniela?' : '¿Publicar este partido en la quiniela?')) return
                  void run(() => adminApi.setPoolStatus(m.match_id, published ? 'withdrawn' : 'published', reason.trim()), published ? 'Partido retirado' : 'Partido publicado')
                } else {
                  const iso = fromLocalInput(kickoff, tz)!
                  if (!confirm(`¿Cambiar el horario a ${formatShortDate(iso, tz)} ${formatTime(iso, tz)}?`)) return
                  void run(() => adminApi.updatePoolMatch(m.match_id, iso, reason.trim()), 'Horario actualizado')
                }
              }}>Confirmar</Button>
            <Button size="sm" variant="ghost" onClick={() => { setMode('none'); setReason('') }}>Cancelar</Button>
          </div>
        </div>
      )}
    </li>
  )
}

type Step = { kind: 'form' } | { kind: 'choose'; candidates: ManualCandidate[]; message: string }

function AddMatchSheet({ open, onClose, tz }: { open: boolean; onClose: () => void; tz: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const comps = useQuery({ queryKey: ['admin', 'competitions'], queryFn: adminApi.competitions, enabled: open })
  const [home, setHome] = useState<CatalogTeam | null>(null)
  const [away, setAway] = useState<CatalogTeam | null>(null)
  const [compId, setCompId] = useState('')
  const [compName, setCompName] = useState('')
  const [kickoff, setKickoff] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [busy, setBusy] = useState(false)
  const comp = (comps.data ?? []).find((c) => c.id === compId)
  const iso = kickoff ? fromLocalInput(kickoff, tz) : null
  const valid = !!home && !!away && home.id !== away.id && !!iso && Date.parse(iso) > Date.now()

  const reset = () => { setHome(null); setAway(null); setCompId(''); setCompName(''); setKickoff(''); setStep({ kind: 'form' }) }
  const close = () => { reset(); onClose() }
  const finish = async (msg: string) => {
    toast(msg)
    await qc.invalidateQueries({ queryKey: POOL_KEY })
    await qc.invalidateQueries({ queryKey: ['pool'] })
    close()
  }
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  // 1) Se busca el partido oficial en la API; 2) si no existe, se registra como manual.
  const search = (pick?: string) => guard(async () => {
    if (!home || !away || !iso) return
    const r = await adminApi.addManualMatch('api-football', {
      home: home.name, away: away.name, kickoff_at: iso,
      competitionId: comp?.provider === 'api-football' ? comp.external_id : undefined,
      competitionName: comp?.name ?? (compName.trim() || undefined),
      pick_external_id: pick, no_create: true,
    })
    if (r.kind === 'linked') {
      await adminApi.publishMatch(r.match_id)
      await finish(`Publicado y vinculado con API-Football #${r.fixture.external_id}`)
    } else if (r.kind === 'manual' || r.kind === 'pending_link') {
      await adminApi.publishMatch(r.match_id)
      await finish('Partido publicado')
    } else {
      setStep({
        kind: 'choose', candidates: r.candidates,
        message: r.kind === 'outside_window' ? 'La API gratuita solo consulta de ayer a mañana. Regístralo como manual; se vinculará solo cuando entre en la ventana.'
          : r.kind === 'ambiguous' ? 'Hay varios partidos parecidos en la API. Elige el correcto.'
          : 'No se encontró en la API. Puedes elegir uno parecido o registrarlo como manual.',
      })
    }
  })
  const createManual = () => guard(async () => {
    if (!home || !away || !iso) return
    if (!confirm(`¿Registrar ${home.name} vs ${away.name} como partido añadido por el admin?`)) return
    const r = await adminApi.createPoolMatch(home.id, away.id, iso, comp?.id ?? null, comp ? null : (compName.trim() || null))
    await finish(r.created ? 'Partido manual publicado' : 'Ese partido ya existía: se mantiene el registrado')
  })

  return (
    <Sheet open={open} onClose={close} title="Añadir partido"
      footer={step.kind === 'form' ? (
        <Button className="w-full" loading={busy} disabled={!valid} onClick={() => void search()}>Guardar y publicar</Button>
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" loading={busy} onClick={() => void createManual()}>Registrar como manual</Button>
          <Button variant="ghost" onClick={() => setStep({ kind: 'form' })}>Volver</Button>
        </div>
      )}>
      {step.kind === 'form' ? (
        <div className="space-y-4">
          <TeamPicker label="Equipo local" value={home} onChange={setHome} />
          <TeamPicker label="Equipo visitante" value={away} onChange={setAway} />
          {home && away && home.id === away.id && <p className="text-xs text-danger">Elige dos equipos distintos.</p>}
          <Field label="Competición">{(id) => (
            <Select id={id} value={compId} onChange={(e) => setCompId(e.target.value)}>
              <option value="">Otra / escribir nombre</option>
              {(comps.data ?? []).filter((c) => !c.is_test_data).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}</Field>
          {!compId && <Field label="Nombre de la competición (opcional)">{(id) => <Input id={id} maxLength={80} value={compName} onChange={(e) => setCompName(e.target.value)} />}</Field>}
          <Field label="Fecha y hora (Ciudad de México)" hint="Los pronósticos cierran a esta hora." error={iso && Date.parse(iso) <= Date.now() ? 'Debe ser una hora futura.' : null}>
            {(id) => <Input id={id} type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />}
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{step.message}</p>
          {step.candidates.map((c) => (
            <button key={c.external_id} type="button" disabled={busy} onClick={() => void search(c.external_id)}
              className="card-flat w-full px-3 py-2.5 text-left text-sm hover:border-aqua/40">
              <div className="font-semibold">{c.home} vs {c.away}</div>
              <div className="text-[11px] text-muted">{formatShortDate(c.kickoff_at, tz)} · {formatTime(c.kickoff_at, tz)} · {c.competition ?? '—'} · API-Football #{c.external_id}</div>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
