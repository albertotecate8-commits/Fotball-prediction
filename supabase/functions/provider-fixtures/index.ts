// Búsqueda de partidos en el proveedor para que el admin los seleccione.
// Los partidos encontrados se guardan (upsert idempotente) con su id externo,
// pero NO se agregan a ninguna jornada: eso lo decide el admin.
// Acciones: status · calendar · competitions · teams · manual · search. Nunca devuelve la clave.
import { corsHeaders, json, requireAdmin, serviceClient } from '../_shared/http.deno.ts'
import { ApiFootballProvider, ProviderError, type FixtureSearch, type NormalizedFixture, type ProviderTeam } from '../_shared/football/index.ts'
import { linkManualMatch, type ManualInput } from '../_shared/manualLink.deno.ts'
import { refreshCalendar } from '../_shared/calendar.deno.ts'
import { defaultProviderId, loadPlanFlags, providerEnv, quotaState, realProviderConfigured, resolveProvider, savePlanFlags } from '../_shared/providers.deno.ts'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PROVIDERS = ['api-football', 'mock']

const errorStatus = (code: string) => (code === 'QUOTA_EXHAUSTED' || code === 'RATE_LIMITED' || code === 'BUDGET_BLOCKED' ? 429 : code === 'BAD_REQUEST' ? 400 : 502)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405)

  const db = serviceClient()
  const adminId = await requireAdmin(req, db)
  if (!adminId) return json(req, { error: 'FORBIDDEN' }, 403)

  let body: {
    action?: string; provider?: string; filters?: FixtureSearch
    manual?: ManualInput
    query?: string
  }
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'INVALID_JSON' }, 400)
  }

  const env = providerEnv()
  const today = new Date().toISOString().slice(0, 10)

  if (body.action === 'status') {
    const real = realProviderConfigured(env)
    const p = real ? resolveProvider(db, 'api-football') : null
    let status: unknown = null
    if (p) {
      // /status no cuenta para la cuota diaria, pero igual se limita: como mucho cada 10 min.
      const { data: cached } = await db.rpc('provider_cache_get', { p_provider: 'api-football', p_key: 'status' })
      if (cached) status = { ...cached, cached: true }
      else {
        ;(p as unknown as { context: unknown }).context = { priority: 5, purpose: 'contraste /status' }
        const s = await p.status()
        status = s
        if (s.ok) {
          await db.rpc('provider_cache_put', { p_provider: 'api-football', p_key: 'status', p_payload: s, p_ttl_seconds: 600 })
          if (s.requests_today !== null && s.requests_today !== undefined) {
            await db.rpc('provider_record_status', { p_provider: 'api-football', p_current: s.requests_today, p_limit: s.requests_limit ?? null })
          }
        }
      }
    }
    const quota = real ? await quotaState(db, 'api-football') : null
    return json(req, {
      default_provider: defaultProviderId(env),
      providers: [
        {
          id: 'api-football', is_test_data: false, configured: real,
          budget_daily: quota?.budget ?? 80,
          usage: quota ? { requests: quota.used, reported_remaining: (quota as unknown as { provider_remaining_estimate: number | null }).provider_remaining_estimate, reported_limit: null, last_request_at: null, last_error: null } : null,
          status,
        },
        { id: 'mock', is_test_data: true, configured: true, budget_daily: null, usage: null, status: null },
      ],
    })
  }

  if (body.action === 'calendar') {
    // «Buscar calendario ahora» (admin): no gasta cuota de API-Football; como mucho cada 10 min.
    try {
      const r = await refreshCalendar(db, { force: true })
      return json(req, 'skipped' in r ? { skipped: true, reason: 'RECENT' } : r)
    } catch (e) {
      return json(req, { error: 'CALENDAR_ERROR', message: (e as Error).message }, 502)
    }
  }

  const providerId = body.provider && PROVIDERS.includes(body.provider) ? body.provider : defaultProviderId(env)
  const provider = resolveProvider(db, providerId)
  if (!provider) return json(req, { error: 'NOT_CONFIGURED', provider: providerId }, 409)

  const cacheGet = async <T>(key: string) => {
    const { data } = await db.rpc('provider_cache_get', { p_provider: provider.id, p_key: key })
    return (data ?? null) as T | null
  }
  const cachePut = (key: string, payload: unknown, ttl: number) =>
    db.rpc('provider_cache_put', { p_provider: provider.id, p_key: key, p_payload: payload, p_ttl_seconds: ttl })

  // Consultas del panel: prioridad 5 (las primeras en bloquearse cuando queda poca cuota).
  ;(provider as unknown as { context: unknown }).context = { priority: 5, purpose: `admin:${body.action ?? 'buscar'}` }
  try {
    if (body.action === 'competitions') {
      let competitions = await cacheGet<unknown[]>('competitions')
      const cached = competitions !== null
      if (!competitions) {
        competitions = await provider.listCompetitions()
        if (!provider.isTestData) await cachePut('competitions', competitions, 24 * 3600)
      }
      return json(req, { provider: provider.id, is_test_data: provider.isTestData, cached, competitions })
    }

    if (body.action === 'teams') {
      // «Añadir equipo»: búsqueda oficial por nombre (1 solicitud, en caché 7 días por texto).
      if (!(provider instanceof ApiFootballProvider)) return json(req, { error: 'NOT_CONFIGURED', provider: provider.id }, 409)
      const q = (body.query ?? '').toString().normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, 40)
      if (q.length < 3 || !/^[\p{L}\p{N} .'&-]+$/u.test(q)) return json(req, { error: 'QUERY_TOO_SHORT' }, 400)
      const key = `teams:${q.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')}`
      let teams = await cacheGet<ProviderTeam[]>(key)
      const cached = teams !== null
      if (!teams) {
        teams = (await provider.searchTeams(q)).slice(0, 25)
        await cachePut(key, teams, 7 * 24 * 3600)
      }
      // Cuáles ya están en el catálogo (activos o retirados) para no duplicarlos.
      const ids = teams.map((t) => t.external_id)
      const { data: known } = ids.length
        ? await db.from('teams').select('id, external_id, retired_at').eq('provider', 'api-football').in('external_id', ids)
        : { data: [] as { id: string; external_id: string; retired_at: string | null }[] }
      const byId = new Map((known ?? []).map((k) => [k.external_id, k]))
      return json(req, {
        provider: provider.id, cached,
        teams: teams.map((t) => {
          const k = byId.get(t.external_id)
          return { ...t, catalog_id: k?.id ?? null, catalog_retired: k ? k.retired_at !== null : false }
        }),
      })
    }

    if (body.action === 'manual') {
      const r = await linkManualMatch(db, provider, body.manual ?? {}, adminId)
      return json(req, r, r.kind === 'invalid' ? 400 : 200)
    }

    const f = body.filters ?? {}
    if ((f.from && !DATE.test(f.from)) || (f.to && !DATE.test(f.to))) return json(req, { error: 'INVALID_DATE' }, 400)
    if (!provider.isTestData && !f.competitionId && !f.from) return json(req, { error: 'FILTER_REQUIRED' }, 400)

    // Si ya se sabe que el plan no cubre la temporada, se busca por días sin gastar una solicitud.
    await loadPlanFlags(db, provider)
    const query: FixtureSearch = {
      competitionId: f.competitionId?.toString().slice(0, 20) || undefined,
      season: f.season?.toString().slice(0, 9) || undefined,
      from: f.from, to: f.to,
      status: f.status,
    }
    const key = `fixtures:${JSON.stringify(query)}`
    let fixtures = provider.isTestData ? null : await cacheGet<NormalizedFixture[]>(key)
    const cached = fixtures !== null
    if (!fixtures) {
      fixtures = await provider.searchFixtures(query)
      await savePlanFlags(db, provider)
      // Rangos que incluyen hoy cambian más; el futuro lejano casi no.
      const touchesToday = (query.from ?? today) <= today && (query.to ?? query.from ?? today) >= today
      if (!provider.isTestData) await cachePut(key, fixtures.map(({ raw: _raw, ...rest }) => rest), touchesToday ? 1800 : 6 * 3600)
    }
    const team = f.team?.toString().slice(0, 60).trim().toLowerCase()
    const selected = fixtures
      .filter((x) => !team || x.home.name.toLowerCase().includes(team) || x.away.name.toLowerCase().includes(team))
      .slice(0, 150)

    const { data, error } = await db.rpc('upsert_provider_fixtures', { p_provider: provider.id, p_fixtures: selected, p_is_test_data: provider.isTestData })
    if (error) throw new Error(error.message)

    return json(req, { provider: provider.id, is_test_data: provider.isTestData, cached, match_ids: data.match_ids, inserted: data.inserted })
  } catch (e) {
    if (e instanceof ProviderError) return json(req, { error: e.code, message: e.message, provider: provider.id }, errorStatus(e.code))
    return json(req, { error: 'PROVIDER_ERROR', message: (e as Error).message }, 502)
  }
})
