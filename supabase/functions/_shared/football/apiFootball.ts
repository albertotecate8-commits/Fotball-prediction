// Adaptador para API-Football v3 (api-sports.io).
// Documentación: https://www.api-football.com/documentation-v3
// Plan gratuito: 100 solicitudes/día (reinicio 00:00 UTC) y límite por minuto.
import {
  ProviderError, type FixtureSearch, type FootballProvider, type MatchStatus, type NormalizedCompetition,
  type NormalizedFixture, type ProviderErrorCode, type ProviderStatus, type RequestContext, type RequestGate, type RequestOutcome,
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
  /** Reintentos máximos ante errores de red/servidor (por omisión 2 en vivo/próximos, 1 el resto). */
  retries?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
  /** Control de cuota compartido. Sin él no hay límite propio (solo pruebas). */
  gate?: RequestGate
  now?: () => Date
}

/** Equipo tal como lo devuelve API-Football (escudo oficial, nunca inventado). */
export interface ProviderTeam { external_id: string; name: string; code: string | null; country: string | null; national: boolean; logo_url: string | null }

export class ApiFootballProvider implements FootballProvider {
  readonly id = 'api-football'
  readonly isTestData = false
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>
  /** Solicitudes HTTP realmente enviadas por esta instancia. */
  requestsMade = 0

  constructor(private readonly opts: ApiFootballOptions) {
    if (!opts.apiKey) throw new ProviderError('API_FOOTBALL_KEY no configurada', false, undefined, 'NOT_CONFIGURED')
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.timeoutMs = opts.timeoutMs ?? 10_000
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  /** Prioridad y motivo de las próximas consultas; los fija el planificador o el panel. */
  context: RequestContext = { priority: 5, purpose: 'admin' }

  /**
   * Única salida hacia API-Football. Cada intento se reserva antes en la base
   * de datos (puede quedar bloqueado sin salir) y se registra al terminar.
   * - 429 / límite por minuto o diario: no se reintenta (la base pausa las consultas).
   * - Red, tiempo agotado o 5xx: pocos reintentos con espera progresiva; cada uno cuenta.
   */
  private async request<T>(path: string, params: Record<string, string | undefined>, countsQuota = true): Promise<T> {
    const url = new URL(BASE_URL + path)
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v)
    // Lo que se registra: ruta y parámetros (la clave va en una cabecera y nunca se guarda).
    const endpoint = `${path}?${url.searchParams.toString()}`
    const ctx = { ...this.context }
    const maxRetries = this.opts.retries ?? (ctx.priority <= 2 ? 2 : 1)

    let lastError: ProviderError | null = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await this.sleep(1000 * 3 ** (attempt - 1))
      const ticket = this.opts.gate ? await this.opts.gate.take({ ...ctx, endpoint, counted: countsQuota }) : { allowed: true, id: null }
      if (!ticket.allowed) {
        throw new ProviderError(`Consulta no enviada para proteger la cuota (${ticket.reason ?? 'sin cupo'})`, false, undefined, 'BUDGET_BLOCKED')
      }
      const started = Date.now()
      const finish = async (outcome: RequestOutcome, httpStatus: number | null, remainingDaily: number | null, limitDaily: number | null, results: number | null, error?: string) => {
        if (this.opts.gate) await this.opts.gate.finish(ticket, { outcome, httpStatus, remainingDaily, limitDaily, durationMs: Date.now() - started, results, error: error ?? null })
      }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      let res: Response
      try {
        this.requestsMade++
        res = await this.fetchImpl(url.toString(), { headers: { 'x-apisports-key': this.opts.apiKey }, signal: controller.signal })
      } catch (e) {
        clearTimeout(timer)
        lastError = new ProviderError(`API-Football no disponible: ${(e as Error).name === 'AbortError' ? 'tiempo agotado' : (e as Error).message}`, true, undefined, 'UNAVAILABLE')
        await finish('error', null, null, null, null, lastError.message)
        continue
      }
      clearTimeout(timer)
      const remainingDaily = headerNumber(res.headers, 'x-ratelimit-requests-remaining')
      const limitDaily = headerNumber(res.headers, 'x-ratelimit-requests-limit')
      if (res.status === 429) {
        const err = new ProviderError('API-Football: demasiadas solicitudes (HTTP 429)', false, 429, 'RATE_LIMITED')
        await finish('rate_limited', 429, remainingDaily, limitDaily, null, err.message)
        throw err
      }
      if (res.status >= 500) {
        lastError = new ProviderError(`API-Football HTTP ${res.status}`, true, res.status, 'UNAVAILABLE')
        await finish('error', res.status, remainingDaily, limitDaily, null, lastError.message)
        continue
      }
      if (res.status === 401 || res.status === 403) {
        const err = new ProviderError(`API-Football rechazó la clave (HTTP ${res.status})`, false, res.status, 'INVALID_KEY')
        await finish('error', res.status, remainingDaily, limitDaily, null, err.message)
        throw err
      }
      if (!res.ok) {
        const err = new ProviderError(`API-Football HTTP ${res.status}`, false, res.status, 'BAD_REQUEST')
        await finish('error', res.status, remainingDaily, limitDaily, null, err.message)
        throw err
      }

      let body: ApiResponse<T> | null = null
      try { body = (await res.json()) as ApiResponse<T> } catch { body = null }
      if (!body || typeof body !== 'object' || !('response' in body)) {
        // Respuesta vacía o cortada: cuenta como intento fallido y se reintenta con espera.
        lastError = new ProviderError('API-Football: respuesta incompleta', true, res.status, 'UNAVAILABLE')
        await finish('error', res.status, remainingDaily, limitDaily, null, lastError.message)
        continue
      }
      if (hasErrors(body.errors)) {
        const c = classifyApiFootballErrors(body.errors)
        const err = new ProviderError(`API-Football: ${c.message}`, false, res.status, c.code)
        await finish(c.code === 'QUOTA_EXHAUSTED' ? 'quota_exhausted' : c.code === 'RATE_LIMITED' ? 'rate_limited' : 'error', res.status, remainingDaily, limitDaily, null, err.message)
        throw err
      }
      const results = Array.isArray(body.response) ? body.response.length : body.response ? 1 : 0
      await finish(results === 0 ? 'empty' : 'success', res.status, remainingDaily, limitDaily, results)
      return body.response
    }
    throw lastError ?? new ProviderError('API-Football no disponible', true, undefined, 'UNAVAILABLE')
  }

  /** Partidos con datos completos; los incompletos se descartan (nunca se inventan). */
  private normalizeAll(rows: ApiFixture[] | null | undefined): NormalizedFixture[] {
    const out: NormalizedFixture[] = []
    for (const r of rows ?? []) {
      if (!r?.fixture?.id || !r.fixture.date || !r.teams?.home?.id || !r.teams?.away?.id || Number.isNaN(Date.parse(r.fixture.date))) {
        this.incomplete++
        continue
      }
      out.push(normalizeApiFootballFixture(r))
    }
    return out
  }
  /** Partidos descartados por venir incompletos en la respuesta. */
  incomplete = 0

  /** El plan no permite la consulta de partidos en vivo: se usan los días. */
  liveRestricted = false

  /** Todos los partidos en juego en UNA solicitud (todas las ligas). */
  async fixturesLive(): Promise<NormalizedFixture[]> {
    try {
      return this.normalizeAll(await this.request<ApiFixture[]>('/fixtures', { live: 'all', timezone: 'UTC' }))
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'PLAN_RESTRICTED') this.liveRestricted = true
      throw e
    }
  }

  /**
   * El plan gratuito solo permite consultar por temporada las de años
   * anteriores, pero sí permite consultar por fecha. Cuando la temporada está
   * restringida se recurre a una consulta por día (todas las ligas) y se filtra.
   */
  seasonRestricted = false
  /** El plan no permite consultar por id: se usan directamente los días. */
  idsRestricted = false
  /** Días consultables respecto a hoy (UTC), p. ej. [-1, 1] en el plan gratuito. */
  dateWindow: [number, number] | null = null

  private todayUtc() {
    return (this.opts.now?.() ?? new Date()).toISOString().slice(0, 10)
  }

  private offsetOf(date: string) {
    return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${this.todayUtc()}T00:00:00Z`)) / DAY)
  }

  /** «try from 2026-10-09 to 2026-10-11» → [-1, 1] */
  private learnDateWindow(message: string) {
    const m = /from (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})/.exec(message)
    if (m && /date/i.test(message)) this.dateWindow = [this.offsetOf(m[1]!), this.offsetOf(m[2]!)]
    return !!m
  }

  private inWindow(date: string) {
    if (!this.dateWindow) return true
    const o = this.offsetOf(date)
    return o >= this.dateWindow[0] && o <= this.dateWindow[1]
  }

  private statusParam(q: FixtureSearch) {
    return q.status === 'scheduled' ? 'NS-TBD' : q.status === 'live' ? '1H-HT-2H-ET-BT-P-LIVE' : q.status === 'finished' ? 'FT-AET-PEN' : undefined
  }

  /**
   * Una consulta por día. Los días fuera de la ventana del plan se omiten sin
   * gastar solicitudes; `strict` exige que al menos un día sea consultable.
   */
  private async byDays(days: string[], status?: string, strict = true): Promise<NormalizedFixture[]> {
    if (days.length > MAX_DAYS_BY_DATE) {
      throw new ProviderError(`Con el plan gratuito busca como máximo ${MAX_DAYS_BY_DATE} días por competición`, false, undefined, 'BAD_REQUEST')
    }
    const out: NormalizedFixture[] = []
    let consulted = 0
    for (const date of days) {
      if (!this.inWindow(date)) continue
      try {
        const rows = await this.request<ApiFixture[]>('/fixtures', { date, status, timezone: 'UTC' })
        out.push(...this.normalizeAll(rows))
        consulted++
      } catch (e) {
        if (!(e instanceof ProviderError) || e.code !== 'PLAN_RESTRICTED' || !this.learnDateWindow(e.message)) throw e
      }
    }
    if (strict && consulted === 0) {
      const w = this.dateWindow
      const range = w ? `${w[0] === -1 ? 'ayer' : `${w[0]} días`} a ${w[1] === 1 ? 'mañana' : `${w[1]} días`}` : 'fechas cercanas'
      throw new ProviderError(`El plan del proveedor solo consulta partidos de ${range}`, false, undefined, 'PLAN_RESTRICTED')
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
          fixtures = this.normalizeAll(rows)
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
    const wanted = new Set(ids)
    const viaDays = async () => (await this.byDays([...new Set(hint!.dates!)].sort().slice(0, MAX_DAYS_BY_DATE), undefined, false)).filter((f) => wanted.has(f.external_id))
    if (this.idsRestricted && hint?.dates?.length) return viaDays()
    try {
      for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
        const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST)
        const rows = await this.request<ApiFixture[]>('/fixtures', { ids: chunk.join('-'), timezone: 'UTC' })
        out.push(...this.normalizeAll(rows))
      }
      return out
    } catch (e) {
      // Plan sin acceso por id: consultar los días de los partidos pendientes.
      if (!(e instanceof ProviderError) || e.code !== 'PLAN_RESTRICTED' || !hint?.dates?.length) throw e
      this.idsRestricted = true
      return viaDays()
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

  /** Equipos por nombre (mín. 3 letras). 1 solicitud. */
  async searchTeams(name: string): Promise<ProviderTeam[]> {
    const rows = await this.request<{ team: { id: number; name: string; code: string | null; country: string | null; national: boolean; logo: string | null } }[]>('/teams', { search: name })
    return (rows ?? []).filter((r) => r?.team?.id && r.team.name).map((r) => ({
      external_id: String(r.team.id), name: r.team.name, code: r.team.code ?? null, country: r.team.country ?? null,
      national: !!r.team.national, logo_url: typeof r.team.logo === 'string' && r.team.logo.startsWith('https://') ? r.team.logo : null,
    }))
  }

  /** Próximos partidos de un equipo (puede estar restringido por el plan). 1 solicitud. */
  async nextFixturesForTeam(teamId: string, next = 3): Promise<NormalizedFixture[]> {
    const rows = await this.request<ApiFixture[]>('/fixtures', { team: teamId, next: String(next), timezone: 'UTC' })
    return this.normalizeAll(rows)
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
