// Adaptador para API-Football v3 (api-sports.io).
// Documentación: https://www.api-football.com/documentation-v3
import { ProviderError, type FixtureSearch, type FootballProvider, type MatchStatus, type NormalizedCompetition, type NormalizedFixture } from './types.ts'

const BASE_URL = 'https://v3.football.api-sports.io'
const MAX_IDS_PER_REQUEST = 20

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
  response: T[]
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

export interface ApiFootballOptions {
  apiKey: string
  fetchImpl?: typeof fetch
  retries?: number
  timeoutMs?: number
  sleep?: (ms: number) => Promise<void>
}

export class ApiFootballProvider implements FootballProvider {
  readonly id = 'api-football'
  readonly isTestData = false
  private readonly fetchImpl: typeof fetch
  private readonly retries: number
  private readonly timeoutMs: number
  private readonly sleep: (ms: number) => Promise<void>

  constructor(private readonly opts: ApiFootballOptions) {
    if (!opts.apiKey) throw new ProviderError('API_FOOTBALL_KEY no configurada', false)
    this.fetchImpl = opts.fetchImpl ?? fetch
    this.retries = opts.retries ?? 2
    this.timeoutMs = opts.timeoutMs ?? 10_000
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
  }

  private async get<T>(path: string, params: Record<string, string | undefined>): Promise<T[]> {
    const url = new URL(BASE_URL + path)
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') url.searchParams.set(k, v)

    let lastError: ProviderError | null = null
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0) await this.sleep(500 * 2 ** (attempt - 1))
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), this.timeoutMs)
      try {
        const res = await this.fetchImpl(url.toString(), {
          headers: { 'x-apisports-key': this.opts.apiKey },
          signal: controller.signal,
        })
        if (res.status === 429 || res.status >= 500) {
          lastError = new ProviderError(`API-Football HTTP ${res.status}`, true, res.status)
          continue
        }
        if (!res.ok) throw new ProviderError(`API-Football HTTP ${res.status}`, false, res.status)
        const body = (await res.json()) as ApiResponse<T>
        if (hasErrors(body.errors)) {
          const msg = JSON.stringify(body.errors)
          const retryable = /rate|limit|too many/i.test(msg)
          lastError = new ProviderError(`API-Football: ${msg}`, retryable)
          if (!retryable) throw lastError
          continue
        }
        return body.response ?? []
      } catch (e) {
        if (e instanceof ProviderError && !e.retryable) throw e
        lastError = e instanceof ProviderError ? e : new ProviderError(`API-Football no disponible: ${(e as Error).message}`, true)
      } finally {
        clearTimeout(timer)
      }
    }
    throw lastError ?? new ProviderError('API-Football no disponible', true)
  }

  async searchFixtures(q: FixtureSearch): Promise<NormalizedFixture[]> {
    const statusParam = q.status === 'scheduled' ? 'NS-TBD' : q.status === 'live' ? '1H-HT-2H-ET-BT-P-LIVE' : q.status === 'finished' ? 'FT-AET-PEN' : undefined
    const rows = await this.get<ApiFixture>('/fixtures', {
      league: q.competitionId,
      season: q.season,
      from: q.from,
      to: q.to ?? q.from,
      status: statusParam,
      timezone: 'UTC',
    })
    const team = q.team?.trim().toLowerCase()
    return rows
      .map(normalizeApiFootballFixture)
      .filter((f) => !team || f.home.name.toLowerCase().includes(team) || f.away.name.toLowerCase().includes(team))
  }

  async getFixturesByIds(ids: string[]): Promise<NormalizedFixture[]> {
    const out: NormalizedFixture[] = []
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST)
      const rows = await this.get<ApiFixture>('/fixtures', { ids: chunk.join('-'), timezone: 'UTC' })
      out.push(...rows.map(normalizeApiFootballFixture))
    }
    return out
  }

  async listCompetitions(): Promise<NormalizedCompetition[]> {
    const rows = await this.get<{ league: { id: number; name: string; logo: string }; country: { name: string }; seasons: { year: number; current: boolean }[] }>(
      '/leagues', { current: 'true' },
    )
    return rows.map((r) => ({
      external_id: String(r.league.id),
      name: r.league.name,
      country: r.country?.name ?? null,
      season: String(r.seasons?.find((s) => s.current)?.year ?? ''),
      logo_url: r.league.logo,
    }))
  }
}
