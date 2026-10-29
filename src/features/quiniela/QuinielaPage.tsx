import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, CheckCircle2, Goal, Lock, Minus, Plus, Send, Ticket } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAppConfig } from '@/hooks/useAppConfig'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { PageHeader } from '@/components/PageHeader'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState, InlineError } from '@/components/ui/States'
import { TestDataBadge } from '@/components/ui/Badge'
import { dayKey, formatDate, formatDateTime, formatTime } from '@/lib/time'
import { toAppError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { isComplete, outcomeLabel, PickCard, type PickValue } from './PickCard'
import { Celebration } from './Celebration'
import { PayToSend } from './PayToSend'
import type { PoolData, PoolMatch, PoolWeek } from '@/types/domain'

type Picks = Record<string, PickValue>
const empty: PickValue = { outcome: null, home: null, away: null }
const same = (a: PickValue, b: PickValue) => a.outcome === b.outcome
const backupKey = (user: string) => `shabex.pool.${user}`

/** Mi quiniela: todos los partidos publicados, por fecha; cada uno cierra a su hora de inicio. */
export function QuinielaPage() {
  const { isAdmin } = useAuth()
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.pool, queryFn: playerApi.pool, refetchInterval: 60_000 })
  return (
    <div className="pb-24">
      <PageHeader title="Mi quiniela" />
      {q.isLoading ? <CardSkeleton lines={6} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : q.data!.matches.length === 0 ? (
        <EmptyState icon={<Ticket className="size-6" />} title="Aún no hay partidos en la quiniela"
          description={isAdmin ? 'Los partidos se importan solos de las competiciones configuradas cuando el proveedor publica los de hoy y mañana. También puedes añadir uno.' : 'En cuanto haya partidos disponibles aparecerán aquí para que elijas tus resultados.'}
          action={isAdmin ? <ButtonLink to="/admin/partidos">Añadir partido</ButtonLink> : <ButtonLink to="/" variant="secondary">Ver partidos destacados</ButtonLink>} />
      ) : (
        <Form data={q.data!} tz={timezone} />
      )}
    </div>
  )
}

function Form({ data, tz }: { data: PoolData; tz: string }) {
  const { session, isAdmin } = useAuth()
  const qc = useQueryClient()
  const uid = session!.user.id
  const serverPicks = useMemo<Picks>(() => Object.fromEntries(data.matches.map((m) => [m.match_id,
    m.pick ? { outcome: m.pick.outcome, home: m.pick.home, away: m.pick.away } : empty])), [data.matches])
  const [picks, setPicks] = useState<Picks>(() => {
    try {
      const local = JSON.parse(localStorage.getItem(backupKey(uid)) ?? 'null') as Picks | null
      if (local) {
        // Solo cambios sin guardar de partidos que siguen abiertos.
        const open = new Set(data.matches.filter((m) => m.open && m.pick?.status !== 'submitted').map((m) => m.match_id))
        return { ...serverPicks, ...Object.fromEntries(Object.entries(local).filter(([id]) => open.has(id))) }
      }
    } catch { /* sin almacenamiento */ }
    return serverPicks
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [celebrate, setCelebrate] = useState(0)
  const [highlight, setHighlight] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const editable = data.matches.filter((m) => m.open && m.pick?.status !== 'submitted')
  const dirtyIds = editable.filter((m) => !same(picks[m.match_id] ?? empty, serverPicks[m.match_id] ?? empty)).map((m) => m.match_id)
  const dirty = dirtyIds.length > 0
  const canSubmitAny = editable.some((m) => m.can_submit)
  // Lo que se envía: los partidos que cubre el pago vigente. Los posteriores quedan guardados para después.
  const sendable = canSubmitAny ? editable.filter((m) => m.can_submit) : editable
  const later = canSubmitAny ? editable.filter((m) => !m.can_submit) : []
  const ready = sendable.filter((m) => isComplete(picks[m.match_id] ?? empty))
  const missing = sendable.filter((m) => !isComplete(picks[m.match_id] ?? empty))
  // Total de goles de cada jornada que aún no empieza (desempate): obligatorio para enviar.
  const weeks = useMemo(() => (data.weeks ?? []).filter((w) => data.matches.some((m) => m.week_id === w.id)), [data.weeks, data.matches])
  const [goals, setGoals] = useState<Record<string, number | null>>(() => Object.fromEntries((data.weeks ?? []).map((w) => [w.id, w.my_goals])))
  const goalWeeks = weeks.filter((w) => w.goals_open && w.my_goals_status !== 'submitted' && sendable.some((m) => m.week_id === w.id))
  const missingGoals = goalWeeks.filter((w) => goals[w.id] == null)
  const complete = sendable.length > 0 && missing.length === 0 && missingGoals.length === 0

  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(backupKey(uid), JSON.stringify(Object.fromEntries(dirtyIds.map((id) => [id, picks[id]]))))
      else localStorage.removeItem(backupKey(uid))
    } catch { /* sin almacenamiento */ }
  }, [picks, dirty, dirtyIds, uid])

  const toItem = (id: string) => ({ match_id: id, outcome: (picks[id] ?? empty).outcome })

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: qk.pool })
    await qc.invalidateQueries({ queryKey: qk.poolBoard })
  }

  // Guardado automático en el servidor (borrador): 1,2 s después del último cambio.
  const dirtyKey = dirtyIds.map((id) => `${id}:${picks[id]?.outcome}`).join('|')
  useEffect(() => {
    if (!dirtyKey) return
    const t = setTimeout(() => {
      setSaving(true)
      playerApi.savePool(dirtyKey.split('|').map((x) => toItem(x.split(':')[0]!)))
        .then(() => refresh())
        .catch((e) => setError(e))
        .finally(() => setSaving(false))
    }, 1200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirtyKey])

  // Mientras falte algo, el botón lleva al siguiente partido sin elegir o al total de goles.
  const goToMissing = () => {
    const first = missing[0]
    if (!first) {
      const w = missingGoals[0]
      if (w) document.getElementById(`goles-${w.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    setHighlight(first.match_id)
    document.getElementById(`partido-${first.match_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      // El total de goles se guarda antes de enviar (por si el guardado automático no alcanzó).
      for (const w of goalWeeks) await playerApi.saveWeekGoals(w.id, goals[w.id]!)
      await playerApi.submitPool(sendable.map((m) => toItem(m.match_id)))
      try { localStorage.removeItem(backupKey(uid)) } catch { /* sin almacenamiento */ }
      setConfirmOpen(false)
      setCelebrate(Date.now())
      await refresh()
    } catch (e) {
      const err = toAppError(e)
      await refresh()
      setError(err)
    } finally { setBusy(false) }
  }

  // Primero lo que sigue en juego (por fecha); abajo los ya terminados, del más reciente al más antiguo.
  const byDay = (list: PoolMatch[]) => {
    const map = new Map<string, PoolMatch[]>()
    for (const m of list) {
      const k = dayKey(new Date(m.kickoff_at), tz)
      map.set(k, [...(map.get(k) ?? []), m])
    }
    return [...map.entries()]
  }
  const { active, past } = useMemo(() => {
    const ended = (m: PoolMatch) => !m.open && ['finished', 'cancelled', 'postponed', 'abandoned'].includes(m.status)
    return {
      active: byDay(data.matches.filter((m) => !ended(m))),
      past: byDay(data.matches.filter(ended).reverse()),
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.matches, tz])

  const renderDay = ([day, list]: [string, PoolMatch[]]) => (
    <section key={day} className="mb-5">
      <h2 className="mb-2 text-xs font-bold uppercase tracking-[0.16em] text-muted capitalize">{formatDate(list[0]!.kickoff_at, tz)}</h2>
      <ol className="space-y-3">
        {list.map((m) => (
          <li key={m.match_id} id={`partido-${m.match_id}`} className="scroll-mt-28">
            <PickCard match={m} tz={tz} value={picks[m.match_id] ?? empty}
              disabled={!m.open || m.pick?.status === 'submitted'}
              saved={same(picks[m.match_id] ?? empty, serverPicks[m.match_id] ?? empty)}
              submitted={m.pick?.status === 'submitted'} highlight={highlight === m.match_id}
              onChange={(v) => { setPicks((p) => ({ ...p, [m.match_id]: v })); if (highlight === m.match_id && isComplete(v)) setHighlight(null) }} />
            {m.open && m.pick?.status !== 'submitted' && <p className="mt-1 px-1 text-[11px] text-faint">Cierra: <span className="capitalize">{formatDateTime(m.kickoff_at, tz)}</span></p>}
          </li>
        ))}
      </ol>
    </section>
  )

  return (
    <div>
      {/* Antes de llenarla: cómo pagar para poder enviarla (cuenta y referencia para copiar). */}
      {editable.length > 0 && !canSubmitAny && <PayToSend />}
      {(data.weeks ?? []).filter((w) => w.kind === 'weekday' && w.entry_amount && !w.my_entry && editable.some((m) => m.week_id === w.id)).map((w) => (
        <PayToSend key={w.id} amount={Number(w.entry_amount)} label={w.label} tone="soft" />
      ))}
      {editable.length > 0 && (
        <p className="mb-3 text-xs text-muted">Gana quien acierte más resultados. Si hay empate entre usuarios, gana quien más se acerque a los goles de la jornada.</p>
      )}
      {data.matches.some((m) => m.is_test_data) && <div className="mb-3"><TestDataBadge /></div>}
      {/* Estado de la sincronización: solo para el admin. */}
      <Freshness show={isAdmin && data.matches.some((m) => m.status === 'live' || (Date.parse(m.kickoff_at) <= Date.now() && !m.result_confirmed && m.status !== 'cancelled'))} tz={tz} />

      {active.map(renderDay)}
      {/* Goles solo de la jornada en curso: las ya terminadas no se muestran. */}
      {weeks.filter((w) => !w.real?.final).map((w) => (
        <WeekGoalsCard key={w.id} week={w} value={goals[w.id] ?? null} editable={goalWeeks.some((g) => g.id === w.id)}
          onChange={(v) => setGoals((g) => ({ ...g, [w.id]: v }))} onError={setError} />
      ))}
      {past.length > 0 && (
        <>
          <h2 className="display mb-3 mt-8 text-xl font-semibold uppercase">Resultados</h2>
          {past.map(renderDay)}
        </>
      )}

      {editable.length > 0 && (
        <div className="glass fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-30 border-t border-line px-4 py-3 lg:bottom-0 lg:left-64">
          <div className="mx-auto max-w-3xl">
            <InlineError error={error} />
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Partidos elegidos" aria-valuenow={ready.length} aria-valuemax={sendable.length}>
              <div className="h-full rounded-full bg-gold-soft transition-all" style={{ width: `${Math.round((ready.length / sendable.length) * 100)}%` }} />
            </div>
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <div className="scoreline text-xl">{ready.length}<span className="text-muted">/{sendable.length}</span></div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{saving ? 'guardando…' : 'elegidos'}</div>
              </div>
              {!complete ? (
                <Button size="lg" block variant="secondary" className="whitespace-nowrap px-4 text-base" icon={<ArrowDown className="size-5" />} onClick={goToMissing}>
                  {missing.length === 0 ? 'Falta el total de goles' : missing.length === 1 ? 'Falta 1 partido' : `Faltan ${missing.length} partidos`}
                </Button>
              ) : !canSubmitAny ? (
                <Button size="lg" block className="whitespace-nowrap px-4 text-base" disabled icon={<CheckCircle2 className="size-5" />}>Completa y guardada</Button>
              ) : (
                <Button size="lg" block className="whitespace-nowrap px-4 text-base" disabled={busy || saving} icon={<Send className="size-5" />} onClick={() => setConfirmOpen(true)}>Enviar quiniela</Button>
              )}
            </div>
          </div>
        </div>
      )}
      {editable.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted"><CheckCircle2 className="size-4 text-success" /> No tienes partidos pendientes por enviar.</p>
      )}

      <Sheet open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="¿Enviar tu quiniela?"
        footer={<Button block size="lg" loading={busy} disabled={!complete} icon={<Send className="size-5" />} onClick={() => void submit()}>Enviar quiniela · {sendable.length}</Button>}>
        <div className="space-y-3 text-sm">
          <ul className="space-y-1.5">
            {sendable.map((m) => {
              const p = picks[m.match_id] ?? empty
              return (
                <li key={m.match_id} className="card-flat flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{m.home.short_name} vs {m.away.short_name}</span>
                  <span className="shrink-0 font-semibold text-gold-soft">{outcomeLabel(p.outcome, m)}</span>
                </li>
              )
            })}
          </ul>
          {goalWeeks.map((w) => (
            <p key={w.id} className="card-flat flex items-center justify-between gap-2 px-3 py-2">
              <span>Goles en la jornada ({w.label})</span><span className="scoreline text-lg text-gold">{goals[w.id]}</span>
            </p>
          ))}
          {later.length > 0 && (
            <p className="text-xs text-muted">
              {later.map((m) => `${m.home.short_name} vs ${m.away.short_name}`).join(', ')}: tu pago no {later.length === 1 ? 'lo cubre' : 'los cubre'} (después de su vigencia o de una quiniela con entrada aparte); queda{later.length === 1 ? '' : 'n'} guardado{later.length === 1 ? '' : 's'} para enviar después.
            </p>
          )}
          <p className="flex items-start gap-2 text-muted"><Lock className="mt-0.5 size-4 shrink-0" /> Al enviarla ya no se puede cambiar.</p>
          <InlineError error={error} />
        </div>
      </Sheet>
      {celebrate > 0 && <Celebration key={celebrate} onClose={() => setCelebrate(0)} />}
    </div>
  )
}

/** Con partidos en juego: hora de la última actualización y aviso si está en pausa por cuota. */
function Freshness({ show, tz }: { show: boolean; tz: string }) {
  const f = useQuery({ queryKey: ['freshness'], queryFn: playerApi.freshness, enabled: show, refetchInterval: 60_000 })
  if (!show || !f.data?.updated_at) return null
  return (
    <p className={`mb-3 text-xs ${f.data.delayed ? 'text-gold' : 'text-muted'}`}>
      {f.data.delayed ? 'Actualización en pausa para cuidar la cuota del proveedor. ' : ''}Resultados actualizados a las {formatTime(f.data.updated_at, tz)}.
    </p>
  )
}

/** Total de goles de la jornada (desempate): − / + y se guarda solo. */
function WeekGoalsCard({ week: w, value, editable, onChange, onError }: {
  week: PoolWeek; value: number | null; editable: boolean; onChange: (v: number) => void; onError: (e: unknown) => void
}) {
  const qc = useQueryClient()
  const [saved, setSaved] = useState<number | null>(w.my_goals)
  useEffect(() => {
    if (!editable || value === null || value === saved) return
    const t = setTimeout(() => {
      playerApi.saveWeekGoals(w.id, value).then(() => { setSaved(value); void qc.invalidateQueries({ queryKey: qk.pool }) }).catch(onError)
    }, 900)
    return () => clearTimeout(t)
  }, [value, editable, saved, w.id, qc, onError])
  const real = w.real
  const step = (d: number) => onChange(Math.max(0, Math.min(200, (value ?? (d > 0 ? 0 : 1)) + d)))
  return (
    <section id={`goles-${w.id}`} aria-labelledby={`goles-h-${w.id}`} className={cn('card mb-5 scroll-mt-28 p-4', editable && value === null && 'border-gold/60 ring-2 ring-gold/25')}>
      <div className="flex items-start gap-3">
        <Goal className="mt-0.5 size-6 shrink-0 text-gold" />
        <div className="min-w-0 flex-1">
          <h2 id={`goles-h-${w.id}`} className="font-semibold">¿Cuántos goles habrá en la jornada?</h2>
          <p className="text-xs text-muted">Suma de goles de todos los partidos de {w.label}. Sirve para desempatar: gana quien más se acerque.</p>
        </div>
      </div>
      {editable ? (
        <div className="mt-3 flex items-center justify-center gap-3">
          <button type="button" aria-label="Menos goles en la jornada" onClick={() => step(-1)} disabled={value === 0}
            className="grid size-12 place-items-center rounded-2xl border border-line-strong bg-surface-2 active:scale-95 disabled:opacity-35"><Minus className="size-6" /></button>
          <output aria-label="Goles en la jornada" className={cn('scoreline w-20 text-center text-5xl', value === null ? 'text-faint' : 'text-ink')}>{value ?? '–'}</output>
          <button type="button" aria-label="Más goles en la jornada" onClick={() => step(1)} disabled={value === 200}
            className="grid size-12 place-items-center rounded-2xl border border-gold-soft/50 bg-gold-soft/15 text-gold-soft active:scale-95 disabled:opacity-35"><Plus className="size-6" /></button>
        </div>
      ) : (
        <p className="mt-3 text-sm">
          Tu total: <span className="scoreline text-xl text-gold">{w.my_goals_status === 'submitted' ? w.my_goals : '—'}</span>
          {w.my_goals_status !== 'submitted' && !w.goals_open && <span className="ml-2 text-xs text-muted">La jornada ya empezó.</span>}
        </p>
      )}
      {real.counted > 0 && (
        <p className="mt-2 text-xs text-muted">Goles reales hasta ahora: <span className="font-semibold text-ink">{real.goals}</span> en {real.counted} de {real.total} partidos{real.final ? ' (final)' : ''}.</p>
      )}
      {editable && <p className="mt-2 text-center text-[11px] text-faint">{value === null ? 'Elige un número' : value === saved ? 'Guardado' : 'Guardando…'} · se puede cambiar hasta que empiece el primer partido</p>}
    </section>
  )
}
