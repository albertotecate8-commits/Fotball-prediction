import { afterAll, describe, expect, it } from 'vitest'
import { asAnon, asService, asUser, createGroup, createMatch, createOpenRound, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

const take = async (provider: string, daily = 3, minute = 100, reserve = 0) =>
  (await asService(`select public.provider_take_quota($1, $2, $3, $4) as r`, [provider, daily, minute, reserve]))[0]!.r

describe('cuota del proveedor', () => {
  it('respeta el presupuesto diario propio', async () => {
    const p = `p-${Date.now()}-a`
    const results = [await take(p), await take(p), await take(p), await take(p)]
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false])
    expect(results[3]).toMatchObject({ reason: 'DAILY_BUDGET', used: 3 })
  })

  it('respeta el límite por minuto', async () => {
    const p = `p-${Date.now()}-b`
    const r = [await take(p, 100, 2), await take(p, 100, 2), await take(p, 100, 2)]
    expect(r.map((x) => x.allowed)).toEqual([true, true, false])
    expect(r[2]!.reason).toBe('MINUTE_BUDGET')
  })

  it('si el proveedor informa pocas solicitudes restantes, se detiene antes de agotarlas', async () => {
    const p = `p-${Date.now()}-c`
    await asService(`select public.provider_report_quota($1, 4, 100, null)`, [p])
    expect(await take(p, 90, 10, 5)).toMatchObject({ allowed: false, reason: 'PROVIDER_QUOTA_LOW' })
    const [u] = await sql(`select reported_remaining, reported_limit from public.provider_usage where provider = $1`, [p])
    expect(u).toMatchObject({ reported_remaining: 4, reported_limit: 100 })
  })

  it('consultas simultáneas no superan el presupuesto', async () => {
    const p = `p-${Date.now()}-d`
    const all = await Promise.all(Array.from({ length: 12 }, () => take(p, 5)))
    expect(all.filter((r) => r.allowed)).toHaveLength(5)
    const [u] = await sql(`select requests from public.provider_usage where provider = $1`, [p])
    expect(u!.requests).toBe(5)
  })
})

describe('caché y candado', () => {
  it('la caché devuelve datos vigentes y descarta los vencidos', async () => {
    await asService(`select public.provider_cache_put('t', 'k1', '{"a":1}'::jsonb, 600)`)
    expect((await asService(`select public.provider_cache_get('t', 'k1') as v`))[0]!.v).toEqual({ a: 1 })
    await sql(`update public.provider_cache set expires_at = now() - interval '1 second' where provider = 't' and cache_key = 'k1'`)
    expect((await asService(`select public.provider_cache_get('t', 'k1') as v`))[0]!.v).toBeNull()
  })

  it('solo una sincronización a la vez; el candado vence solo', async () => {
    const name = `lease-${Date.now()}`
    const a = (await asService(`select public.acquire_sync_lease($1, 'A', 60) as ok`, [name]))[0]!.ok
    const b = (await asService(`select public.acquire_sync_lease($1, 'B', 60) as ok`, [name]))[0]!.ok
    expect([a, b]).toEqual([true, false])
    await asService(`select public.release_sync_lease($1, 'A')`, [name])
    expect((await asService(`select public.acquire_sync_lease($1, 'B', 60) as ok`, [name]))[0]!.ok).toBe(true)
    await sql(`update public.sync_leases set expires_at = now() - interval '1 second' where name = $1`, [name])
    expect((await asService(`select public.acquire_sync_lease($1, 'C', 60) as ok`, [name]))[0]!.ok).toBe(true)
  })

  it('los jugadores no pueden usar la cuota, la caché ni el candado', async () => {
    const u = await createUser()
    await expectDbError(asUser(u, `select public.provider_take_quota('x', 1, 1, 0)`), 'permission denied')
    await expectDbError(asUser(u, `select public.provider_cache_get('t', 'k1')`), 'permission denied')
    await expectDbError(asUser(u, `select * from public.provider_cache`), 'permission denied')
    await expectDbError(asUser(u, `select public.acquire_sync_lease('x', 'y', 10)`), 'permission denied')
    expect(await asUser(u, `select * from public.provider_usage`)).toEqual([])
  })
})

describe('frecuencia adaptativa', () => {
  const nextIn = async (id: string) =>
    Number((await sql(`select extract(epoch from next_sync_at - now()) / 60 as m from public.matches where id = $1`, [id]))[0]!.m)

  it('futuro lejano: una vez al día; en vivo: cada 10 min; confirmado: cada 6 h', async () => {
    const m = await createMatch('5 days')
    expect(await nextIn(m)).toBeGreaterThan(23 * 60)
    await sql(`update public.matches set status = 'live', last_synced_at = now() where id = $1`, [m])
    expect(await nextIn(m)).toBeCloseTo(10, 0)
    await sql(`update public.matches set status = 'finished', home_goals = 1, away_goals = 0, result_confirmed = true, confirmed_at = now(), last_synced_at = now() + interval '1 second' where id = $1`, [m])
    expect(await nextIn(m)).toBeCloseTo(360, 0)
  })

  it('a menos de 24 h revisa cada 3 h sin pasar del inicio', async () => {
    const m = await createMatch('2 hours')
    expect(await nextIn(m)).toBeCloseTo(120, 0)
    const n = await createMatch('20 hours')
    expect(await nextIn(n)).toBeCloseTo(180, 0)
  })

  it('errores repetidos: espera progresiva 10, 20, 40 min', async () => {
    const m = await createMatch('-5 minutes')
    const waits: number[] = []
    for (let i = 0; i < 3; i++) {
      await asService(`select public.record_match_sync_error($1, 'NOT_RETURNED_BY_PROVIDER')`, [m])
      waits.push(Math.round(await nextIn(m)))
    }
    expect(waits).toEqual([10, 20, 40])
    const [r] = await sql(`select sync_failures from public.matches where id = $1`, [m])
    expect(r!.sync_failures).toBe(3)
  })

  it('get_sync_targets omite los partidos que aún no toca consultar', async () => {
    const g = await createGroup([])
    const round = await createOpenRound(g, 2)
    const [due, later] = round.matchIds as [string, string]
    await sql(`update public.matches set next_sync_at = now() - interval '1 minute' where id = $1`, [due])
    await sql(`update public.matches set next_sync_at = now() + interval '5 hours' where id = $1`, [later])
    const ids = (await asService(`select match_id from public.get_sync_targets(15)`)).map((t) => t.match_id)
    expect(ids).toContain(due)
    expect(ids).not.toContain(later)
  })
})

describe('datos reales y de prueba', () => {
  it('una jornada no mezcla partidos reales con partidos de prueba', async () => {
    const g = await createGroup([])
    const round = await createOpenRound(g, 1, { status: 'draft' })
    const real = await createMatch()
    await sql(`update public.matches set is_test_data = false where id = $1`, [real])
    await expectDbError(sql(`insert into public.round_matches (round_id, match_id, position) values ($1, $2, 2)`, [round.roundId, real]), 'MIXED_TEST_DATA')
    const other = await createMatch()
    await sql(`insert into public.round_matches (round_id, match_id, position) values ($1, $2, 2)`, [round.roundId, other])
  })
})

describe('historial de resultados al importar', () => {
  it('un partido importado ya terminado queda en match_results una sola vez', async () => {
    const fx = [{
      external_id: `hist-${Date.now()}`, kickoff_at: new Date(Date.now() - 3 * 3600e3).toISOString(), status: 'finished', home_goals: 2, away_goals: 0,
      home: { external_id: 'H9', name: 'Local Real', short_name: 'Local' }, away: { external_id: 'A9', name: 'Visita Real', short_name: 'Visita' },
    }]
    const [a] = await asService(`select public.upsert_provider_fixtures('api-football', $1::jsonb, false) as r`, [JSON.stringify(fx)])
    await asService(`select public.upsert_provider_fixtures('api-football', $1::jsonb, false) as r`, [JSON.stringify(fx)])
    const rows = await sql(`select status, home_goals, away_goals, is_final, source from public.match_results where match_id = $1`, [a!.r.match_ids[0]])
    expect(rows).toEqual([{ status: 'finished', home_goals: 2, away_goals: 0, is_final: true, source: 'provider' }])
  })
})

describe('partidos manuales sin proveedor', () => {
  it('se crean solo vía servicio, sin duplicados y auditados', async () => {
    const k = '2026-11-01T02:00:00Z'
    const [a] = await asService(`select public.create_manual_match('Alacranes de Durango', 'Club Prueba Manual', $1, 'Liga Premier', null) as r`, [k])
    const [b] = await asService(`select public.create_manual_match('alacranes  de DURANGO', 'Club Prueba Manual', $1::timestamptz + interval '2 hours', 'Liga Premier', null) as r`, [k])
    expect(a!.r.created).toBe(true)
    expect(b!.r).toEqual({ match_id: a!.r.match_id, created: false })
    const [m] = await sql(`select provider, result_source, is_test_data from public.matches where id = $1`, [a!.r.match_id])
    expect(m).toEqual({ provider: 'manual', result_source: 'admin', is_test_data: false })
    const logs = await sql(`select 1 from public.audit_logs where action = 'match.manual_created' and entity_id = $1`, [a!.r.match_id])
    expect(logs).toHaveLength(1)
    // El sincronizador nunca los consulta al proveedor.
    const targets = await asService(`select match_id from public.get_sync_targets(60)`)
    expect(targets.map((t) => t.match_id)).not.toContain(a!.r.match_id)
    const u = await createUser()
    await expectDbError(asUser(u, `select public.create_manual_match('A1', 'B1', now(), null, null)`), 'permission denied')
    await expectDbError(asService(`select public.create_manual_match('Mismo', 'mismo', now(), null, null)`), 'INVALID_MATCH')
  })
})

describe('vinculación automática de partidos manuales', () => {
  it('convierte el partido manual en el del proveedor conservando id, jornada y pronósticos', async () => {
    const kickoff = new Date(Date.now() + 5 * 3600e3).toISOString()
    const [c] = await asService(`select public.create_manual_match('Querétaro', 'Atlante', $1, 'Liga MX', null) as r`, [kickoff])
    const id = c!.r.match_id as string
    const g = await createGroup([])
    const [r] = await sql(`insert into public.rounds (group_id, name, status, deadline_at) values ($1, 'J manual', 'draft', now() + interval '1 hour') returning id`, [g])
    await sql(`insert into public.round_matches (round_id, match_id, position) values ($1, $2, 1)`, [r!.id, id])

    const cands = await asService(`select * from public.get_link_candidates(1, 1)`)
    expect(cands.map((x) => x.match_id)).toContain(id)

    const fx = {
      external_id: `af-${Date.now()}`, kickoff_at: new Date(Date.parse(kickoff) + 3600e3).toISOString(), status: 'scheduled', status_detail: 'NS',
      competition: { external_id: '262', name: 'Liga MX' },
      home: { external_id: '2282', name: 'Club Queretaro' }, away: { external_id: '9999', name: 'Atlante FC' },
    }
    const [l] = await asService(`select public.link_manual_match($1, 'api-football', $2::jsonb) as r`, [id, JSON.stringify(fx)])
    expect(l!.r).toEqual({ linked: true })
    const [m] = await sql(`select provider, external_id, result_source, kickoff_at from public.matches where id = $1`, [id])
    expect(m).toMatchObject({ provider: 'api-football', external_id: fx.external_id, result_source: 'provider' })
    expect(new Date(m!.kickoff_at).toISOString()).toBe(fx.kickoff_at)
    const [rm] = await sql(`select count(*)::int n from public.round_matches where round_id = $1 and match_id = $2`, [r!.id, id])
    expect(rm!.n).toBe(1)
    expect(await sql(`select 1 from public.audit_logs where action = 'match.manual_auto_linked' and entity_id = $1`, [id])).toHaveLength(1)

    // Ya no es candidato y otro manual con el mismo id externo no genera duplicado.
    expect((await asService(`select * from public.get_link_candidates(1, 1)`)).map((x) => x.match_id)).not.toContain(id)
    const [c2] = await asService(`select public.create_manual_match('Querétaro FC', 'Atlante', $1, null, null) as r`, [kickoff])
    const [l2] = await asService(`select public.link_manual_match($1, 'api-football', $2::jsonb) as r`, [c2!.r.match_id, JSON.stringify(fx)])
    expect(l2!.r).toMatchObject({ linked: false, reason: 'ALREADY_IMPORTED', existing_match_id: id })
  })

  it('respeta el resultado que el admin ya registró', async () => {
    const kickoff = new Date(Date.now() - 3 * 3600e3).toISOString()
    const [c] = await asService(`select public.create_manual_match('Local Admin', 'Visita Admin', $1, null, null) as r`, [kickoff])
    const id = c!.r.match_id as string
    await sql(`update public.matches set status = 'finished', home_goals = 2, away_goals = 0, result_confirmed = true, confirmed_at = now() where id = $1`, [id])
    const fx = { external_id: `af2-${Date.now()}`, kickoff_at: kickoff, status: 'finished', home_goals: 1, away_goals: 1, home: { external_id: 'x1', name: 'Local Admin' }, away: { external_id: 'x2', name: 'Visita Admin' } }
    await asService(`select public.link_manual_match($1, 'api-football', $2::jsonb)`, [id, JSON.stringify(fx)])
    const [m] = await sql(`select result_source, home_goals, away_goals from public.matches where id = $1`, [id])
    expect(m).toEqual({ result_source: 'admin', home_goals: 2, away_goals: 0 })
  })

  it('los jugadores no pueden vincular', async () => {
    const u = await createUser()
    await expectDbError(asUser(u, `select * from public.get_link_candidates(1, 1)`), 'permission denied')
  })
})

describe('partidos destacados', () => {
  const item = (id: string, status = 'scheduled', priority = 50) => ({
    external_id: id, kickoff_at: new Date(Date.now() + 3600e3).toISOString(), status, priority, reason: 'Liga MX',
    data: { home: { name: 'Local Real' }, away: { name: 'Visita Real' }, competition: { name: 'Liga MX' } },
  })

  it('los jugadores los leen sin acceso directo a la tabla, y no se agregan a ninguna jornada', async () => {
    const p = `feat-${Date.now()}`
    await asService(`select public.upsert_featured_fixtures($1, $2::jsonb)`, [p, JSON.stringify([item('a1'), item('a2', 'live', 10)])])
    const u = await createUser()
    const rows = (await asUser(u, `select * from public.get_featured_matches(30)`)).filter((r) => r.provider === p)
    expect(rows.map((r) => r.external_id)).toEqual(['a2', 'a1'])
    expect(rows.every((r) => r.in_round_id === null)).toBe(true)
    await expectDbError(asUser(u, `select * from public.featured_fixtures`), 'permission denied')
    await expectDbError(asUser(u, `select public.upsert_featured_fixtures('x', '[]')`), 'permission denied')
    await expectDbError(asAnon(`select * from public.get_featured_matches(5)`), 'permission denied')
  })

  it('lo que deja de venir en la selección caduca sin borrarse', async () => {
    const p = `feat2-${Date.now()}`
    await asService(`select public.upsert_featured_fixtures($1, $2::jsonb)`, [p, JSON.stringify([item('b1'), item('b2')])])
    await asService(`select public.upsert_featured_fixtures($1, $2::jsonb)`, [p, JSON.stringify([item('b2')])])
    const u = await createUser()
    const rows = (await asUser(u, `select external_id from public.get_featured_matches(30)`)).map((r) => r.external_id)
    expect(rows).toContain('b2')
    expect(rows).not.toContain('b1')
    expect(await sql(`select 1 from public.featured_fixtures where provider = $1`, [p])).toHaveLength(2)
  })
})
