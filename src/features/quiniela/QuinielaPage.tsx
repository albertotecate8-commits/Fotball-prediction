import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ChevronRight, CreditCard, Lock, Save, Send, Ticket } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from '@/features/groups/GroupProvider'
import { useAppConfig } from '@/hooks/useAppConfig'
import { pickFeaturedRound, useRounds } from '@/features/rounds/useRounds'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { RoundCard } from '@/components/RoundCard'
import { Countdown } from '@/components/Countdown'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState, InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { formatDateTime } from '@/lib/time'
import { toAppError } from '@/lib/errors'
import { nextSeq } from '@/features/predictions/draftStore'
import { PickCard, type PickValue } from './PickCard'
import type { Outcome, Participation, RoundDetail } from '@/types/domain'

type Picks = Record<string, PickValue>
const empty: PickValue = { outcome: null, home: null, away: null }
const same = (a: PickValue, b: PickValue) => a.outcome === b.outcome && a.home === b.home && a.away === b.away
const backupKey = (round: string, user: string) => `shabex.quiniela.${user}.${round}`

export function QuinielaPage() {
  const { roundId } = useParams()
  const { group, loading } = useGroup()
  const { isAdmin } = useAuth()
  const { timezone } = useAppConfig()
  const rounds = useRounds(group?.group_id)
  const published = (rounds.data ?? []).filter((r) => r.phase !== 'draft')
  const current = roundId ? published.find((r) => r.round_id === roundId) ?? null : pickFeaturedRound(published)
  const others = published.filter((r) => r.round_id !== current?.round_id)

  return (
    <div className="pb-24">
      <PageHeader title="Mi quiniela" back={roundId ? '/quinielas' : undefined} />
      {loading || rounds.isLoading ? <CardSkeleton lines={6} /> : rounds.error ? (
        <ErrorState error={rounds.error} onRetry={() => void rounds.refetch()} />
      ) : current ? (
        <RoundForm key={current.round_id} roundId={current.round_id} tz={timezone} />
      ) : (
        <EmptyState icon={<Ticket className="size-6" />} title="Aún no hay jornada publicada"
          description={isAdmin ? 'Publica la jornada desde Administración para que todos puedan llenar su quiniela.' : 'Cuando el administrador publique la jornada, aquí podrás elegir tus resultados.'}
          action={isAdmin ? <ButtonLink to="/admin/jornadas">Ir a Gestionar jornada</ButtonLink> : <ButtonLink to="/" variant="secondary">Ver partidos destacados</ButtonLink>} />
      )}
      {others.length > 0 && (
        <>
          <SectionTitle>Otras jornadas</SectionTitle>
          <div className="space-y-3">{others.map((r) => <RoundCard key={r.round_id} round={r} tz={timezone} hrefOverride={`/quinielas/${r.round_id}`} />)}</div>
        </>
      )}
    </div>
  )
}

function RoundForm({ roundId, tz }: { roundId: string; tz: string }) {
  const detail = useQuery({ queryKey: qk.round(roundId), queryFn: () => playerApi.roundDetail(roundId) })
  const part = useQuery({ queryKey: qk.participation(roundId), queryFn: () => playerApi.participation(roundId) })
  if (detail.isLoading || part.isLoading) return <CardSkeleton lines={6} />
  if (detail.error || part.error) return <ErrorState error={detail.error ?? part.error} onRetry={() => { void detail.refetch(); void part.refetch() }} />
  return <Form detail={detail.data!} participation={part.data!} tz={tz} />
}

function Form({ detail, participation, tz }: { detail: RoundDetail; participation: Participation; tz: string }) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const uid = session!.user.id
  const round = detail.round
  const order = useMemo(() => detail.matches.map((m) => m.match_id), [detail.matches])
  const submitted = detail.prediction?.status === 'submitted'
  const accepting = round.phase === 'open' && !submitted
  const canSubmit = participation.can_participate

  // Lo guardado en el servidor manda; el respaldo local solo conserva cambios sin guardar.
  const serverPicks = useMemo<Picks>(() => Object.fromEntries(detail.matches.map((m) => [m.match_id,
    m.pick ? { outcome: m.pick.outcome, home: m.pick.home, away: m.pick.away } : empty])), [detail.matches])
  const [picks, setPicks] = useState<Picks>(() => {
    if (!accepting) return serverPicks
    try {
      const raw = localStorage.getItem(backupKey(round.id, uid))
      const local = raw ? (JSON.parse(raw) as { picks: Picks; base: string }) : null
      if (local && local.base === (detail.prediction?.updated_at ?? '')) return { ...serverPicks, ...local.picks }
    } catch { /* sin almacenamiento */ }
    return serverPicks
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(detail.prediction?.status === 'draft' ? detail.prediction.updated_at : null)

  const dirty = order.some((id) => !same(picks[id] ?? empty, serverPicks[id] ?? empty))
  const answered = order.filter((id) => picks[id]?.outcome).length
  const missing = order.length - answered

  useEffect(() => {
    if (!accepting) return
    try {
      if (dirty) localStorage.setItem(backupKey(round.id, uid), JSON.stringify({ picks, base: detail.prediction?.updated_at ?? '' }))
      else localStorage.removeItem(backupKey(round.id, uid))
    } catch { /* sin almacenamiento */ }
  }, [picks, dirty, accepting, round.id, uid, detail.prediction?.updated_at])

  const items = () => order.map((id) => {
    const p = picks[id] ?? empty
    const score = p.home !== null && p.away !== null
    return { match_id: id, outcome: p.outcome, home: score ? p.home : null, away: score ? p.away : null }
  })

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const r = await playerApi.saveQuiniela(round.id, items(), nextSeq(detail.prediction?.client_seq ?? 0))
      setSavedAt(r.saved_at)
      toast(`Guardado en el servidor: ${r.picks} de ${r.total} partidos`)
      await qc.invalidateQueries({ queryKey: qk.round(round.id) })
      await qc.invalidateQueries({ queryKey: ['rounds'] })
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  const submit = async () => {
    setSaving(true)
    setError(null)
    try {
      const r = await playerApi.submitQuiniela(round.id, items(), nextSeq(detail.prediction?.client_seq ?? 0))
      try { localStorage.removeItem(backupKey(round.id, uid)) } catch { /* sin almacenamiento */ }
      setConfirmOpen(false)
      toast(r.already_submitted ? 'Tu quiniela ya estaba enviada' : 'Quiniela enviada y confirmada por el servidor')
      await qc.invalidateQueries()
    } catch (e) {
      const err = toAppError(e)
      // Si la red falló, se consulta el estado real antes de dar un error.
      if (err.code === 'NETWORK') {
        const fresh = await playerApi.roundDetail(round.id).catch(() => null)
        if (fresh?.prediction?.status === 'submitted') { setConfirmOpen(false); await qc.invalidateQueries(); return }
      }
      setError(err)
    } finally {
      setSaving(false)
    }
  }

  const setPick = (id: string, v: PickValue) => setPicks((prev) => ({ ...prev, [id]: v }))

  return (
    <div>
      <section className="card mb-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="display truncate text-2xl font-semibold uppercase leading-none">{round.name}</h2>
            <p className="mt-1.5 text-xs text-muted">Cierre: <span className="capitalize text-ink">{formatDateTime(round.deadline_at, tz)}</span> · hora del centro de México</p>
          </div>
          <StatusChip submitted={submitted} phase={round.phase} />
        </div>
        {round.phase === 'open' && !submitted && (
          <p className="mt-3 flex items-center gap-2 text-xs text-muted">Cierra en <Countdown compact className="text-base text-ink" target={round.deadline_at} /></p>
        )}
        {submitted && detail.prediction?.submitted_at && (
          <p className="mt-3 flex items-center gap-2 text-sm text-success"><CheckCircle2 className="size-4" /> Enviada el <span className="capitalize">{formatDateTime(detail.prediction.submitted_at, tz)}</span>. Ya no se puede cambiar.</p>
        )}
        {!submitted && savedAt && !dirty && accepting && (
          <p className="mt-3 flex items-center gap-2 text-xs text-aqua"><Save className="size-3.5" /> Borrador guardado en el servidor · {formatDateTime(savedAt, tz)}</p>
        )}
      </section>

      {accepting && !canSubmit && (
        <section className="mb-4 flex items-start gap-3 rounded-2xl border border-gold/35 bg-gold/10 p-3 text-sm">
          <CreditCard className="mt-0.5 size-5 shrink-0 text-gold" />
          <div className="flex-1">
            <p className="font-semibold text-gold">Puedes guardar, pero para enviar necesitas tu pago confirmado</p>
            <p className="mt-0.5 text-xs text-muted">Tus pronósticos guardados no cuentan hasta que se envían.</p>
          </div>
          <ButtonLink to="/perfil#pago" size="sm" variant="secondary">Ver cómo pagar</ButtonLink>
        </section>
      )}

      <ol className="space-y-3">
        {detail.matches.map((m) => (
          <li key={m.match_id}>
            <PickCard match={m} tz={tz} value={picks[m.match_id] ?? empty} disabled={!accepting}
              saved={same(picks[m.match_id] ?? empty, serverPicks[m.match_id] ?? empty) && !!serverPicks[m.match_id]?.outcome}
              submitted={submitted} maxGoals={detail.max_goals}
              onChange={(v) => setPick(m.match_id, v)} />
          </li>
        ))}
      </ol>

      {accepting && (
        <div className="glass fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4rem)] z-30 border-t border-line px-4 py-3 lg:bottom-0 lg:left-64">
          <div className="mx-auto max-w-3xl">
            <InlineError error={error} />
            <div className="flex items-center gap-3">
              <div className="shrink-0">
                <div className="scoreline text-xl">{answered}<span className="text-muted">/{order.length}</span></div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">elegidos</div>
              </div>
              {dirty || !canSubmit ? (
                <Button size="lg" block className="whitespace-nowrap px-4 text-base" loading={saving} disabled={!dirty} icon={<Save className="size-5" />} onClick={() => void save()}>
                  {dirty ? 'Guardar mi quiniela' : 'Quiniela guardada'}
                </Button>
              ) : (
                <Button size="lg" block className="whitespace-nowrap px-4 text-base" disabled={saving || answered === 0} icon={<Send className="size-5" />} onClick={() => setConfirmOpen(true)}>Enviar pronósticos</Button>
              )}
            </div>
          </div>
        </div>
      )}

      <Sheet open={confirmOpen} onClose={() => !saving && setConfirmOpen(false)} title="¿Enviar tu quiniela?"
        footer={missing > 0
          ? <Button block size="lg" variant="secondary" onClick={() => setConfirmOpen(false)}>Te faltan {missing}: completar</Button>
          : <Button block size="lg" loading={saving} icon={<Send className="size-5" />} onClick={() => void submit()}>Sí, enviar definitivamente</Button>}>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <div className="card-flat p-3 text-center"><div className="scoreline text-3xl text-aqua">{answered}</div><div className="text-xs text-muted">contestados</div></div>
            <div className="card-flat p-3 text-center"><div className={`scoreline text-3xl ${missing ? 'text-red' : 'text-muted'}`}>{missing}</div><div className="text-xs text-muted">faltan</div></div>
          </div>
          <p className="flex items-start gap-2 text-muted"><Lock className="mt-0.5 size-4 shrink-0" /> Después de enviar ya no podrás cambiar tus pronósticos.</p>
          <InlineError error={error} />
        </div>
      </Sheet>
    </div>
  )
}

function StatusChip({ submitted, phase }: { submitted: boolean; phase: string }) {
  const [label, cls] = submitted ? ['Enviada', 'border-success/40 text-success']
    : phase === 'open' ? ['Abierta', 'border-aqua/40 text-aqua']
    : phase === 'upcoming' ? ['Próxima', 'border-gold/40 text-gold']
    : ['Cerrada', 'border-line-strong text-muted']
  return <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>
}

export const QuinielaLink = () => <Link to="/quinielas" className="inline-flex items-center gap-1 text-sm font-semibold text-aqua">Mi quiniela <ChevronRight className="size-4" /></Link>
export type { Outcome }
