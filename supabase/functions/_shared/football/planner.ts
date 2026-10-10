// Planificador de consultas a API-Football para el plan gratuito.
// Decide QUÉ consultar en cada pasada del cron según prioridad y saldo:
//   1. En vivo (una sola solicitud para todos los partidos en juego).
//   2. Próximos a empezar y finales sin marcador confirmado.
//   3. Calendario de hoy y mañana (alimenta la importación automática).
//   4. Auxiliares (destacados de Inicio en juego que no están en la quiniela).
// Un partido finalizado y confirmado ya no genera consultas.
// Es puro (sin red ni base de datos) para poder probarlo.
import type { NormalizedFixture } from './types.ts'

export interface TrackedMatch {
  match_id: string
  external_id: string
  kickoff_at: string
  status: string
  home_goals: number | null
  away_goals: number | null
  elapsed?: number | null
  status_detail?: string | null
  result_confirmed: boolean
}

export interface PlanInput {
  now: number
  /** Saldo utilizable hoy: mínimo entre el presupuesto interno y lo estimado del proveedor menos el margen. */
  effective: number
  paused: boolean
  tracked: TrackedMatch[]
  /** Destacados de Inicio en juego (no forman parte de la quiniela). */
  featuredLive: number
  lastLiveAt: number | null
  /** Última descarga de cada día en caché (YYYY-MM-DD UTC → ms). */
  dayFetchedAt: Record<string, number | null | undefined>
  liveRestricted: boolean
  /** Días consultables respecto a hoy (UTC); el plan gratuito permite de ayer a mañana. */
  dateWindow?: [number, number]
}

export type PlanAction =
  | { kind: 'live'; priority: 1 | 4; reason: string }
  | { kind: 'day'; date: string; priority: 1 | 2 | 3 | 4; reason: string }

export interface Plan {
  actions: PlanAction[]
  liveIntervalMin: number | null
  liveMinutesLeft: number
}

const MIN = 60e3
const DAY = 86400e3
/** Saldo mínimo para cada prioridad (igual que en la base de datos). */
export const PRIORITY_FLOOR: Record<number, number> = { 1: 0, 2: 5, 3: 15, 4: 20, 5: 30 }
/** Consultas que se apartan del saldo para lo que no es en vivo (calendario y finales). */
const NON_LIVE_RESERVE = 4
export const LIVE_INTERVAL = { min: 4, max: 20 }
const MATCH_MINUTES = 120
const MAX_DAY_ACTIONS = 3

export const utcDate = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const startOfUtcDay = (ms: number) => Date.parse(`${utcDate(ms)}T00:00:00Z`)

const ACTIVE = new Set(['scheduled', 'live', 'suspended', 'unknown'])

/** Debería estar en juego: en vivo según el proveedor, o ya pasó su hora de inicio. */
export function inPlay(m: TrackedMatch, now: number) {
  if (m.status === 'live' || m.status === 'suspended') return true
  const k = Date.parse(m.kickoff_at)
  return (m.status === 'scheduled' || m.status === 'unknown') && k <= now && now <= k + 3 * 60 * MIN
}

/** Minutos de juego previstos que quedan HOY (día UTC, que es cuando reinicia la cuota). */
export function liveMinutesLeftToday(tracked: TrackedMatch[], now: number) {
  const end = startOfUtcDay(now) + DAY
  const spans = tracked
    .filter((m) => ACTIVE.has(m.status))
    .map((m) => {
      const k = Date.parse(m.kickoff_at)
      const until = m.status === 'live' || m.status === 'suspended' ? Math.max(k + MATCH_MINUTES * MIN, now + 30 * MIN) : k + MATCH_MINUTES * MIN
      return [Math.max(now, k), Math.min(until, end)] as const
    })
    .filter(([a, b]) => b > a)
    .sort((x, y) => x[0] - y[0])
  let total = 0
  let curA = -1
  let curB = -1
  for (const [a, b] of spans) {
    if (a > curB) {
      if (curB > curA) total += curB - curA
      curA = a
      curB = b
    } else curB = Math.max(curB, b)
  }
  if (curB > curA) total += curB - curA
  return Math.round(total / MIN)
}

/**
 * Intervalo entre consultas en vivo: reparte el saldo entre los minutos de
 * juego que quedan hoy, entre 4 y 20 minutos. El saldo manda sobre la frecuencia.
 */
export function liveInterval(effective: number, minutesLeft: number) {
  const budget = effective - NON_LIVE_RESERVE
  if (budget <= 0) return LIVE_INTERVAL.max
  return Math.min(LIVE_INTERVAL.max, Math.max(LIVE_INTERVAL.min, Math.ceil(minutesLeft / budget)))
}

export function planTick(input: PlanInput): Plan {
  const { now, effective } = input
  const minutesLeft = liveMinutesLeftToday(input.tracked, now)
  if (input.paused || effective <= 0) return { actions: [], liveIntervalMin: null, liveMinutesLeft: minutesLeft }

  const window = input.dateWindow ?? [-1, 1]
  const today = startOfUtcDay(now)
  const consultable = (date: string) => {
    const o = Math.round((Date.parse(`${date}T00:00:00Z`) - today) / DAY)
    return o >= window[0] && o <= window[1]
  }
  const age = (date: string) => {
    const t = input.dayFetchedAt[date]
    return t ? (now - t) / MIN : Infinity
  }
  const allowed = (p: number) => effective > PRIORITY_FLOOR[p]!
  const actions: PlanAction[] = []
  const dayWants = new Map<string, { priority: 1 | 2 | 3 | 4; reason: string }>()
  const wantDay = (date: string, priority: 1 | 2 | 3 | 4, maxAgeMin: number, reason: string) => {
    if (!consultable(date) || !allowed(priority) || age(date) < maxAgeMin) return
    const prev = dayWants.get(date)
    if (!prev || priority < prev.priority) dayWants.set(date, { priority, reason })
  }

  const open = input.tracked.filter((m) => !(m.status === 'finished' && m.result_confirmed))
  const playing = open.filter((m) => inPlay(m, now))
  const interval = liveInterval(effective, minutesLeft)

  // 1. En vivo
  const sinceLive = input.lastLiveAt ? (now - input.lastLiveAt) / MIN : Infinity
  if (playing.length) {
    if (sinceLive >= interval - 1) {
      if (input.liveRestricted) {
        for (const d of new Set(playing.map((m) => utcDate(Date.parse(m.kickoff_at))))) wantDay(d, 1, interval - 1, 'en vivo (por día)')
      } else actions.push({ kind: 'live', priority: 1, reason: `${playing.length} en juego · cada ${interval} min` })
    }
  } else if (input.featuredLive > 0 && !input.liveRestricted && allowed(4) && sinceLive >= Math.max(20, interval) - 1) {
    actions.push({ kind: 'live', priority: 4, reason: 'destacados de Inicio en juego' })
  }

  // 2. Finales sin confirmar, partidos que no arrancan y próximos inicios
  const scarce = effective < 25
  for (const m of open) {
    const k = Date.parse(m.kickoff_at)
    const d = utcDate(k)
    if (m.status === 'finished') wantDay(d, 2, 20, 'final sin marcador confirmado')
    else if ((m.status === 'scheduled' || m.status === 'unknown') && k + 3 * 60 * MIN < now) wantDay(d, 2, 120, 'debió terminar: revisar estado')
    else if ((m.status === 'scheduled' || m.status === 'unknown') && k + 20 * MIN < now && k <= now) wantDay(d, 2, 30, 'no ha empezado: posible aplazamiento')
    else if (m.status === 'scheduled' && k > now && k <= now + 3 * 60 * MIN) {
      const base = k <= now + 60 * MIN ? 45 : 90
      wantDay(d, 2, scarce ? base * 2 : base, 'inicio próximo: horario y estado')
    }
  }

  // 3. Calendario (importación automática y destacados)
  const calendarAge = effective < 30 ? 720 : 360
  wantDay(utcDate(now), 3, calendarAge, 'calendario de hoy')
  wantDay(utcDate(now + DAY), 3, calendarAge, 'calendario de mañana')

  const days = [...dayWants.entries()].sort((a, b) => a[1].priority - b[1].priority).slice(0, MAX_DAY_ACTIONS)
  for (const [date, w] of days) actions.push({ kind: 'day', date, priority: w.priority, reason: w.reason })
  return { actions: actions.sort((a, b) => a.priority - b.priority), liveIntervalMin: playing.length ? interval : null, liveMinutesLeft: minutesLeft }
}

/**
 * Tras la consulta en vivo: los partidos que estaban en juego y ya no aparecen
 * probablemente terminaron. Su día se consulta (prioridad 1) para obtener el
 * marcador final, como mucho cada 4 minutos.
 */
export function afterLive(tracked: TrackedMatch[], liveIds: Set<string>, dayFetchedAt: PlanInput['dayFetchedAt'], now: number): PlanAction[] {
  const dates = new Set<string>()
  for (const m of tracked) {
    if ((m.status === 'live' || m.status === 'suspended') && !liveIds.has(m.external_id)) dates.add(utcDate(Date.parse(m.kickoff_at)))
  }
  return [...dates]
    .filter((d) => { const t = dayFetchedAt[d]; return !t || now - t >= 4 * MIN })
    .map((date) => ({ kind: 'day' as const, date, priority: 1 as const, reason: 'terminó: marcador final' }))
}

export interface MatchUpdate { match_id: string; fixture: NormalizedFixture }

/**
 * Qué partidos guardados cambian con una respuesta del proveedor. Una sola
 * respuesta actualiza a TODOS los partidos de ese día (sin consultas extra).
 * Un final confirmado nunca retrocede a «en juego» o «programado».
 */
export function diffUpdates(tracked: TrackedMatch[], fixtures: NormalizedFixture[]) {
  const byExt = new Map(tracked.map((m) => [m.external_id, m]))
  const updates: MatchUpdate[] = []
  const anomalies: string[] = []
  for (const f of fixtures) {
    const m = byExt.get(f.external_id)
    if (!m) continue
    if (m.result_confirmed && m.status === 'finished' && (f.status === 'scheduled' || f.status === 'live')) {
      anomalies.push(`${f.external_id}: el proveedor lo reporta «${f.status}» tras su final confirmado (se conserva el final)`)
      continue
    }
    const same = m.status === f.status && m.home_goals === f.home_goals && m.away_goals === f.away_goals
      && Date.parse(m.kickoff_at) === Date.parse(f.kickoff_at) && (m.elapsed ?? null) === (f.elapsed ?? null)
      && (m.status_detail ?? null) === (f.status_detail ?? null)
    if (!same) updates.push({ match_id: m.match_id, fixture: f })
  }
  return { updates, anomalies }
}
