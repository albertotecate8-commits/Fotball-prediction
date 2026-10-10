// Tipos de las respuestas de las RPC del servidor.
export type RoundStatus = 'draft' | 'open' | 'closed' | 'finished' | 'under_review'
export type RoundPhase = 'draft' | 'upcoming' | 'open' | 'closed' | 'in_progress' | 'finished' | 'under_review'
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'postponed' | 'suspended' | 'cancelled' | 'abandoned' | 'unknown'
export type PredictionStatus = 'none' | 'draft' | 'submitted'
export type MemberStatus = 'pending' | 'active' | 'suspended'
export type PaymentStatus = 'not_applicable' | 'pending' | 'authorized' | 'rejected'

export interface Team {
  id?: string
  name: string
  short_name: string
  code: string | null
  logo_url: string | null
}

export interface Profile {
  id: string
  display_name: string
  avatar_url: string | null
  role: 'player' | 'admin'
  status: 'active' | 'suspended'
  created_at: string
}

export interface MyGroup {
  group_id: string
  name: string
  description: string | null
  member_status: MemberStatus
  joined_at: string
  members_count: number
}

export interface RoundListItem {
  round_id: string
  name: string
  description: string | null
  status: RoundStatus
  phase: RoundPhase
  opens_at: string | null
  deadline_at: string
  finalized_at: string | null
  match_count: number
  first_kickoff: string | null
  last_kickoff: string | null
  my_status: PredictionStatus
  my_items: number
  my_submitted_at: string | null
  my_points: number | null
  my_exact_hits: number | null
  my_outcome_hits: number | null
  my_position: number | null
  players: number | null
  is_official: boolean
}

export interface RoundMatch {
  match_id: string
  position: number
  kickoff_at: string
  status: MatchStatus
  status_detail: string | null
  elapsed: number | null
  home_goals: number | null
  away_goals: number | null
  result_confirmed: boolean
  is_test_data: boolean
  competition: { name: string; logo_url: string | null } | null
  home: Team
  away: Team
  pick: { home: number; away: number } | null
  score: { points: number; exact_hit: boolean; outcome_hit: boolean; goal_error: number; is_final: boolean } | null
}

export interface RoundDetail {
  round: {
    id: string
    group_id: string
    name: string
    description: string | null
    status: RoundStatus
    phase: RoundPhase
    opens_at: string | null
    deadline_at: string
    finalized_at: string | null
  }
  server_time: string
  max_goals: number
  prediction: { id: string; status: 'draft' | 'submitted'; submitted_at: string | null; client_seq: number; updated_at: string } | null
  matches: RoundMatch[]
  summary: {
    points: number
    exact_hits: number
    outcome_hits: number
    goal_error: number
    scored_matches: number
    position: number | null
    players: number
    is_official: boolean
    max_possible: number
  }
}

export interface LeaderboardRow {
  rank_position: number
  user_id: string
  display_name: string
  avatar_url: string | null
  points: number
  exact_hits: number
  outcome_hits: number
  goal_error: number
  rounds_played: number
  scored_matches: number
  is_provisional: boolean
  is_me: boolean
}

export interface PositionHistoryRow {
  round_id: string
  round_name: string
  deadline_at: string
  round_points: number | null
  round_position: number | null
  cumulative_points: number
  cumulative_position: number
  players: number
  is_official: boolean
}

export interface PlayerSummary {
  total_points: number
  position: number | null
  players: number
  exact_hits: number
  outcome_hits: number
  rounds_played: number
  is_provisional: boolean
  last_round: { round_id: string; name: string; points: number; position: number | null; is_official: boolean } | null
}

export interface UpcomingMatch {
  match_id: string
  kickoff_at: string
  status: MatchStatus
  elapsed: number | null
  home_goals: number | null
  away_goals: number | null
  is_test_data: boolean
  round_id: string
  round_name: string
  home: Team
  away: Team
}

export interface AppConfig {
  timezone: string
  max_goals: number
  payments_enabled: boolean
  server_time: string
}

export interface PredictionItemInput {
  match_id: string
  home: number | null
  away: number | null
}

/** Partido destacado del proveedor real (no forma parte de una jornada por sí mismo). */
export interface FeaturedMatch {
  provider: string
  external_id: string
  kickoff_at: string
  status: MatchStatus
  priority: number
  reason: string | null
  refreshed_at: string
  /** Jornada visible para el jugador que incluye este partido, si existe. */
  in_round_id: string | null
  in_round_name: string | null
  data: {
    status_detail: string | null
    elapsed: number | null
    home_goals: number | null
    away_goals: number | null
    competition: { name: string; country: string | null; logo_url: string | null } | null
    home: { name: string; short_name: string; logo_url: string | null }
    away: { name: string; short_name: string; logo_url: string | null }
  }
}
