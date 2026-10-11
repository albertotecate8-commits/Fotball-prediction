import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import { invokeFunction, rpc } from './rpc'
import type { MatchStatus, MemberStatus, PaymentStatus, RoundStatus } from '@/types/domain'

// Los tipos de las relaciones embebidas se declaran a mano (sin tipos generados).
const unwrap = <T>({ data, error }: { data: unknown; error: unknown }): T => {
  if (error) throw toAppError(error)
  return data as T
}

const MATCH_SELECT = `id, provider, external_id, kickoff_at, status, status_detail, elapsed, home_goals, away_goals,
  result_confirmed, result_source, confirmed_at, last_synced_at, last_sync_error, is_test_data,
  competition:competitions(id, name, logo_url),
  home:teams!matches_home_team_id_fkey(id, name, short_name, code, logo_url),
  away:teams!matches_away_team_id_fkey(id, name, short_name, code, logo_url)`

export interface PoolAdminMatch {
  match_id: string
  kickoff_at: string
  status: MatchStatus
  home_goals: number | null
  away_goals: number | null
  result_confirmed: boolean
  result_source: 'provider' | 'admin'
  provider: string
  external_id: string | null
  pool_status: 'published' | 'withdrawn'
  source: 'auto' | 'admin'
  open: boolean
  closes_at: string | null
  change_reason: string | null
  competition: { id: string; name: string } | null
  home: { id: string; name: string; short_name: string; code: string | null; logo_url: string | null }
  away: { id: string; name: string; short_name: string; code: string | null; logo_url: string | null }
  picks: number
}
/** Partido del borrador «Próxima quiniela» (sugerido, seleccionado o descartado). */
export interface NextPoolMatch {
  match_id: string
  kickoff_at: string
  status: MatchStatus
  elapsed: number | null
  home_goals: number | null
  away_goals: number | null
  result_confirmed: boolean
  provider: string
  external_id: string | null
  competition: { id: string; name: string; logo_url: string | null } | null
  home: { id: string; name: string; short_name: string; code: string | null; logo_url: string | null; retired: boolean }
  away: { id: string; name: string; short_name: string; code: string | null; logo_url: string | null; retired: boolean }
  state: 'suggested' | 'selected' | 'dismissed'
  published: boolean
  withdrawn: boolean
  source: 'auto' | 'admin'
  sort_order: number | null
  needs_review: boolean
  review_reason: string | null
  open: boolean
  picks: number
}
export interface SelectionItem { match_id: string; selected: boolean; dismissed?: boolean; sort_order?: number | null }
export interface TeamCatalogEntry {
  id: string; name: string; short_name: string; logo_url: string | null; provider: string; external_id: string | null
  retired: boolean; retired_at: string | null; retire_reason: string | null
  matches: number; pool_picks: number; round_picks: number; selected: number; deletable: boolean
}
/** Equipo oficial encontrado en API-Football (escudo y datos del proveedor). */
export interface ProviderTeamResult {
  external_id: string; name: string; code: string | null; country: string | null; national: boolean; logo_url: string | null
  catalog_id: string | null; catalog_retired: boolean
}
export interface CreateTeamResult { id: string; created: boolean; retired: boolean; match?: 'provider_id' | 'name' | 'name_upgraded' }
export interface CatalogTeam { id: string; name: string; short_name: string; logo_url: string | null; provider: string; external_id: string | null }

export interface ApiUsageRequest {
  at: string; priority: number; purpose: string; endpoint: string; counted: boolean
  outcome: 'pending' | 'success' | 'empty' | 'error' | 'rate_limited' | 'quota_exhausted' | 'blocked'
  reason: string | null; http: number | null; ms: number | null; results: number | null; error: string | null
}
export interface ApiUsage {
  usage_date: string; budget: number; margin: number; used: number; remaining_internal: number; effective_remaining: number
  provider_remaining_estimate: number | null; provider_reported_at: string | null; provider_limit: number | null
  provider_current: number | null; provider_checked_at: string | null; external_usage: boolean
  paused: boolean; paused_until: string | null; pause_reason: string | null
  blocked: number; succeeded: number; failed: number; cache_hits: number
  status: 'normal' | 'low' | 'paused' | 'error'; last_success_sync: string | null; live_matches: number; live_featured: number
  history: { usage_date: string; requests: number; blocked: number; failed: number; cache_hits: number }[]
  recent: ApiUsageRequest[]; server_time: string
}

export interface ProviderInfo {
  id: string
  is_test_data: boolean
  configured: boolean
  budget_daily: number | null
  usage: { requests: number; reported_remaining: number | null; reported_limit: number | null; last_request_at: string | null; last_error: string | null } | null
  status: { ok: boolean; plan?: string | null; active?: boolean | null; requests_today?: number | null; requests_limit?: number | null; error?: string | null } | null
}
export interface ManualCandidate { external_id: string; kickoff_at: string; home: string; away: string; competition: string | null }
export type ManualMatchResponse =
  | { kind: 'linked'; match_id: string; already_imported: boolean; is_test_data: boolean; fixture: ManualCandidate }
  | { kind: 'manual'; match_id: string; created: boolean }
  | { kind: 'pending_link'; match_id: string; created: boolean; message: string }
  | { kind: 'ambiguous' | 'not_found' | 'outside_window'; candidates: ManualCandidate[]; message?: string }
export interface ProviderStatusResponse { default_provider: string; providers: ProviderInfo[] }
export interface SyncNowResponse {
  reports: { provider: string; status: string; checked: number; updated: number; errors: string[]; quotaStopped?: boolean }[]
  unconfigured: Record<string, number>
  maintained: number
  errors: string[]
}

export interface AdminMatch {
  id: string
  provider: string
  external_id: string
  kickoff_at: string
  status: MatchStatus
  status_detail: string | null
  elapsed: number | null
  home_goals: number | null
  away_goals: number | null
  result_confirmed: boolean
  result_source: 'provider' | 'admin'
  confirmed_at: string | null
  last_synced_at: string | null
  last_sync_error: string | null
  is_test_data: boolean
  competition: { id: string; name: string; logo_url: string | null } | null
  home: { id: string; name: string; short_name: string; code: string | null; logo_url: string | null }
  away: { id: string; name: string; short_name: string; code: string | null; logo_url: string | null }
}

export interface AdminRound {
  id: string
  group_id: string
  name: string
  description: string | null
  status: RoundStatus
  opens_at: string | null
  deadline_at: string
  participation: 'all_members' | 'selected'
  opened_at: string | null
  closed_at: string | null
  finalized_at: string | null
  created_at: string
  group: { name: string } | null
  round_matches: { position: number; match: AdminMatch }[]
  round_participants: { user_id: string }[]
}

export interface AdminGroup {
  id: string
  name: string
  description: string | null
  invite_code: string
  join_requires_approval: boolean
  is_active: boolean
  is_default?: boolean
  requires_payment?: boolean
  created_at: string
}

export interface Participant {
  user_id: string
  display_name: string
  email: string
  role: 'player' | 'admin'
  status: 'active' | 'suspended'
  created_at: string
  last_sign_in_at: string | null
  memberships: { group_id: string; group_name: string; status: MemberStatus; payment_status: PaymentStatus; joined_at: string }[]
  rounds_submitted: number
  total_points: number
}

export interface DashboardStats {
  participants_total: number
  participants_active: number
  pending_approvals: number
  groups: number
  rounds_open: number
  rounds_draft: number
  predictions_submitted: number
  matches_pending_result: number
  last_sync: { id: number; provider: string; status: string; started_at: string; finished_at: string | null; matches_checked: number; matches_updated: number; error_message: string | null } | null
  sync_errors_24h: number
  server_time: string
}

export interface MatchFilters {
  competitionId?: string
  from?: string // ISO
  to?: string // ISO
  status?: MatchStatus | ''
  team?: string
}

export const adminApi = {
  stats: () => rpc<DashboardStats>('admin_dashboard_stats'),

  participants: () => rpc<Participant[]>('admin_list_participants'),
  setUserStatus: (userId: string, status: 'active' | 'suspended') => rpc<void>('admin_set_user_status', { p_user_id: userId, p_status: status }),
  setUserRole: (userId: string, role: 'player' | 'admin') => rpc<void>('admin_set_user_role', { p_user_id: userId, p_role: role }),
  invite: (email: string, displayName: string, groupId: string | null) =>
    invokeFunction<{ user_id: string }>('admin-invite', { email, display_name: displayName, group_id: groupId }),

  groups: async () => unwrap<AdminGroup[]>(await supabase.from('groups').select('*').order('is_default', { ascending: false }).order('created_at')),
  saveGroup: (g: { id: string | null; name: string; description: string; join_requires_approval: boolean; is_active: boolean }) =>
    rpc<string>('admin_save_group', {
      p_group_id: g.id, p_name: g.name, p_description: g.description,
      p_join_requires_approval: g.join_requires_approval, p_is_active: g.is_active,
    }),
  regenerateCode: (groupId: string) => rpc<string>('admin_regenerate_invite_code', { p_group_id: groupId }),
  groupMembers: (groupId: string) =>
    rpc<{ user_id: string; display_name: string; email: string; member_status: MemberStatus; payment_status: PaymentStatus; profile_status: string; joined_at: string }[]>(
      'admin_group_members', { p_group_id: groupId }),
  setMember: (groupId: string, userId: string, status: MemberStatus, payment?: PaymentStatus) =>
    rpc<void>('admin_set_member', { p_group_id: groupId, p_user_id: userId, p_status: status, p_payment_status: payment ?? null }),
  /** Confirmación manual del pago (sin pasarela): referencia, vigencia y motivo quedan auditados. */
  setPayment: (groupId: string, userId: string, status: PaymentStatus, validUntil: string | null, reference: string, reason: string) =>
    rpc<void>('admin_set_payment', { p_group_id: groupId, p_user_id: userId, p_payment_status: status, p_valid_until: validUntil, p_reference: reference, p_reason: reason }),
  payments: async () =>
    unwrap<{ group_id: string; user_id: string; payment_status: PaymentStatus; payment_valid_until: string | null; payment_reference: string | null; payment_confirmed_at: string | null }[]>(
      await supabase.from('group_members').select('group_id, user_id, payment_status, payment_valid_until, payment_reference, payment_confirmed_at'),
    ),
  paymentList: () => rpc<{ user_id: string; display_name: string; email: string; reference: string; payment_status: PaymentStatus; valid_until: string | null;
    payment_reference: string | null; confirmed_at: string | null; confirmed_by: string | null; joined_at: string }[]>('admin_payments'),
  paymentInfo: async () => unwrap<{ bank: string | null; holder: string | null; clabe: string | null; account: string | null; amount: number | null; concept: string | null;
    instructions: string | null; contact: string | null; updated_at: string } | null>(await supabase.from('payment_info').select('*').maybeSingle()),
  savePaymentInfo: (v: { bank: string; holder: string; clabe: string; account: string; amount: number | null; concept: string; instructions: string; contact: string }) =>
    rpc<void>('admin_save_payment_info', { p_bank: v.bank, p_holder: v.holder, p_clabe: v.clabe, p_account: v.account, p_amount: v.amount, p_concept: v.concept, p_instructions: v.instructions, p_contact: v.contact }),
  /** Borrador de la próxima quiniela: sugerencias automáticas + selección del admin. */
  nextPool: () => rpc<NextPoolMatch[]>('admin_next_pool'),
  saveSelection: (items: SelectionItem[]) => rpc<{ saved: number; skipped_started: number }>('admin_save_selection', { p_items: items }),
  publishSelection: (reason: string | null) =>
    rpc<{ published: number; withdrawn: number; withdrawn_picks: number }>('admin_publish_selection', { p_reason: reason }),
  teamCatalog: (q: string) => rpc<TeamCatalogEntry[]>('admin_team_catalog', { p_query: q.trim() || null, p_include_retired: true }),
  retireTeam: (id: string, reason: string) => rpc<{ retired: boolean; suggestions_dismissed: number }>('admin_retire_team', { p_team: id, p_reason: reason }),
  restoreTeam: (id: string) => rpc<void>('admin_restore_team', { p_team: id }),
  deleteTeam: (id: string, reason: string) => rpc<void>('admin_delete_team', { p_team: id, p_reason: reason }),
  /** Búsqueda oficial por nombre en API-Football (servidor, con caché y dentro de la cuota). */
  searchProviderTeams: (query: string) =>
    invokeFunction<{ provider: string; cached: boolean; teams: ProviderTeamResult[] }>('provider-fixtures', { action: 'teams', provider: 'api-football', query }),
  poolList: () => rpc<PoolAdminMatch[]>('admin_pool_list', { p_days_back: 14 }),
  publishMatch: (matchId: string) => rpc<void>('admin_publish_match', { p_match_id: matchId }),
  setPoolStatus: (matchId: string, status: 'published' | 'withdrawn', reason: string) =>
    rpc<void>('admin_set_pool_status', { p_match_id: matchId, p_status: status, p_reason: reason }),
  searchTeams: (q: string) => rpc<CatalogTeam[]>('admin_search_teams', { p_query: q }),
  createTeam: (name: string, shortName: string, logoUrl: string, providerId: string) =>
    rpc<CreateTeamResult>('admin_create_team', { p_name: name, p_short_name: shortName, p_logo_url: logoUrl, p_provider_id: providerId }),
  createPoolMatch: (home: string, away: string, kickoff: string, competitionId: string | null, competitionName: string | null) =>
    rpc<{ match_id: string; created: boolean }>('admin_create_pool_match', { p_home: home, p_away: away, p_kickoff: kickoff, p_competition_id: competitionId, p_competition_name: competitionName }),
  updatePoolMatch: (matchId: string, kickoff: string, reason: string) =>
    rpc<void>('admin_update_pool_match', { p_match_id: matchId, p_kickoff: kickoff, p_reason: reason }),
  addMemberByEmail: (groupId: string, email: string) => rpc<string>('admin_add_member_by_email', { p_group_id: groupId, p_email: email }),

  rounds: async () =>
    unwrap<(Omit<AdminRound, 'round_matches' | 'round_participants'> & { round_matches: { count: number }[] })[]>(
      await supabase.from('rounds').select('*, group:groups(name), round_matches(count)').order('deadline_at', { ascending: false }),
    ),
  round: async (id: string) =>
    unwrap<AdminRound>(
      await supabase
        .from('rounds')
        .select(`*, group:groups(name), round_matches(position, match:matches(${MATCH_SELECT})), round_participants(user_id)`)
        .eq('id', id)
        .order('position', { referencedTable: 'round_matches' })
        .single(),
    ),
  saveRound: (r: { id: string | null; group_id: string; name: string; description: string; opens_at: string | null; deadline_at: string; participation: string }) =>
    rpc<string>('admin_save_round', {
      p_round_id: r.id, p_group_id: r.group_id, p_name: r.name, p_description: r.description,
      p_opens_at: r.opens_at, p_deadline_at: r.deadline_at, p_participation: r.participation,
    }),
  setRoundMatches: (roundId: string, matchIds: string[]) => rpc<number>('admin_set_round_matches', { p_round_id: roundId, p_match_ids: matchIds }),
  setRoundParticipants: (roundId: string, userIds: string[]) => rpc<number>('admin_set_round_participants', { p_round_id: roundId, p_user_ids: userIds }),
  setRoundStatus: (roundId: string, status: RoundStatus, reason?: string) =>
    rpc<string>('admin_set_round_status', { p_round_id: roundId, p_status: status, p_reason: reason ?? null }),
  deleteRound: (roundId: string) => rpc<void>('admin_delete_round', { p_round_id: roundId }),
  submissions: (roundId: string) =>
    rpc<{ user_id: string; display_name: string; prediction_status: 'none' | 'draft' | 'submitted'; items: number; submitted_at: string | null; points: number | null }[]>(
      'admin_round_submissions', { p_round_id: roundId }),
  recompute: (roundId: string) => rpc<string>('admin_recompute_round', { p_round_id: roundId }),

  competitions: async () => unwrap<{ id: string; name: string; external_id: string; provider: string; is_test_data: boolean }[]>(
    await supabase.from('competitions').select('id, name, external_id, provider, is_test_data').order('name'),
  ),
  searchMatches: async (f: MatchFilters) => {
    let q = supabase.from('matches').select(MATCH_SELECT).order('kickoff_at').limit(200)
    if (f.competitionId) q = q.eq('competition_id', f.competitionId)
    if (f.from) q = q.gte('kickoff_at', f.from)
    if (f.to) q = q.lte('kickoff_at', f.to)
    if (f.status) q = q.eq('status', f.status)
    const rows = unwrap<AdminMatch[]>(await q)
    const team = f.team?.trim().toLowerCase()
    return team ? rows.filter((m) => m.home.name.toLowerCase().includes(team) || m.away.name.toLowerCase().includes(team)) : rows
  },
  importFromProvider: (provider: string, filters: { competitionId?: string; season?: string; from?: string; to?: string; team?: string; status?: string }) =>
    invokeFunction<{ provider: string; is_test_data: boolean; cached: boolean; match_ids: string[]; inserted: number }>('provider-fixtures', { action: 'search', provider, filters }),
  providerCompetitions: (provider: string) =>
    invokeFunction<{ provider: string; is_test_data: boolean; competitions: { external_id: string; name: string; country: string | null; season: string | null }[] }>(
      'provider-fixtures', { action: 'competitions', provider }),
  matchById: async (id: string) => unwrap<AdminMatch>(await supabase.from('matches').select(MATCH_SELECT).eq('id', id).single()),
  addManualMatch: (provider: string, manual: { home: string; away: string; kickoff_at: string; competitionId?: string; competitionName?: string; pick_external_id?: string; create_unlinked?: boolean; no_create?: boolean }) =>
    invokeFunction<ManualMatchResponse>('provider-fixtures', { action: 'manual', provider, manual }),
  providerStatus: () => invokeFunction<ProviderStatusResponse>('provider-fixtures', { action: 'status' }),
  apiUsage: () => rpc<ApiUsage>('admin_api_usage'),

  resultsBoard: async () =>
    unwrap<(AdminMatch & { round_matches: { round: { id: string; name: string; status: RoundStatus } }[] })[]>(
      await supabase
        .from('matches')
        .select(`${MATCH_SELECT}, round_matches!inner(round:rounds!inner(id, name, status))`)
        .in('round_matches.round.status', ['open', 'closed', 'finished', 'under_review'])
        .order('kickoff_at', { ascending: false })
        .limit(200),
    ),
  recordResult: (matchId: string, home: number | null, away: number | null, status: MatchStatus, reason: string) =>
    rpc<void>('admin_record_result', { p_match_id: matchId, p_home: home, p_away: away, p_status: status, p_reason: reason }),
  releaseOverride: (matchId: string) => rpc<void>('admin_release_result_override', { p_match_id: matchId }),
  syncNow: () => invokeFunction<SyncNowResponse>('sync-results', {}),

  audit: async (page: number, pageSize = 30) =>
    unwrap<{ id: number; action: string; entity_type: string; entity_id: string | null; details: Record<string, unknown>; created_at: string; actor: { display_name: string } | null }[]>(
      await supabase.from('audit_logs').select('*, actor:profiles(display_name)').order('created_at', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1),
    ),
  syncRuns: async () =>
    unwrap<{ id: number; provider: string; trigger_source: string; started_at: string; finished_at: string | null; status: string; matches_checked: number; matches_updated: number; error_message: string | null }[]>(
      await supabase.from('sync_runs').select('*').order('started_at', { ascending: false }).limit(20),
    ),
}
