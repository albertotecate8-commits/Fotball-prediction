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
  getFixturesByIds(externalIds: string[]): Promise<NormalizedFixture[]>
  listCompetitions(): Promise<NormalizedCompetition[]>
  /** Comprueba la conexión y la cuenta (no consume cuota en API-Football). */
  status(): Promise<ProviderStatus>
}

/**
 * Control de cuota compartido (vive en la base de datos). `take` reserva una
 * solicitud ANTES de hacerla; `report` guarda lo que informa el proveedor.
 */
export interface RequestGate {
  take(): Promise<{ allowed: boolean; reason?: string }>
  report(info: { remainingDaily: number | null; limitDaily: number | null; error?: string | null }): Promise<void>
}

export type ProviderErrorCode =
  | 'INVALID_KEY'
  | 'PLAN_RESTRICTED'
  | 'RATE_LIMITED'
  | 'QUOTA_EXHAUSTED'
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
