import { useCallback, useEffect, useRef, useState } from 'react'
import { playerApi } from '@/services/player'
import { toAppError } from '@/lib/errors'
import { nextSeq, writeLocalDraft, type Picks } from './draftStore'

export type SaveState = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'locked' | 'local'

interface Options {
  roundId: string
  userId: string
  matchOrder: string[]
  initialSeq: number
  enabled: boolean
  /** Sin participación activa: solo se guarda en este dispositivo. */
  localOnly?: boolean
  debounceMs?: number
  onLocked?: () => void
}

/**
 * Guardado automático con:
 *  - debounce para no saturar el servidor,
 *  - una sola solicitud en vuelo (la siguiente lleva el estado más reciente),
 *  - secuencia monotónica: el servidor ignora guardados que llegan tarde,
 *  - reintentos con espera creciente y respaldo en localStorage.
 */
export function useDraftAutosave({ roundId, userId, matchOrder, initialSeq, enabled, localOnly = false, debounceMs = 700, onLocked }: Options) {
  const [state, setState] = useState<SaveState>('idle')
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(initialSeq)
  const latest = useRef<Picks | null>(null)
  const inFlight = useRef(false)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retries = useRef(0)
  const order = useRef(matchOrder)
  order.current = matchOrder

  const flush = useCallback(async () => {
    if (!enabled || localOnly || inFlight.current || !dirty.current || !latest.current) return
    inFlight.current = true
    dirty.current = false
    const picks = latest.current
    const mySeq = nextSeq(seq.current)
    seq.current = mySeq
    setState('saving')
    const items = order.current.map((id) => {
      const p = picks[id]
      const complete = p?.home != null && p?.away != null
      return { match_id: id, home: complete ? p!.home : null, away: complete ? p!.away : null }
    })
    try {
      const r = await playerApi.saveDraft(roundId, items, mySeq)
      retries.current = 0
      if (r.status === 'submitted') {
        setState('locked')
        onLocked?.()
        return
      }
      if (r.client_seq > seq.current) seq.current = r.client_seq
      writeLocalDraft(roundId, userId, { seq: mySeq, picks, savedToServer: !dirty.current })
      setLastSavedAt(new Date())
      setError(null)
      setState(dirty.current ? 'pending' : 'saved')
    } catch (e) {
      const err = toAppError(e)
      if (['DEADLINE_PASSED', 'ROUND_CLOSED', 'PREDICTION_LOCKED'].includes(err.code)) {
        setState('locked')
        setError(err.message)
        onLocked?.()
        return
      }
      dirty.current = true // reintentar con el estado más reciente
      setError(err.message)
      setState('error')
      retries.current += 1
      const wait = Math.min(30_000, 1000 * 2 ** Math.min(retries.current, 5))
      timer.current = setTimeout(() => void flush(), wait)
    } finally {
      inFlight.current = false
      if (dirty.current && retries.current === 0) void flush()
    }
  }, [enabled, localOnly, roundId, userId, onLocked])

  const schedule = useCallback((picks: Picks) => {
    latest.current = picks
    if (localOnly) {
      writeLocalDraft(roundId, userId, { seq: seq.current, picks, savedToServer: false, localOnly: true })
      setState('local')
      return
    }
    dirty.current = true
    writeLocalDraft(roundId, userId, { seq: seq.current, picks, savedToServer: false })
    setState('pending')
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => { retries.current = 0; void flush() }, debounceMs)
  }, [debounceMs, flush, localOnly, roundId, userId])

  // Reintento inmediato al recuperar la conexión.
  useEffect(() => {
    const online = () => { if (dirty.current) { retries.current = 0; void flush() } }
    window.addEventListener('online', online)
    return () => window.removeEventListener('online', online)
  }, [flush])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  /** Espera a que no quede nada pendiente (antes de abrir la revisión). */
  const flushNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    retries.current = 0
    await flush()
  }, [flush])

  return { state, lastSavedAt, error, schedule, flushNow, currentSeq: () => seq.current }
}
