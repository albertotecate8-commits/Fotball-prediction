// Sincroniza estados y resultados de los partidos incluidos en jornadas.
// Invocación: pg_cron (cabecera x-sync-secret) o un admin desde el panel.
// Un candado impide dos sincronizaciones simultáneas (cron + botón).
import { corsHeaders, json, requireAdmin, safeEqual, serviceClient } from '../_shared/http.deno.ts'
import { providerEnv, realProviderConfigured, resolveProvider } from '../_shared/providers.deno.ts'
import { runAllProviders, type SyncStore } from '../_shared/football/sync.ts'

const LEASE = 'sync-results'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405)

  const db = serviceClient()
  // El cron envía el secreto guardado en Vault; también se acepta SYNC_SECRET del entorno.
  const presented = req.headers.get('x-sync-secret') ?? ''
  let viaCron = safeEqual(presented, Deno.env.get('SYNC_SECRET') ?? '')
  if (!viaCron && presented.length >= 32) {
    const { data } = await db.rpc('verify_sync_secret', { p_secret: presented })
    viaCron = data === true
  }
  const adminId = viaCron ? null : await requireAdmin(req, db)
  if (!viaCron && !adminId) return json(req, { error: 'FORBIDDEN' }, 403)

  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw new Error(`${fn}: ${error.message}`)
    return data as T
  }

  let body: { diagnose?: boolean; league?: string; date?: string } = {}
  try { body = await req.json() } catch { /* cuerpo vacío */ }

  // Diagnóstico acotado (solo cron/servidor o admin): estado de la cuenta
  // (no consume cuota), cobertura de una liga y sus próximos partidos.
  // Máximo 2 solicitudes con caché; nada se guarda en partidos ni jornadas.
  if (body.diagnose) {
    const configured = realProviderConfigured(providerEnv())
    const p = configured ? resolveProvider(db, 'api-football') : null
    if (!p) return json(req, { api_football_configured: false })
    const league = /^\d{1,6}$/.test(body.league ?? '') ? body.league! : '262'
    const out: Record<string, unknown> = { api_football_configured: true, status: await p.status() }
    if (/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '')) {
      // Un día concreto, todas las ligas: 1 solicitud.
      try {
        const fx = await p.searchFixtures({ from: body.date })
        const inLeague = fx.filter((f) => f.competition?.external_id === league)
        out.date = body.date
        out.fixtures_on_date = fx.length
        out.league_fixtures_on_date = inLeague.length
        out.sample = (inLeague.length ? inLeague : fx).slice(0, 5).map((f) => ({ id: f.external_id, league: f.competition?.name, status: f.status, match: `${f.home.name} vs ${f.away.name}` }))
      } catch (e) {
        out.error = `${(e as { code?: string }).code ?? 'ERROR'}: ${(e as Error).message}`
      }
      return json(req, out)
    }
    try {
      const { data: cached } = await db.rpc('provider_cache_get', { p_provider: p.id, p_key: 'competitions' })
      const comps = (cached as { external_id: string; name: string; country: string | null; season: string | null }[] | null) ?? await p.listCompetitions()
      if (!cached) await db.rpc('provider_cache_put', { p_provider: p.id, p_key: 'competitions', p_payload: comps, p_ttl_seconds: 86400 })
      const c = comps.find((x) => x.external_id === league)
      out.competitions_available = comps.length
      out.league = c ?? null
      if (c?.season) {
        const from = new Date().toISOString().slice(0, 10)
        const to = new Date(Date.now() + 21 * 86400e3).toISOString().slice(0, 10)
        const fx = await p.searchFixtures({ competitionId: league, season: c.season, from, to })
        out.fixtures_next_21_days = fx.length
        out.sample = fx.slice(0, 5).map((f) => ({ id: f.external_id, kickoff_at: f.kickoff_at, status: f.status, match: `${f.home.name} vs ${f.away.name}` }))
      }
    } catch (e) {
      out.error = e instanceof Error ? `${(e as { code?: string }).code ?? 'ERROR'}: ${e.message}` : String(e)
    }
    const { data: usage } = await db.from('provider_usage').select('requests, reported_remaining, reported_limit, last_error')
      .eq('provider', 'api-football').eq('usage_date', new Date().toISOString().slice(0, 10)).maybeSingle()
    out.usage_today = usage
    return json(req, out)
  }

  const holder = crypto.randomUUID()
  const got = await rpc<boolean>('acquire_sync_lease', { p_name: LEASE, p_holder: holder, p_seconds: 120 }).catch(() => false)
  if (!got) return json(req, { status: 'skipped', reason: 'SYNC_IN_PROGRESS' }, 409)

  const store: SyncStore = {
    getTargets: () => rpc('get_sync_targets', { p_horizon_minutes: 15 }),
    applyUpdate: (matchId, fixture) => rpc('apply_provider_update', { p_match_id: matchId, p_update: fixture }),
    recordError: async (matchId, message) => { await rpc('record_match_sync_error', { p_match_id: matchId, p_error: message }) },
    startRun: (p, trigger) => rpc('start_sync_run', { p_provider: p, p_trigger: trigger }),
    finishRun: async (id, r) => {
      await rpc('finish_sync_run', { p_run_id: id, p_status: r.status, p_checked: r.checked, p_updated: r.updated, p_error: r.error, p_details: r.details })
    },
    runMaintenance: () => rpc('run_maintenance', {}),
  }

  let result
  try {
    result = await runAllProviders(store, (id) => resolveProvider(db, id), viaCron ? 'cron' : 'manual')
  } catch (e) {
    return json(req, { error: 'SYNC_FAILED', message: (e as Error).message }, 500)
  } finally {
    await db.rpc('release_sync_lease', { p_name: LEASE, p_holder: holder })
  }
  if (adminId) {
    await db.from('audit_logs').insert({
      actor_id: adminId, action: 'sync.manual_run', entity_type: 'sync_run', entity_id: result.reports.map((r) => r.runId).join(',') || null,
      details: { statuses: result.reports.map((r) => `${r.provider}:${r.status}`), unconfigured: result.unconfigured },
    })
  }
  const failed = result.reports.length > 0 && result.reports.every((r) => r.status === 'error')
  return json(req, result, failed ? 502 : 200)
})
