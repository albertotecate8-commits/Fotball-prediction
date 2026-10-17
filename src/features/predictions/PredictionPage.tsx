import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, CloudOff, Loader2, Lock, Send, Smartphone } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAppConfig } from '@/hooks/useAppConfig'
import { PageHeader } from '@/components/PageHeader'
import { ScoreInput } from '@/components/ScoreInput'
import { TeamCrest } from '@/components/TeamCrest'
import { Countdown } from '@/components/Countdown'
import { TestDataBadge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorState, InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { formatDateTime, formatShortDate, formatTime } from '@/lib/time'
import { toAppError } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { clearLocalDraft, completePairs, readLocalDraft, type Picks } from './draftStore'
import { useDraftAutosave, type SaveState } from './useDraftAutosave'
import { ReviewSheet } from './ReviewSheet'
import { ParticipationNotice } from '@/features/participation/ParticipationNotice'
import type { Participation, RoundDetail } from '@/types/domain'

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  const map: Record<SaveState, { icon: React.ReactNode; text: string; cls: string }> = {
    idle: { icon: <Check className="size-3.5" />, text: 'Sin cambios', cls: 'text-muted' },
    pending: { icon: <Loader2 className="size-3.5" />, text: 'Cambios sin guardar', cls: 'text-muted' },
    saving: { icon: <Loader2 className="size-3.5 animate-spin" />, text: 'Guardando…', cls: 'text-muted' },
    saved: { icon: <Check className="size-3.5" />, text: 'Borrador guardado', cls: 'text-success' },
    error: { icon: <CloudOff className="size-3.5" />, text: 'Error al guardar · reintentando', cls: 'text-danger' },
    locked: { icon: <Lock className="size-3.5" />, text: 'Bloqueada', cls: 'text-muted' },
    local: { icon: <Smartphone className="size-3.5" />, text: 'Guardado solo en este dispositivo', cls: 'text-gold' },
  }
  const m = map[state]
  return <span className={cn('inline-flex items-center gap-1.5 text-xs font-semibold', m.cls)} role="status" aria-live="polite" title={error ?? undefined}>{m.icon}{m.text}</span>
}

export function PredictionPage() {
  const { roundId = '' } = useParams()
  const { session } = useAuth()
  const q = useQuery({ queryKey: qk.round(roundId), queryFn: () => playerApi.roundDetail(roundId), staleTime: 0 })
  const part = useQuery({ queryKey: qk.participation(roundId), queryFn: () => playerApi.participation(roundId), staleTime: 30_000 })

  if (q.isLoading || part.isLoading) return <><PageHeader title="Mi quiniela" back="/quinielas" /><CardSkeleton lines={6} /></>
  if (q.error || part.error) return <><PageHeader title="Mi quiniela" back="/quinielas" /><ErrorState error={q.error ?? part.error} onRetry={() => { void q.refetch(); void part.refetch() }} /></>
  const d = q.data!
  if (d.prediction?.status === 'submitted' || d.round.phase !== 'open') return <Navigate to={`/quinielas/${roundId}`} replace />
  return <PredictionForm key={roundId} detail={d} userId={session!.user.id} participation={part.data!} />
}

function PredictionForm({ detail, userId, participation }: { detail: RoundDetail; userId: string; participation: Participation }) {
  const localOnly = !participation.can_participate
  const { timezone } = useAppConfig()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const roundId = detail.round.id
  const order = useMemo(() => detail.matches.map((m) => m.match_id), [detail.matches])

  const [picks, setPicks] = useState<Picks>(() => {
    const fromServer: Picks = Object.fromEntries(detail.matches.map((m) => [m.match_id, { home: m.pick?.home ?? null, away: m.pick?.away ?? null }]))
    const local = readLocalDraft(roundId, userId)
    // El respaldo local gana solo si es más reciente que lo guardado en el servidor.
    // Un borrador preparado sin participación se recupera solo a petición del jugador.
    if (local && !local.savedToServer && (localOnly || !local.localOnly) && local.seq >= (detail.prediction?.client_seq ?? 0)) {
      return Object.fromEntries(order.map((id) => [id, local.picks[id] ?? fromServer[id]!]))
    }
    return fromServer
  })
  const [reviewOpen, setReviewOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<unknown>(null)
  const [locked, setLocked] = useState(false)

  const onLocked = useCallback(() => {
    setLocked(true)
    void qc.invalidateQueries({ queryKey: qk.round(roundId) })
  }, [qc, roundId])

  const autosave = useDraftAutosave({
    roundId, userId, matchOrder: order, initialSeq: detail.prediction?.client_seq ?? 0, enabled: !locked, localOnly, onLocked,
  })
  const [pendingLocal, setPendingLocal] = useState(() => {
    const local = readLocalDraft(roundId, userId)
    return !localOnly && !!local?.localOnly && completePairs(local.picks, order).length > 0 ? local : null
  })

  // Si había cambios locales sin subir (p. ej. se cerró la app sin red), se suben ahora.
  // Nunca los preparados sin participación (localOnly): esos los recupera el jugador.
  useEffect(() => {
    const local = readLocalDraft(roundId, userId)
    if (!localOnly && local && !local.savedToServer && !local.localOnly) autosave.schedule(picks)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const usePendingLocal = () => {
    if (!pendingLocal) return
    const next = Object.fromEntries(order.map((id) => [id, pendingLocal.picks[id] ?? picks[id]!])) as Picks
    setPicks(next)
    autosave.schedule(next)
    setPendingLocal(null)
  }

  const update = (matchId: string, side: 'home' | 'away', v: number | null) => {
    setPicks((prev) => {
      const next = { ...prev, [matchId]: { ...prev[matchId]!, [side]: v } }
      autosave.schedule(next)
      return next
    })
  }

  const done = completePairs(picks, order).length
  const total = order.length
  const complete = done === total && total > 0

  const openReview = async () => {
    await autosave.flushNow()
    setSubmitError(null)
    setReviewOpen(true)
  }

  const submit = async () => {
    setSubmitting(true)
    setSubmitError(null)
    const items = order.map((id) => ({ match_id: id, home: picks[id]!.home, away: picks[id]!.away }))
    try {
      const r = await playerApi.submit(roundId, items, autosave.currentSeq() + 1)
      clearLocalDraft(roundId, userId)
      toast(r.already_submitted ? 'Tu quiniela ya estaba enviada' : '¡Quiniela enviada!')
      await qc.invalidateQueries()
      navigate(`/quinielas/${roundId}`, { replace: true })
    } catch (e) {
      const err = toAppError(e)
      if (err.code === 'NETWORK') {
        // Puede que el envío sí haya llegado: se consulta el estado real antes de reintentar.
        try {
          const fresh = await playerApi.roundDetail(roundId)
          if (fresh.prediction?.status === 'submitted') {
            clearLocalDraft(roundId, userId)
            await qc.invalidateQueries()
            navigate(`/quinielas/${roundId}`, { replace: true })
            return
          }
        } catch { /* sigue sin conexión */ }
      }
      setSubmitError(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <PageHeader title={detail.round.name} back="/quinielas"
        subtitle={<span className="capitalize">Cierre {formatDateTime(detail.round.deadline_at, timezone)}</span>} />

      <div className="card sticky top-[calc(env(safe-area-inset-top)+0.5rem)] z-30 mb-4 flex items-center justify-between gap-3 p-3 pl-4 glass">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted">Progreso</div>
          <div className="scoreline text-2xl"><span className={complete ? 'text-aqua' : ''}>{done}</span><span className="text-muted"> / {total}</span></div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Countdown target={detail.round.deadline_at} compact className="text-lg" />
          <SaveIndicator state={autosave.state} error={autosave.error} />
        </div>
      </div>

      {localOnly && <ParticipationNotice participation={participation} className="mb-4" />}
      {pendingLocal && (
        <div className="card mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
          <Smartphone className="size-4 text-gold" />
          <span className="flex-1">Tienes un borrador preparado en este dispositivo antes de activar tu participación.</span>
          <Button size="sm" variant="secondary" onClick={usePendingLocal}>Usar ese borrador</Button>
        </div>
      )}

      {locked && (
        <div role="alert" className="mb-4 flex items-center gap-2 rounded-2xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="size-4" /> {autosave.error ?? 'La jornada ya no acepta cambios.'}
        </div>
      )}

      {detail.matches.some((m) => m.is_test_data) && (
        <p className="mb-3 flex items-center gap-2 text-xs text-muted"><TestDataBadge /> Partidos ficticios de demostración.</p>
      )}
      <ol className="space-y-3">
        {detail.matches.map((m, i) => {
          const p = picks[m.match_id]!
          const filled = p.home != null && p.away != null
          return (
            <li key={m.match_id} className={cn('card p-4 transition animate-fade-up', filled && 'border-aqua/25')} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
              <div className="mb-3 flex items-center justify-between text-xs text-muted">
                <span className="font-semibold">Partido {m.position}{m.competition ? ` · ${m.competition.name}` : ''}</span>
                <span className="capitalize">{formatShortDate(m.kickoff_at, timezone)} · {formatTime(m.kickoff_at, timezone)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                  <TeamCrest team={m.home} size={46} />
                  <span className="line-clamp-2 text-sm font-semibold leading-tight">{m.home.short_name}</span>
                </div>
                <ScoreInput label={`Goles de ${m.home.name}`} value={p.home} max={detail.max_goals} disabled={locked} onChange={(v) => update(m.match_id, 'home', v)} />
                <span className="scoreline px-0.5 text-2xl text-muted" aria-hidden>:</span>
                <ScoreInput label={`Goles de ${m.away.name}`} value={p.away} max={detail.max_goals} disabled={locked} onChange={(v) => update(m.match_id, 'away', v)} />
                <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
                  <TeamCrest team={m.away} size={46} />
                  <span className="line-clamp-2 text-sm font-semibold leading-tight">{m.away.short_name}</span>
                </div>
              </div>
            </li>
          )
        })}
      </ol>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line glass px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 lg:left-64">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <p className="hidden flex-1 text-sm text-muted sm:block">
            {localOnly ? 'Modo exploración: esta quiniela no se envía ni suma puntos.' : complete ? 'Todo listo. Revisa antes de enviar: después no podrás cambiarla.' : `Faltan ${total - done} marcadores.`}
          </p>
          {localOnly ? (
            <Button size="lg" variant="secondary" className="flex-1 sm:flex-none" disabled icon={<Lock className="size-5" />}>Participación no activada</Button>
          ) : (
            <Button size="lg" className="flex-1 sm:flex-none" disabled={!complete || locked} icon={<Send className="size-5" />} onClick={() => void openReview()}>
              {complete ? 'Revisar y enviar' : `Completa ${total - done} más`}
            </Button>
          )}
        </div>
      </div>

      <ReviewSheet open={reviewOpen} onClose={() => !submitting && setReviewOpen(false)} detail={detail} picks={picks}
        submitting={submitting} onConfirm={() => void submit()} error={submitError ? <InlineError error={submitError} /> : null} />
    </div>
  )
}
