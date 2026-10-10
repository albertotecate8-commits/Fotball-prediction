// Contrato común para cualquier proveedor de datos de fútbol.
// Cambiar de proveedor = implementar FootballProvider; el resto no cambia.

export const MATCH_STATUSES = [
  'scheduled', 'live', 'finished', 'postponed', 'suspended', 'cancelled', 'abandoned', 'unknown',
] as const
export type MatchStatus = (typeof MATCH_STATUSES)[number]

export interface NormalizedTeam {
  external_id: string
  name: string
  short_name: string
  code?: string | null
  logo_url?: string | null
}

export interface NormalizedCompetition {
  external_id: string
  name: string
  country?: string | null
  season?: string | null
  logo_url?: string | null
}

export interface NormalizedFixture {
  external_id: string
  kickoff_at: string // ISO 8601 UTC
  status: MatchStatus
  status_detail: string | null
  elapsed: number | null
  /** Marcador a los 90 minutos (reglamento de la quiniela). */
  home_goals: number | null
  away_goals: number | null
  competition?: NormalizedCompetition
  home: NormalizedTeam
  away: NormalizedTeam
  raw?: unknown
}

export interface FixtureSearch {
  competitionId?: string
  season?: string
  /** YYYY-MM-DD en la zona horaria de la competencia */
  from?: string
  to?: string
  team?: string
  status?: 'scheduled' | 'live' | 'finished'
}

export interface ProviderStatus {
  provider: string
  is_test_data: boolean
  ok: boolean
  plan?: string | null
  active?: boolean | null
  requests_today?: number | null
  requests_limit?: number | null
  error?: string | null
}

export interface FootballProvider {
  readonly id: string
  /** true si los datos son ficticios (modo demostración / pruebas). */
  readonly isTestData: boolean
  searchFixtures(query: FixtureSearch): Promise<NormalizedFixture[]>
  /**
   * `dates` (YYYY-MM-DD UTC de cada partido) permite al adaptador recurrir a
   * consultas por día si el plan no permite consultar por id.
   */
  getFixturesByIds(externalIds: string[], hint?: { dates?: string[] }): Promise<NormalizedFixture[]>
  listCompetitions(): Promise<NormalizedCompetition[]>
  /** Comprueba la conexión y la cuenta (no consume cuota en API-Football). */
  status(): Promise<ProviderStatus>
}

/** Prioridad de una consulta: 1 en vivo · 2 próximos/finales · 3 calendario · 4 Inicio · 5 panel admin. */
export interface RequestContext { priority: 1 | 2 | 3 | 4 | 5; purpose: string }

export type RequestOutcome = 'success' | 'empty' | 'error' | 'rate_limited' | 'quota_exhausted'

/**
 * Control de cuota compartido (vive en la base de datos). `take` reserva una
 * solicitud ANTES de hacerla (o la bloquea); `finish` registra su resultado.
 */
export interface RequestGate {
  take(info: RequestContext & { endpoint: string; counted: boolean }): Promise<{ allowed: boolean; reason?: string; id?: number | null }>
  finish(ticket: { id?: number | null }, r: {
    outcome: RequestOutcome; httpStatus: number | null; remainingDaily: number | null; limitDaily: number | null
    durationMs: number; results: number | null; error?: string | null
  }): Promise<void>
}

export type ProviderErrorCode =
  | 'INVALID_KEY'
  | 'PLAN_RESTRICTED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
  /** Bloqueada por el presupuesto interno de SHABEX (nunca llegó al proveedor). */
  | 'BUDGET_BLOCKED'
  | 'UNAVAILABLE'
  | 'BAD_REQUEST'
  | 'NOT_CONFIGURED'

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status?: number,
    readonly code: ProviderErrorCode = retryable ? 'UNAVAILABLE' : 'BAD_REQUEST',
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
