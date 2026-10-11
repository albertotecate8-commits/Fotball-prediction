import { rpc } from './rpc'
import type {
  AppConfig, FeaturedMatch, WeekBoard, LeaderboardRow, MyPayment, Participation, PoolData, QuinielaPickInput, MyGroup, PlayerSummary, PositionHistoryRow, PredictionItemInput, RoundDetail, RoundListItem, UpcomingMatch,
} from '@/types/domain'

export const playerApi = {
  config: () => rpc<AppConfig>('get_app_config'),
  serverTime: () => rpc<string>('get_server_time'),
  myGroups: () => rpc<MyGroup[]>('get_my_groups'),
  joinGroup: (code: string) => rpc<{ group_id: string; name: string; status: string }>('join_group', { p_invite_code: code }),
  rounds: (groupId: string) => rpc<RoundListItem[]>('get_my_rounds', { p_group_id: groupId }),
  roundDetail: (roundId: string) => rpc<RoundDetail>('get_round_detail', { p_round_id: roundId }),
  leaderboard: (groupId: string, roundId?: string | null) =>
    rpc<LeaderboardRow[]>('get_leaderboard', { p_group_id: groupId, p_round_id: roundId ?? null }),
  history: (groupId: string) => rpc<PositionHistoryRow[]>('get_position_history', { p_group_id: groupId }),
  summary: (groupId: string) => rpc<PlayerSummary>('get_player_summary', { p_group_id: groupId }),
  upcoming: (groupId: string) => rpc<UpcomingMatch[]>('get_upcoming_matches', { p_group_id: groupId, p_limit: 8 }),
  saveDraft: (roundId: string, items: PredictionItemInput[], seq: number) =>
    rpc<{ status: 'draft' | 'submitted'; applied: boolean; client_seq: number; saved_at?: string; reason?: string }>(
      'save_prediction_draft', { p_round_id: roundId, p_items: items, p_client_seq: seq }),
  submit: (roundId: string, items: PredictionItemInput[], seq: number) =>
    rpc<{ status: 'submitted'; already_submitted: boolean; submitted_at: string }>(
      'submit_prediction', { p_round_id: roundId, p_items: items, p_client_seq: seq }),
  featured: () => rpc<FeaturedMatch[]>('get_featured_matches', { p_limit: 14 }),
  /** Cuándo se actualizaron los resultados (los datos siempre vienen de Supabase, nunca del proveedor). */
  /** Bolsa acumulada (60 % de los pagos confirmados); el resto nunca llega al navegador. */
  pot: () => rpc<{ pot: number; paid_count: number; currency: string; configured: boolean } | null>('get_prize_pot'),
  week: () => rpc<{ label: string; week_start: string; week_end: string; max_matches: number; filled: number } | null>('get_pool_week'),
  freshness: () => rpc<{ updated_at: string | null; delayed: boolean } | null>('get_results_freshness'),
  participation: (roundId?: string | null) => rpc<Participation>('get_my_participation', { p_round_id: roundId ?? null }),
  saveQuiniela: (roundId: string, items: QuinielaPickInput[], seq: number) =>
    rpc<{ status: 'draft'; saved_at: string; picks: number; total: number; can_submit: boolean; client_seq: number }>('save_quiniela', { p_round_id: roundId, p_items: items, p_client_seq: seq }),
  submitQuiniela: (roundId: string, items: QuinielaPickInput[], seq: number) =>
    rpc<{ status: 'submitted'; already_submitted: boolean; submitted_at: string; picks?: number }>('submit_quiniela', { p_round_id: roundId, p_items: items, p_client_seq: seq }),
  myPayment: () => rpc<MyPayment>('get_my_payment'),
  pool: () => rpc<PoolData>('get_pool', { p_days_back: 10 }),
  savePool: (items: QuinielaPickInput[]) => rpc<{ saved: number; closed: number; already_submitted: number; saved_at: string }>('save_pool_picks', { p_items: items }),
  submitPool: (items: QuinielaPickInput[]) => rpc<{ submitted: number; closed: number; already_submitted: number; submitted_at: string }>('submit_pool_picks', { p_items: items }),
  poolLeaderboard: () => rpc<LeaderboardRow[]>('get_pool_leaderboard'),
  /** Total de goles de la jornada (desempate); se guarda como borrador hasta enviar la quiniela. */
  saveWeekGoals: (weekId: string, goals: number) => rpc<{ saved: boolean; total_goals: number; saved_at: string }>('save_week_goals', { p_week: weekId, p_goals: goals }),
  /** Clasificación de la semana: aciertos y, en empate, cercanía al total de goles. */
  weekBoard: (weekId?: string | null) => rpc<WeekBoard>('get_week_leaderboard', { p_week: weekId ?? null }),
  claimFirstAdmin: () => rpc<boolean>('claim_first_admin'),
}
