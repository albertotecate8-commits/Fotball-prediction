// Backend simulado para pruebas visuales. TODOS los datos son ficticios.
import type { Page, Route } from '@playwright/test'

const UID = '00000000-0000-4000-8000-000000000001'
const GID = '00000000-0000-4000-8000-0000000000a1'
const now = Date.now()
const iso = (ms: number) => new Date(now + ms).toISOString()
const H = 3600e3

const team = (name: string, short: string, code: string) => ({ name, short_name: short, code, logo_url: null })
const T = [
  team('Atlético Prueba', 'Atl. Prueba', 'ATP'), team('Deportivo Demo', 'Dep. Demo', 'DEM'),
  team('Real Ficticio', 'R. Ficticio', 'RFI'), team('Unión Ensayo', 'U. Ensayo', 'UEN'),
  team('Club Simulado', 'Simulado', 'SIM'), team('Racing Muestra', 'R. Muestra', 'RMU'),
  team('Sporting Test', 'Sp. Test', 'SPT'), team('Inter Ejemplo', 'Inter Ej.', 'INE'),
  team('Juventud Piloto', 'J. Piloto', 'JPI'), team('Estrella Beta', 'E. Beta', 'EBE'),
]

const openMatches = Array.from({ length: 10 }, (_, i) => ({
  match_id: `m-open-${i}`, position: i + 1, kickoff_at: iso(30 * H + i * 2 * H), status: 'scheduled', status_detail: 'NS', elapsed: null,
  home_goals: null, away_goals: null, result_confirmed: false, is_test_data: true,
  competition: { name: 'Liga de Prueba (datos ficticios)', logo_url: null },
  home: T[i % 10], away: T[(i + 3) % 10],
  pick: i < 6 ? { home: (i % 3), away: (i + 1) % 2 } : null, score: null,
}))

const finishedReal = [[2, 1], [1, 1], [0, 2], [3, 0], [1, 0], [2, 2], [0, 0], [1, 2], [4, 1], [0, 1]]
const finishedPick = [[2, 1], [0, 0], [1, 3], [1, 0], [2, 2], [2, 2], [1, 0], [1, 2], [2, 1], [1, 1]]
const score = (p: number[], r: number[]) => {
  const exact = p[0] === r[0] && p[1] === r[1]
  const out = Math.sign(p[0]! - p[1]!) === Math.sign(r[0]! - r[1]!)
  return { points: exact ? 5 : out ? 3 : 0, exact_hit: exact, outcome_hit: out, goal_error: Math.abs(p[0]! - r[0]!) + Math.abs(p[1]! - r[1]!), is_final: true }
}
const finishedMatches = finishedReal.map((r, i) => ({
  match_id: `m-fin-${i}`, position: i + 1, kickoff_at: iso(-6 * 24 * H + i * H), status: 'finished', status_detail: 'FT', elapsed: 90,
  home_goals: r[0], away_goals: r[1], result_confirmed: true, is_test_data: true,
  competition: { name: 'Liga de Prueba (datos ficticios)', logo_url: null },
  home: T[(i + 2) % 10], away: T[(i + 5) % 10],
  pick: { home: finishedPick[i]![0], away: finishedPick[i]![1] }, score: score(finishedPick[i]!, r),
}))
const finPoints = finishedMatches.reduce((a, m) => a + m.score.points, 0)

const rounds = [
  { round_id: 'r-open', name: 'Jornada 12', description: null, status: 'open', phase: 'open', opens_at: null, deadline_at: iso(26 * H + 14 * 60e3), finalized_at: null,
    match_count: 10, first_kickoff: iso(30 * H), last_kickoff: iso(48 * H), my_status: 'draft', my_items: 6, my_submitted_at: null,
    my_points: null, my_exact_hits: null, my_outcome_hits: null, my_position: null, players: null, is_official: false },
  { round_id: 'r-next', name: 'Jornada 13', description: null, status: 'open', phase: 'upcoming', opens_at: iso(5 * 24 * H), deadline_at: iso(7 * 24 * H), finalized_at: null,
    match_count: 9, first_kickoff: iso(8 * 24 * H), last_kickoff: iso(9 * 24 * H), my_status: 'none', my_items: 0, my_submitted_at: null,
    my_points: null, my_exact_hits: null, my_outcome_hits: null, my_position: null, players: null, is_official: false },
  { round_id: 'r-fin', name: 'Jornada 11', description: null, status: 'finished', phase: 'finished', opens_at: null, deadline_at: iso(-6 * 24 * H - H), finalized_at: iso(-4 * 24 * H),
    match_count: 10, first_kickoff: iso(-6 * 24 * H), last_kickoff: iso(-5 * 24 * H), my_status: 'submitted', my_items: 10, my_submitted_at: iso(-7 * 24 * H),
    my_points: finPoints, my_exact_hits: 4, my_outcome_hits: 7, my_position: 2, players: 8, is_official: true },
  { round_id: 'r-old', name: 'Jornada 10', description: null, status: 'finished', phase: 'finished', opens_at: null, deadline_at: iso(-13 * 24 * H), finalized_at: iso(-11 * 24 * H),
    match_count: 10, first_kickoff: iso(-12 * 24 * H), last_kickoff: iso(-12 * 24 * H), my_status: 'submitted', my_items: 10, my_submitted_at: iso(-14 * 24 * H),
    my_points: 21, my_exact_hits: 2, my_outcome_hits: 5, my_position: 4, players: 8, is_official: true },
]

const names = ['Alberto', 'Mariana R.', 'El Profe', 'Luis Ángel', 'Sofi', 'Chuy', 'Dani G.', 'Pau']
const leaderboard = names.map((n, i) => ({
  rank_position: i === 5 ? 5 : i + 1 - (i > 5 ? 0 : 0), user_id: i === 1 ? UID : `u-${i}`, display_name: i === 1 ? 'Alberto' : n, avatar_url: null,
  points: [74, 71, 66, 60, 55, 55, 48, 40][i], exact_hits: [9, 8, 7, 6, 5, 5, 4, 3][i], outcome_hits: [19, 19, 18, 16, 15, 15, 13, 11][i],
  goal_error: [18, 21, 22, 25, 30, 30, 34, 40][i], rounds_played: 4, scored_matches: 40, is_provisional: false, is_me: i === 1,
}))
leaderboard[0]!.display_name = 'Mariana R.'
leaderboard[5]!.rank_position = 5

const detail = (id: string) => {
  const isFin = id === 'r-fin' || id === 'r-old'
  const r = rounds.find((x) => x.round_id === id) ?? rounds[0]!
  return {
    round: { id, group_id: GID, name: r.name, description: null, status: r.status, phase: r.phase, opens_at: r.opens_at, deadline_at: r.deadline_at, finalized_at: r.finalized_at },
    server_time: new Date().toISOString(), max_goals: 15,
    prediction: isFin ? { id: 'p1', status: 'submitted', submitted_at: r.my_submitted_at, client_seq: 5, updated_at: iso(-7 * 24 * H) }
      : { id: 'p2', status: 'draft', submitted_at: null, client_seq: 3, updated_at: iso(-H) },
    matches: isFin ? finishedMatches : openMatches,
    summary: isFin
      ? { points: finPoints, exact_hits: 4, outcome_hits: 7, goal_error: 12, scored_matches: 10, position: 2, players: 8, is_official: true, max_possible: 50 }
      : { points: 0, exact_hits: 0, outcome_hits: 0, goal_error: 0, scored_matches: 0, position: null, players: 0, is_official: false, max_possible: 50 },
  }
}

const RPC: Record<string, (body: Record<string, unknown>) => unknown> = {
  get_server_time: () => JSON.stringify(new Date().toISOString()),
  get_app_config: () => ({ timezone: 'America/Mexico_City', max_goals: 15, payments_enabled: false, server_time: new Date().toISOString() }),
  get_my_groups: () => [{ group_id: GID, name: 'Los del Barrio', description: null, member_status: 'active', joined_at: iso(-60 * 24 * H), members_count: 8 }],
  get_my_rounds: () => rounds,
  get_round_detail: (b) => detail(String(b.p_round_id)),
  get_leaderboard: () => leaderboard,
  get_position_history: () => [
    { round_id: 'r-9', round_name: 'Jornada 9', deadline_at: iso(-20 * 24 * H), round_points: 18, round_position: 5, cumulative_points: 18, cumulative_position: 5, players: 8, is_official: true },
    { round_id: 'r-old', round_name: 'Jornada 10', deadline_at: iso(-13 * 24 * H), round_points: 21, round_position: 4, cumulative_points: 39, cumulative_position: 3, players: 8, is_official: true },
    { round_id: 'r-fin', round_name: 'Jornada 11', deadline_at: iso(-6 * 24 * H), round_points: finPoints, round_position: 2, cumulative_points: 71, cumulative_position: 2, players: 8, is_official: true },
  ],
  get_player_summary: () => ({ total_points: 71, position: 2, players: 8, exact_hits: 8, outcome_hits: 19, rounds_played: 4, is_provisional: false,
    last_round: { round_id: 'r-fin', name: 'Jornada 11', points: finPoints, position: 2, is_official: true } }),
  get_upcoming_matches: () => openMatches.slice(0, 4).map((m) => ({ ...m, round_id: 'r-open', round_name: 'Jornada 12' })),
  save_prediction_draft: (b) => ({ status: 'draft', applied: true, client_seq: b.p_client_seq, saved_at: new Date().toISOString(), items_count: 6 }),
  admin_dashboard_stats: () => ({ participants_total: 8, participants_active: 8, pending_approvals: 1, groups: 1, rounds_open: 1, rounds_draft: 1,
    predictions_submitted: 31, matches_pending_result: 0, sync_errors_24h: 0, server_time: new Date().toISOString(),
    last_sync: { id: 12, provider: 'mock', status: 'success', started_at: iso(-10 * 60e3), finished_at: iso(-10 * 60e3 + 3000), matches_checked: 10, matches_updated: 2, error_message: null } }),
}

export async function mockBackend(page: Page, opts: { admin?: boolean } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const session = {
    access_token: 'mock.jwt.token', token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: Math.floor(now / 1000) + 3600 * 24 * 365,
    refresh_token: 'mock-refresh', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'alberto@example.test', app_metadata: {}, user_metadata: {}, created_at: iso(-90 * 24 * H) },
  }
  await page.addInitScript((s) => {
    localStorage.setItem('sb-mock-project-auth-token', JSON.stringify(s))
  }, session)

  await page.route('https://mock-project.supabase.co/**', async (route: Route) => {
    const url = new URL(route.request().url())
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: typeof body === 'string' ? body : JSON.stringify(body) })
    if (url.pathname.startsWith('/auth/v1/user')) return json(session.user)
    if (url.pathname === '/functions/v1/provider-fixtures') {
      return json({ default_provider: 'mock', providers: [
        { id: 'api-football', is_test_data: false, configured: false, budget_daily: 90, usage: null, status: null },
        { id: 'mock', is_test_data: true, configured: true, budget_daily: null, usage: null, status: null },
      ] })
    }
    if (url.pathname.startsWith('/rest/v1/rpc/')) {
      const fn = url.pathname.split('/').pop()!
      const body = route.request().postDataJSON() ?? {}
      const h = RPC[fn]
      return h ? json(h(body)) : json({ message: `mock: ${fn} no simulado` }, 400)
    }
    if (url.pathname === '/rest/v1/profiles') {
      return json({ id: UID, display_name: 'Alberto', avatar_url: null, role: opts.admin ? 'admin' : 'player', status: 'active', created_at: iso(-90 * 24 * H) })
    }
    return json([])
  })
}
