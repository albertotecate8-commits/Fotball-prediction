import { afterAll, describe, expect, it } from 'vitest'
import { asService, asUser, createGroup, createMatch, createOpenRound, createUser, expectDbError, pool, sql } from './helpers'

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
