// Búsqueda de partidos en el proveedor para que el admin los seleccione.
// Los partidos encontrados se guardan (upsert idempotente) con su id externo.
import { corsHeaders, json, requireAdmin, serviceClient } from '../_shared/http.deno.ts'
import { createProvider, type FixtureSearch } from '../_shared/football/index.ts'

const DATE = /^\d{4}-\d{2}-\d{2}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405)

  const db = serviceClient()
  const adminId = await requireAdmin(req, db)
  if (!adminId) return json(req, { error: 'FORBIDDEN' }, 403)

  let body: { action?: string; filters?: FixtureSearch }
  try {
    body = await req.json()
  } catch {
    return json(req, { error: 'INVALID_JSON' }, 400)
  }

  let provider
  try {
    provider = createProvider({ FOOTBALL_PROVIDER: Deno.env.get('FOOTBALL_PROVIDER'), API_FOOTBALL_KEY: Deno.env.get('API_FOOTBALL_KEY') })
  } catch (e) {
    return json(req, { error: 'PROVIDER_NOT_CONFIGURED', message: (e as Error).message }, 500)
  }

  try {
    if (body.action === 'competitions') {
      return json(req, { provider: provider.id, is_test_data: provider.isTestData, competitions: await provider.listCompetitions() })
    }

    const f = body.filters ?? {}
    if ((f.from && !DATE.test(f.from)) || (f.to && !DATE.test(f.to))) return json(req, { error: 'INVALID_DATE' }, 400)
    if (provider.id === 'api-football' && !f.competitionId && !f.from) return json(req, { error: 'FILTER_REQUIRED' }, 400)

    const fixtures = (await provider.searchFixtures({
      competitionId: f.competitionId?.toString().slice(0, 20),
      season: f.season?.toString().slice(0, 9),
      from: f.from, to: f.to,
      team: f.team?.toString().slice(0, 60),
      status: f.status,
    })).slice(0, 150)

    const { data, error } = await db.rpc('upsert_provider_fixtures', { p_provider: provider.id, p_fixtures: fixtures, p_is_test_data: provider.isTestData })
    if (error) throw new Error(error.message)

    return json(req, { provider: provider.id, is_test_data: provider.isTestData, match_ids: data.match_ids, inserted: data.inserted })
  } catch (e) {
    return json(req, { error: 'PROVIDER_ERROR', message: (e as Error).message }, 502)
  }
})
