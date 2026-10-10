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
  pick: i < 6 ? { outcome: (['1', 'X', '2'] as const)[i % 3], home: null, away: null } : null, score: null,
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
  pick: { outcome: Math.sign(finishedPick[i]![0]! - finishedPick[i]![1]!) > 0 ? '1' : Math.sign(finishedPick[i]![0]! - finishedPick[i]![1]!) < 0 ? '2' : 'X', home: finishedPick[i]![0], away: finishedPick[i]![1] }, score: score(finishedPick[i]!, r),
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

// Destacados FICTICIOS (solo pruebas visuales): misma forma que get_featured_matches.
const featured = (n: number, status = 'scheduled', offsetH = 4) => ({
  provider: 'mock', external_id: `f-${n}`, kickoff_at: iso(offsetH * H + n * H), status, priority: 100 - n, reason: 'Liga de Prueba',
  refreshed_at: iso(-5 * 60e3), in_round_id: n === 1 ? 'r-open' : null, in_round_name: n === 1 ? 'Jornada 12' : null,
  data: { status_detail: status === 'live' ? '2H' : 'NS', elapsed: status === 'live' ? 63 : null, home_goals: status === 'live' ? 1 : null, away_goals: status === 'live' ? 0 : null,
    competition: { name: 'Liga de Prueba (datos ficticios)', country: null, logo_url: null },
    home: { name: `Local Ficticio ${n}`, short_name: `Local ${n}`, logo_url: null }, away: { name: `Visita Ficticia ${n}`, short_name: `Visita ${n}`, logo_url: null } },
})
export const FEATURED = [featured(1), featured(2), featured(3), featured(4, 'live', -2)]

// Quiniela continua FICTICIA: abiertos primero, luego terminados.
const poolOf = (paid: boolean) => ({
  server_time: new Date().toISOString(), max_goals: 15, can_submit: paid,
  matches: [
    ...finishedMatches.slice(0, 4).map((m, i) => ({ ...m, is_manual: i === 3, source: i === 3 ? 'admin' : 'auto', open: false, can_submit: false,
      pick: { ...m.pick, status: 'submitted', submitted_at: iso(-7 * 24 * H), updated_at: iso(-7 * 24 * H) } })),
    ...openMatches.map((m, i) => ({ ...m, is_manual: i === 9, source: i === 9 ? 'admin' : 'auto', open: true, can_submit: paid,
      pick: m.pick ? { ...m.pick, status: 'draft', submitted_at: null, updated_at: iso(-H) } : null })),
  ],
})
const adminPool = [...finishedMatches.slice(0, 2), ...openMatches.slice(0, 3)].map((m, i) => ({
  match_id: m.match_id, kickoff_at: m.kickoff_at, status: m.status, home_goals: m.home_goals, away_goals: m.away_goals, result_confirmed: i !== 1,
  result_source: i === 1 ? 'admin' : 'provider', provider: i === 1 || i === 4 ? 'manual' : 'mock', external_id: i === 1 || i === 4 ? null : `9000${i}`,
  pool_status: i === 3 ? 'withdrawn' : 'published', source: i === 1 || i === 4 ? 'admin' : 'auto', open: i >= 2 && i !== 3, closes_at: null, change_reason: null,
  competition: { id: 'c1', name: 'Liga de Prueba (datos ficticios)' }, home: { id: `t${i}`, ...m.home }, away: { id: `t${i + 5}`, ...m.away }, picks: 3 - (i % 3),
}))
adminPool[1]!.status = 'scheduled'; adminPool[1]!.home_goals = null; adminPool[1]!.away_goals = null; adminPool[1]!.result_confirmed = false

const RPC: Record<string, (body: Record<string, unknown>) => unknown> = {
  get_server_time: () => JSON.stringify(new Date().toISOString()),
  get_app_config: () => ({ timezone: 'America/Mexico_City', max_goals: 15, payments_enabled: false, server_time: new Date().toISOString() }),
  get_my_groups: () => [{ group_id: GID, name: 'Los del Barrio', description: null, member_status: 'active', joined_at: iso(-60 * 24 * H), members_count: 8 }],
  get_my_rounds: () => rounds,
  get_round_detail: (b) => detail(String(b.p_round_id)),
  get_leaderboard: () => leaderboard,
  get_pool_leaderboard: () => leaderboard,
  admin_pool_list: () => adminPool,
  // Plan semanal FICTICIO.
  admin_week_plans: () => [{ id: 'w1', week_start: iso(2 * 24 * H).slice(0, 10), week_end: iso(8 * 24 * H).slice(0, 10), label: 'Semana', max_matches: 12,
    team_ids: ['529', '541'], league_ids: ['262'], team_weekend_only: true, filled: 5, teams_found: ['529'] }],
  admin_plan_week: () => ({ id: 'w1', week_start: iso(2 * 24 * H).slice(0, 10), added_now: 0 }),
  // Bolsa FICTICIA.
  get_prize_pot: () => ({ pot: 1200, paid_count: 40, currency: 'MXN', configured: true }),
  get_pool_week: () => ({ label: 'Semana', week_start: iso(2 * 24 * H).slice(0, 10), week_end: iso(8 * 24 * H).slice(0, 10), max_matches: 12, filled: 5 }),
  get_results_freshness: () => ({ updated_at: iso(-4 * 60e3), delayed: false }),
  // Consumo FICTICIO para la prueba visual del panel.
  admin_api_usage: () => ({
    usage_date: iso(0).slice(0, 10), budget: 80, margin: 20, used: 37, remaining_internal: 43, effective_remaining: 43,
    provider_remaining_estimate: 61, provider_reported_at: iso(-6 * 60e3), provider_limit: 100, provider_current: null, provider_checked_at: null,
    external_usage: false, paused: false, paused_until: null, pause_reason: null, blocked: 2, succeeded: 35, failed: 2, cache_hits: 140,
    status: 'normal', last_success_sync: iso(-3 * 60e3), live_matches: 2, live_featured: 1, server_time: new Date().toISOString(),
    history: [{ usage_date: iso(0).slice(0, 10), requests: 37, blocked: 2, failed: 2, cache_hits: 140 }, { usage_date: iso(-24 * H).slice(0, 10), requests: 71, blocked: 9, failed: 1, cache_hits: 610 }],
    recent: [
      { at: iso(-3 * 60e3), priority: 1, purpose: 'en vivo', endpoint: '/fixtures?live=all&timezone=UTC', counted: true, outcome: 'success', reason: null, http: 200, ms: 310, results: 12, error: null },
      { at: iso(-9 * 60e3), priority: 3, purpose: 'calendario de mañana', endpoint: '/fixtures?date=2026-10-11&timezone=UTC', counted: false, outcome: 'blocked', reason: 'LOW_BUDGET_P3', http: null, ms: null, results: null, error: null },
      { at: iso(-15 * 60e3), priority: 1, purpose: 'en vivo', endpoint: '/fixtures?live=all&timezone=UTC', counted: true, outcome: 'rate_limited', reason: null, http: 429, ms: 120, results: null, error: 'API-Football: demasiadas solicitudes (HTTP 429)' },
    ],
  }),
  admin_search_teams: () => T.slice(0, 3).map((t, i) => ({ id: `t${i}`, name: t.name, short_name: t.short_name, logo_url: null, provider: 'manual', external_id: null })),
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

export async function mockBackend(page: Page, opts: { admin?: boolean; featured?: unknown[]; noGroup?: boolean; paid?: boolean; calls?: string[]; payInfo?: boolean } = {}) {
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
      opts.calls?.push(fn)
      if (fn === 'get_featured_matches') return json(opts.featured ?? FEATURED)
      if (fn === 'save_quiniela') {
        const items = (body.p_items as { outcome: string | null }[]) ?? []
        return json({ status: 'draft', saved_at: new Date().toISOString(), picks: items.filter((x) => x.outcome).length, total: items.length, can_submit: opts.paid ?? true, client_seq: body.p_client_seq })
      }
      if (fn === 'submit_quiniela') {
        if (!(opts.paid ?? true)) return json({ code: 'P0001', message: 'PAYMENT_REQUIRED' }, 400)
        return json({ status: 'submitted', already_submitted: false, submitted_at: new Date().toISOString() })
      }
      if (fn === 'get_my_payment') {
        const paid = opts.paid ?? true
        // Datos de pago FICTICIOS para la prueba visual.
        return json(opts.payInfo
          ? { configured: true, bank: 'Banco de Prueba', holder: 'Titular Ficticio', clabe: '000000000000000000', account: null, amount: 100, currency: 'MXN', concept: 'Quiniela', instructions: 'Instrucciones de prueba', contact: null, reference: 'SHX-ABC123', payment_status: paid ? 'authorized' : 'not_applicable', valid_until: null }
          : { configured: false, bank: null, holder: null, clabe: null, account: null, amount: null, currency: 'MXN', concept: null, instructions: null, contact: null, reference: 'SHX-ABC123', payment_status: paid ? 'authorized' : 'not_applicable', valid_until: null })
      }
      if (fn === 'admin_payments') return json([{ user_id: UID, display_name: 'Alberto', email: 'alberto@example.test', reference: 'SHX-ABC123', payment_status: 'not_applicable', valid_until: null, payment_reference: null, confirmed_at: null, confirmed_by: null, joined_at: iso(-90 * 24 * H) }])
      if (fn === 'get_my_participation') {
        const paid = opts.paid ?? true
        return json({ requires_payment: true, payment_status: paid ? 'authorized' : 'not_applicable', valid_until: null, can_participate: paid })
      }
      if (fn === 'get_my_groups' && opts.noGroup) return json([])
      if (fn === 'am_i_admin') return json(!!opts.admin)
      if (fn === 'get_pool') {
        const d = poolOf(opts.paid ?? true)
        return json(opts.noGroup ? { ...d, matches: [] } : d)
      }
      if (fn === 'save_pool_picks') return json({ saved: ((body.p_items as unknown[]) ?? []).length, closed: 0, already_submitted: 0, saved_at: new Date().toISOString() })
      if (fn === 'submit_pool_picks') {
        if (!(opts.paid ?? true)) return json({ code: 'P0001', message: 'PAYMENT_REQUIRED' }, 400)
        return json({ submitted: ((body.p_items as unknown[]) ?? []).length, closed: 0, already_submitted: 0 })
      }
      const h = RPC[fn]
      return h ? json(h(body)) : json({ message: `mock: ${fn} no simulado` }, 400)
    }
    if (url.pathname === '/rest/v1/profiles') {
      return json({ id: UID, display_name: 'Alberto', avatar_url: null, role: opts.admin ? 'admin' : 'player', status: 'active', created_at: iso(-90 * 24 * H) })
    }
    return json([])
  })
}
