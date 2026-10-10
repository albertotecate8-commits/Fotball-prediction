// Búsqueda de partidos en el proveedor para que el admin los seleccione.
// Los partidos encontrados se guardan (upsert idempotente) con su id externo,
// pero NO se agregan a ninguna jornada: eso lo decide el admin.
// Acciones: status · competitions · search. Nunca devuelve la clave.
import { corsHeaders, json, requireAdmin, serviceClient } from '../_shared/http.deno.ts'
import { ProviderError, type FixtureSearch, type NormalizedFixture } from '../_shared/football/index.ts'
import { linkManualMatch, type ManualInput } from '../_shared/manualLink.deno.ts'
import { defaultProviderId, loadPlanFlags, providerEnv, QUOTA, realProviderConfigured, resolveProvider, savePlanFlags } from '../_shared/providers.deno.ts'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const PROVIDERS = ['api-football', 'mock']

const errorStatus = (code: string) => (code === 'QUOTA_EXHAUSTED' || code === 'RATE_LIMITED' ? 429 : code === 'BAD_REQUEST' ? 400 : 502)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405)

  const db = serviceClient()
  const adminId = await requireAdmin(req, db)
  if (!adminId) return json(req, { error: 'FORBIDDEN' }, 403)

  let body: {
    action?: string; provider?: string; filters?: FixtureSearch
    manual?: ManualInput
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
    const { data: usage } = await db.from('provider_usage').select('provider, requests, reported_remaining, reported_limit, last_request_at, last_error')
      .eq('usage_date', today)
    const p = real ? resolveProvider(db, 'api-football') : null
    return json(req, {
      default_provider: defaultProviderId(env),
      providers: [
        {
          id: 'api-football', is_test_data: false, configured: real,
          budget_daily: QUOTA['api-football']!.daily,
          usage: usage?.find((u) => u.provider === 'api-football') ?? null,
          status: p ? await p.status() : null,
        },
        { id: 'mock', is_test_data: true, configured: true, budget_daily: null, usage: null, status: null },
      ],
    })
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
