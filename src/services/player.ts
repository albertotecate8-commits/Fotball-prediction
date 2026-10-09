import { rpc } from './rpc'
import type {
  AppConfig, LeaderboardRow, MyGroup, PlayerSummary, PositionHistoryRow, PredictionItemInput, RoundDetail, RoundListItem, UpcomingMatch,
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
  claimFirstAdmin: () => rpc<boolean>('claim_first_admin'),
}
