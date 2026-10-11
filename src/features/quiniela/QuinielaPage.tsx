import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, CheckCircle2, CreditCard, Lock, Send, Ticket } from 'lucide-react'
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
import { isComplete, PickCard, type PickValue } from './PickCard'
import { Celebration } from './Celebration'
import type { PoolData, PoolMatch } from '@/types/domain'

type Picks = Record<string, PickValue>
const empty: PickValue = { outcome: null, home: null, away: null }
const same = (a: PickValue, b: PickValue) => a.home === b.home && a.away === b.away
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
  const { session } = useAuth()
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
  const ready = editable.filter((m) => isComplete(picks[m.match_id] ?? empty))
  const missing = editable.filter((m) => !isComplete(picks[m.match_id] ?? empty))
  const complete = editable.length > 0 && missing.length === 0
  const canSubmitAny = editable.some((m) => m.can_submit)

  useEffect(() => {
    try {
      if (dirty) localStorage.setItem(backupKey(uid), JSON.stringify(Object.fromEntries(dirtyIds.map((id) => [id, picks[id]]))))
      else localStorage.removeItem(backupKey(uid))
    } catch { /* sin almacenamiento */ }
  }, [picks, dirty, dirtyIds, uid])

  const toItem = (id: string) => {
    const p = picks[id] ?? empty
    const score = p.home !== null && p.away !== null
    return { match_id: id, outcome: p.outcome, home: score ? p.home : null, away: score ? p.away : null }
  }

  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: qk.pool })
    await qc.invalidateQueries({ queryKey: qk.poolBoard })
  }

  // Guardado automático en el servidor (borrador): 1,2 s después del último cambio.
  const dirtyKey = dirtyIds.map((id) => `${id}:${picks[id]?.home}-${picks[id]?.away}`).join('|')
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

  // Mientras falten marcadores, el botón lleva al siguiente partido incompleto.
  const goToMissing = () => {
    const first = missing[0]
    if (!first) return
    setHighlight(first.match_id)
    document.getElementById(`partido-${first.match_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await playerApi.submitPool(editable.map((m) => toItem(m.match_id)))
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
              submitted={m.pick?.status === 'submitted'} maxGoals={data.max_goals} highlight={highlight === m.match_id}
              onChange={(v) => { setPicks((p) => ({ ...p, [m.match_id]: v })); if (highlight === m.match_id && isComplete(v)) setHighlight(null) }} />
            {m.open && m.pick?.status !== 'submitted' && <p className="mt-1 px-1 text-[11px] text-faint">Cierra: <span className="capitalize">{formatDateTime(m.kickoff_at, tz)}</span></p>}
          </li>
        ))}
      </ol>
    </section>
  )

  return (
    <div>
      {editable.length > 0 && !canSubmitAny && (
        <section className="mb-4 flex items-start gap-3 rounded-2xl border border-gold/35 bg-gold/10 p-3 text-sm">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-gold" />
          <div className="flex-1">
            <p className="font-semibold text-gold">Tu quiniela se guarda sola; para enviarla necesitas tu pago confirmado</p>
            <p className="mt-0.5 text-xs text-muted">Solo las quinielas enviadas suman puntos.</p>
          </div>
          <ButtonLink to="/perfil#pago" size="sm" variant="secondary">Ver cómo pagar</ButtonLink>
        </section>
      )}
      {editable.length > 0 && (
        <p className="mb-3 text-xs text-muted">Pon el marcador de <span className="font-semibold text-ink">todos</span> los partidos y envía tu quiniela completa. Una vez enviada ya no se puede cambiar.</p>
      )}
      {data.matches.some((m) => m.is_test_data) && <div className="mb-3"><TestDataBadge /></div>}
      <WeekBanner />
      <Freshness show={data.matches.some((m) => m.status === 'live' || (Date.parse(m.kickoff_at) <= Date.now() && !m.result_confirmed && m.status !== 'cancelled'))} tz={tz} />

      {active.map(renderDay)}
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
            <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-label="Marcadores capturados" aria-valuenow={ready.length} aria-valuemax={editable.length}>
              <div className="h-full rounded-full bg-aqua transition-all" style={{ width: `${Math.round((ready.length / editable.length) * 100)}%` }} />
            </div>
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <div className="scoreline text-xl">{ready.length}<span className="text-muted">/{editable.length}</span></div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{saving ? 'guardando…' : 'marcadores'}</div>
              </div>
              {!complete ? (
                <Button size="lg" block variant="secondary" className="whitespace-nowrap px-4 text-base" icon={<ArrowDown className="size-5" />} onClick={goToMissing}>
                  {missing.length === 1 ? 'Falta 1 marcador' : `Faltan ${missing.length} marcadores`}
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
        footer={<Button block size="lg" loading={busy} disabled={!complete} icon={<Send className="size-5" />} onClick={() => void submit()}>Enviar mis {editable.length} marcadores</Button>}>
        <div className="space-y-3 text-sm">
          <ul className="space-y-1.5">
            {editable.map((m) => {
              const p = picks[m.match_id] ?? empty
              return (
                <li key={m.match_id} className="card-flat flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate">{m.home.short_name}</span>
                  <span className="scoreline shrink-0 text-lg">{p.home}-{p.away}</span>
                  <span className="min-w-0 flex-1 truncate text-right">{m.away.short_name}</span>
                </li>
              )
            })}
          </ul>
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

/** Avance de la quiniela de la semana (los partidos llegan conforme el proveedor los publica). */
function WeekBanner() {
  const w = useQuery({ queryKey: ['pool', 'week'], queryFn: playerApi.week, staleTime: 300_000 })
  if (!w.data) return null
  return (
    <p className="mb-3 text-xs text-muted">
      <span className="font-semibold text-ink">Quiniela de la semana</span> · {w.data.filled} de {w.data.max_matches} partidos
      {w.data.filled < w.data.max_matches ? ' · los demás aparecerán en cuanto se confirmen' : ''}
    </p>
  )
}
