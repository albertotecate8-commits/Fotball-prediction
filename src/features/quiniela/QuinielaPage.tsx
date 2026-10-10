import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, CreditCard, Lock, Save, Send, Ticket } from 'lucide-react'
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
import { useToast } from '@/components/ui/Toast'
import { dayKey, formatDate, formatDateTime } from '@/lib/time'
import { toAppError } from '@/lib/errors'
import { PickCard, type PickValue } from './PickCard'
import type { PoolData, PoolMatch } from '@/types/domain'

type Picks = Record<string, PickValue>
const empty: PickValue = { outcome: null, home: null, away: null }
const same = (a: PickValue, b: PickValue) => a.outcome === b.outcome && a.home === b.home && a.away === b.away
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
  const toast = useToast()
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

  const editable = data.matches.filter((m) => m.open && m.pick?.status !== 'submitted')
  const dirtyIds = editable.filter((m) => !same(picks[m.match_id] ?? empty, serverPicks[m.match_id] ?? empty)).map((m) => m.match_id)
  const dirty = dirtyIds.length > 0
  const ready = editable.filter((m) => picks[m.match_id]?.outcome)
  const missing = editable.length - ready.length
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

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await playerApi.savePool(dirtyIds.map(toItem))
      toast(r.closed ? `Guardado: ${r.saved}. ${r.closed} ya cerraron y no se guardaron.` : `Guardado en el servidor: ${r.saved} ${r.saved === 1 ? 'partido' : 'partidos'}`)
      await refresh()
    } catch (e) { setError(e) } finally { setBusy(false) }
  }

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await playerApi.submitPool(ready.map((m) => toItem(m.match_id)))
      try { localStorage.removeItem(backupKey(uid)) } catch { /* sin almacenamiento */ }
      setConfirmOpen(false)
      toast(`Confirmado por el servidor: ${r.submitted} ${r.submitted === 1 ? 'pronóstico enviado' : 'pronósticos enviados'}${r.closed ? ` · ${r.closed} ya habían cerrado` : ''}`)
      await refresh()
    } catch (e) {
      const err = toAppError(e)
      if (err.code === 'NETWORK') { await refresh() }
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
          <li key={m.match_id}>
            <PickCard match={m} tz={tz} value={picks[m.match_id] ?? empty}
              disabled={!m.open || m.pick?.status === 'submitted'}
              saved={same(picks[m.match_id] ?? empty, serverPicks[m.match_id] ?? empty) && !!serverPicks[m.match_id]?.outcome}
              submitted={m.pick?.status === 'submitted'} maxGoals={data.max_goals}
              onChange={(v) => setPicks((p) => ({ ...p, [m.match_id]: v }))} />
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
            <p className="font-semibold text-gold">Puedes guardar, pero para enviar necesitas tu pago confirmado</p>
            <p className="mt-0.5 text-xs text-muted">Solo los pronósticos enviados suman puntos.</p>
          </div>
          <ButtonLink to="/perfil#pago" size="sm" variant="secondary">Ver cómo pagar</ButtonLink>
        </section>
      )}
      {data.matches.some((m) => m.is_test_data) && <div className="mb-3"><TestDataBadge /></div>}

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
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <div className="scoreline text-xl">{ready.length}<span className="text-muted">/{editable.length}</span></div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">elegidos</div>
              </div>
              {dirty || !canSubmitAny ? (
                <Button size="lg" block className="whitespace-nowrap px-4 text-base" loading={busy} disabled={!dirty} icon={<Save className="size-5" />} onClick={() => void save()}>
                  {dirty ? 'Guardar mi quiniela' : 'Quiniela guardada'}
                </Button>
              ) : (
                <Button size="lg" block className="whitespace-nowrap px-4 text-base" disabled={busy || ready.length === 0} icon={<Send className="size-5" />} onClick={() => setConfirmOpen(true)}>Enviar pronósticos</Button>
              )}
            </div>
          </div>
        </div>
      )}
      {editable.length === 0 && (
        <p className="flex items-center gap-2 text-sm text-muted"><CheckCircle2 className="size-4 text-success" /> No tienes partidos pendientes por enviar.</p>
      )}

      <Sheet open={confirmOpen} onClose={() => !busy && setConfirmOpen(false)} title="¿Enviar tus pronósticos?"
        footer={<Button block size="lg" loading={busy} disabled={ready.length === 0} icon={<Send className="size-5" />} onClick={() => void submit()}>Enviar {ready.length} {ready.length === 1 ? 'pronóstico' : 'pronósticos'}</Button>}>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="card-flat p-3 text-center"><div className="scoreline text-3xl text-aqua">{ready.length}</div><div className="text-xs text-muted">contestados</div></div>
            <div className="card-flat p-3 text-center"><div className={`scoreline text-3xl ${missing ? 'text-red' : 'text-muted'}`}>{missing}</div><div className="text-xs text-muted">sin contestar</div></div>
          </div>
          {missing > 0 && <p className="text-muted">Los partidos sin contestar quedan pendientes: puedes enviarlos después, antes de que empiecen.</p>}
          <p className="flex items-start gap-2 text-muted"><Lock className="mt-0.5 size-4 shrink-0" /> Un pronóstico enviado ya no se puede cambiar.</p>
          <InlineError error={error} />
        </div>
      </Sheet>
    </div>
  )
}
