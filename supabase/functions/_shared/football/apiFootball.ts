// Adaptador para API-Football v3 (api-sports.io).
// Documentación: https://www.api-football.com/documentation-v3
// Plan gratuito: 100 solicitudes/día (reinicio 00:00 UTC) y límite por minuto.
import {
  ProviderError, type FixtureSearch, type FootballProvider, type MatchStatus, type NormalizedCompetition,
  type NormalizedFixture, type ProviderErrorCode, type ProviderStatus, type RequestGate,
} from './types.ts'

const BASE_URL = 'https://v3.football.api-sports.io'
const MAX_IDS_PER_REQUEST = 20
/** Días máximos por búsqueda cuando el plan obliga a consultar día por día. */
export const MAX_DAYS_BY_DATE = 8
const DAY = 86400e3

const daysBetween = (from: string, to: string) => {
  const out: string[] = []
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10))
  return out
}

/** Códigos cortos de API-Football → estado interno. */
export function mapApiFootballStatus(short: string | null | undefined): MatchStatus {
  switch ((short ?? '').toUpperCase()) {
    case 'TBD':
    case 'NS':
      return 'scheduled'
    case '1H':
    case 'HT':
    case '2H':
    case 'ET':
    case 'BT':
    case 'P':
    case 'LIVE':
      return 'live'
    case 'FT':
    case 'AET':
    case 'PEN':
      return 'finished'
    case 'PST':
      return 'postponed'
    case 'SUSP':
    case 'INT':
      return 'suspended'
    case 'CANC':
      return 'cancelled'
    case 'ABD':
      return 'abandoned'
    // AWD (resultado administrativo) y WO (walkover) requieren revisión manual.
    default:
      return 'unknown'
  }
}

interface ApiFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null } }
  league: { id: number; name: string; country: string | null; season: number; logo: string | null }
  teams: {
    home: { id: number; name: string; logo: string | null }
    away: { id: number; name: string; logo: string | null }
  }
  goals: { home: number | null; away: number | null }
  score: { fulltime: { home: number | null; away: number | null } }
}

interface ApiResponse<T> {
  errors: unknown
  results: number
  response: T
}

const shortName = (name: string) => name.replace(/^(Club|CF|FC|CD|Club de Fútbol)\s+/i, '').trim()

export function normalizeApiFootballFixture(f: ApiFixture): NormalizedFixture {
  const status = mapApiFootballStatus(f.fixture.status.short)
  let home: number | null = null
  let away: number | null = null
  if (status === 'finished') {
    // Tiempo extra o penales: cuenta el marcador de los 90 minutos.
    home = f.score?.fulltime?.home ?? f.goals.home
    away = f.score?.fulltime?.away ?? f.goals.away
  } else if (status === 'live' || status === 'suspended' || status === 'abandoned') {
    home = f.goals.home
    away = f.goals.away
  }
  return {
    external_id: String(f.fixture.id),
    kickoff_at: new Date(f.fixture.date).toISOString(),
    status,
    status_detail: f.fixture.status.short ?? null,
    elapsed: f.fixture.status.elapsed ?? null,
    home_goals: home,
    away_goals: away,
    competition: {
      external_id: String(f.league.id),
      name: f.league.name,
      country: f.league.country,
      season: String(f.league.season),
      logo_url: f.league.logo,
    },
    home: { external_id: String(f.teams.home.id), name: f.teams.home.name, short_name: shortName(f.teams.home.name), logo_url: f.teams.home.logo },
    away: { external_id: String(f.teams.away.id), name: f.teams.away.name, short_name: shortName(f.teams.away.name), logo_url: f.teams.away.logo },
    raw: { fixture: f.fixture, goals: f.goals, score: f.score },
  }
}

const hasErrors = (errors: unknown) =>
  Array.isArray(errors) ? errors.length > 0 : !!errors && typeof errors === 'object' && Object.keys(errors).length > 0

/** Clasifica el objeto `errors` que API-Football devuelve con HTTP 200. */
export function classifyApiFootballErrors(errors: unknown): { code: ProviderErrorCode; retryable: boolean; message: string } {
  const entries = Array.isArray(errors) ? errors.map((e, i) => [String(i), String(e)]) : Object.entries(errors as Record<string, unknown>).map(([k, v]) => [k, String(v)])
  const keys = entries.map(([k]) => (k ?? '').toLowerCase())
  const message = entries.map(([k, v]) => `${k}: ${v}`).join('; ')
  if (keys.includes('token') || /application key|api key|token/i.test(message)) return { code: 'INVALID_KEY', retryable: false, message }
  if (keys.includes('plan') || /plan/i.test(message)) return { code: 'PLAN_RESTRICTED', retryable: false, message }
  if (keys.includes('requests') || /for the day|daily/i.test(message)) return { code: 'QUOTA_EXHAUSTED', retryable: false, message }
  if (keys.includes('ratelimit') || /too many|rate/i.test(message)) return { code: 'RATE_LIMITED', retryable: true, message }
  return { code: 'BAD_REQUEST', retryable: false, message }
}

const headerNumber = (h: Headers, name: string) => {
  const v = h.get(name)
  if (v === null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export interface ApiFootballOptions {
  apiKey: string
  fetchImpl?: typeof fetch
  retries?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Control de cuota compartido. Sin él no hay límite propio (solo pruebas). */
  gate?: RequestGate
}

export class ApiFootballProvider implements FootballProvider {
  readonly id = 'api-football'
  readonly isTestData = false
  private readonly fetchImpl: typeof fetch
  private readonly retries: number
  private readonly timeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>
  /** Solicitudes HTTP realmente enviadas por esta instancia. */
  requestsMade = 0

  constructor(private readonly opts: ApiFootballOptions) {
    if (!opts.apiKey) throw new ProviderError('API_FOOTBALL_KEY no configurada', false, undefined, 'NOT_CONFIGURED')
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.retries = opts.retries ?? 2
    this.timeoutMs = opts.timeoutMs ?? 10_000
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  private async request<T>(path: string, params: Record<string, string | undefined>, countsQuota = true): Promise<T> {
    const url = new URL(BASE_URL + path)
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v)

    let lastError: ProviderError | null = null
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) {
        // Espera progresiva; más larga si el proveedor pidió frenar.
        const base = lastError?.code === 'RATE_LIMITED' ? 6000 : 500
        await this.sleep(base * 2 ** (attempt - 1))
      }
      if (countsQuota && this.opts.gate) {
        const g = await this.opts.gate.take()
        if (!g.allowed) throw new ProviderError(`Cuota protegida (${g.reason ?? 'sin cupo'}): se reintentará en el siguiente periodo`, false, undefined, 'QUOTA_EXHAUSTED')
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        this.requestsMade++
        const res = await this.fetchImpl(url.toString(), {
          headers: { 'x-apisports-key': this.opts.apiKey },
          signal: controller.signal,
        })
        const remainingDaily = headerNumber(res.headers, 'x-ratelimit-requests-remaining')
        const limitDaily = headerNumber(res.headers, 'x-ratelimit-requests-limit')
        if (this.opts.gate && (remainingDaily !== null || limitDaily !== null)) {
          await this.opts.gate.report({ remainingDaily, limitDaily })
        }
        if (res.status === 429) {
          lastError = new ProviderError('API-Football: demasiadas solicitudes (HTTP 429)', true, 429, 'RATE_LIMITED')
          continue
        }
        if (res.status >= 500) {
          lastError = new ProviderError(`API-Football HTTP ${res.status}`, true, res.status, 'UNAVAILABLE')
          continue
        }
        if (res.status === 401 || res.status === 403) throw new ProviderError(`API-Football rechazó la clave (HTTP ${res.status})`, false, res.status, 'INVALID_KEY')
        if (!res.ok) throw new ProviderError(`API-Football HTTP ${res.status}`, false, res.status, 'BAD_REQUEST')

        const body = (await res.json()) as ApiResponse<T>
        if (hasErrors(body.errors)) {
          const c = classifyApiFootballErrors(body.errors)
          lastError = new ProviderError(`API-Football: ${c.message}`, c.retryable, res.status, c.code)
          if (this.opts.gate) await this.opts.gate.report({ remainingDaily, limitDaily, error: lastError.message })
          if (!c.retryable) throw lastError
          continue
        }
        return body.response
      } catch (e) {
        if (e instanceof ProviderError && !e.retryable) throw e
        lastError = e instanceof ProviderError ? e : new ProviderError(`API-Football no disponible: ${(e as Error).message}`, true, undefined, 'UNAVAILABLE')
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? new ProviderError('API-Football no disponible', true, undefined, 'UNAVAILABLE')
  }

  /**
   * El plan gratuito solo permite consultar por temporada las de años
   * anteriores, pero sí permite consultar por fecha. Cuando la temporada está
   * restringida se recurre a una consulta por día (todas las ligas) y se filtra.
   */
  seasonRestricted = false

  private statusParam(q: FixtureSearch) {
    return q.status === 'scheduled' ? 'NS-TBD' : q.status === 'live' ? '1H-HT-2H-ET-BT-P-LIVE' : q.status === 'finished' ? 'FT-AET-PEN' : undefined
  }

  private async byDays(days: string[], status?: string): Promise<NormalizedFixture[]> {
    if (days.length > MAX_DAYS_BY_DATE) {
      throw new ProviderError(`Con el plan gratuito busca como máximo ${MAX_DAYS_BY_DATE} días por competición`, false, undefined, 'BAD_REQUEST')
    }
    const out: NormalizedFixture[] = []
    for (const date of days) {
      const rows = await this.request<ApiFixture[]>('/fixtures', { date, status, timezone: 'UTC' })
      out.push(...(rows ?? []).map(normalizeApiFootballFixture))
    }
    return out
  }

  async searchFixtures(q: FixtureSearch): Promise<NormalizedFixture[]> {
    const status = this.statusParam(q)
    let fixtures: NormalizedFixture[]
    if (q.competitionId) {
      if (!q.from) throw new ProviderError('Indica la fecha inicial', false, undefined, 'BAD_REQUEST')
      const to = q.to ?? q.from
      const viaDays = async () => (await this.byDays(daysBetween(q.from!, to), status)).filter((f) => f.competition?.external_id === q.competitionId)
      if (this.seasonRestricted || !q.season) {
        fixtures = await viaDays()
      } else {
        try {
          // Una sola solicitud para todo el rango de fechas de la competición.
          const rows = await this.request<ApiFixture[]>('/fixtures', { league: q.competitionId, season: q.season, from: q.from, to, status, timezone: 'UTC' })
          fixtures = (rows ?? []).map(normalizeApiFootballFixture)
        } catch (e) {
          if (!(e instanceof ProviderError) || e.code !== 'PLAN_RESTRICTED') throw e
          this.seasonRestricted = true
          fixtures = await viaDays()
        }
      }
    } else if (q.from && (!q.to || q.to === q.from)) {
      // Sin competición: un solo día (todas las ligas en una solicitud).
      fixtures = await this.byDays([q.from], status)
    } else {
      throw new ProviderError('Elige una competición o busca un solo día', false, undefined, 'BAD_REQUEST')
    }
    const team = q.team?.trim().toLowerCase()
    return fixtures.filter((f) => !team || f.home.name.toLowerCase().includes(team) || f.away.name.toLowerCase().includes(team))
  }

  async getFixturesByIds(ids: string[], hint?: { dates?: string[] }): Promise<NormalizedFixture[]> {
    const out: NormalizedFixture[] = []
    try {
      for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
        const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST)
        const rows = await this.request<ApiFixture[]>('/fixtures', { ids: chunk.join('-'), timezone: 'UTC' })
        out.push(...(rows ?? []).map(normalizeApiFootballFixture))
      }
      return out
    } catch (e) {
      // Plan sin acceso por id: consultar los días de los partidos pendientes.
      if (!(e instanceof ProviderError) || e.code !== 'PLAN_RESTRICTED' || !hint?.dates?.length) throw e
      const wanted = new Set(ids)
      const days = [...new Set(hint.dates)].sort().slice(0, MAX_DAYS_BY_DATE)
      return (await this.byDays(days)).filter((f) => wanted.has(f.external_id))
    }
  }

  async listCompetitions(): Promise<NormalizedCompetition[]> {
    const rows = await this.request<{ league: { id: number; name: string; logo: string }; country: { name: string }; seasons: { year: number; current: boolean }[] }[]>(
      '/leagues', { current: 'true' },
    )
    return (rows ?? []).map((r) => ({
      external_id: String(r.league.id),
      name: r.league.name,
      country: r.country?.name ?? null,
      season: String(r.seasons?.find((s) => s.current)?.year ?? ''),
      logo_url: r.league.logo,
    }))
  }

  /** /status no consume la cuota diaria según la documentación del proveedor. */
  async status(): Promise<ProviderStatus> {
    try {
      const r = await this.request<{ subscription?: { plan?: string; active?: boolean }; requests?: { current?: number; limit_day?: number } } | []>('/status', {}, false)
      const s = Array.isArray(r) ? {} : r
      return {
        provider: this.id, is_test_data: false, ok: true,
        plan: s.subscription?.plan ?? null, active: s.subscription?.active ?? null,
        requests_today: s.requests?.current ?? null, requests_limit: s.requests?.limit_day ?? null,
      }
    } catch (e) {
      return { provider: this.id, is_test_data: false, ok: false, error: (e as Error).message }
    }
  }
}
