import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS con ids numéricos que no usa ninguna otra prueba.
const ko = (days: number, hh = 18) => { const d = new Date(Date.now() + days * 86400000); d.setUTCHours(hh, 0, 0, 0); return d.toISOString() }
const ev = (id: string, h: string, a: string, kickoff: string) => ({ external_id: id, kickoff_at: kickoff, status: 'scheduled',
  competition: { external_id: '140', name: 'La Liga' }, home: { external_id: h, name: `Dup ${h}` }, away: { external_id: a, name: `Dup ${a}` } })
const cal = (list: unknown[]) => asService(`select public.calendar_import($1::jsonb) as r`, [JSON.stringify(list)])
const teamId = async (ext: string) => ((await sql(`select id from public.teams where provider = 'api-football' and external_id = $1`, [ext])) as { id: string }[])[0]!.id
const count = async (h: string, a: string) => ((await sql(`select count(*)::int as n from public.matches where home_team_id = $1 and away_team_id = $2`, [h, a])) as { n: number }[])[0]!.n

describe('nunca partidos duplicados', () => {
  let admin: string
  beforeAll(async () => {
    admin = await createAdmin()
    // Crea los equipos oficiales con un partido distinto (otro rival).
    await cal([ev('991001', '66001', '66009', ko(40)), ev('991002', '66002', '66008', ko(41)), ev('991003', '66003', '66007', ko(42)), ev('991004', '66004', '66006', ko(43))])
  })

  it('calendario adelantado: si el admin ya lo agregó a mano, usa ese mismo partido', async () => {
    const [h, a] = [await teamId('66001'), await teamId('66002')]
    const [c] = await asUser(admin, `select public.admin_create_pool_match($1, $2, $3, null, 'La Liga') as r`, [h, a, ko(20)])
    const manual = c!.r.match_id
    const [r] = await cal([ev('991010', '66001', '66002', ko(20, 20))]) // 2 h de diferencia
    expect(r!.r).toMatchObject({ new_matches: 0, linked_manual: 1 })
    expect(await count(h, a)).toBe(1)
    const [m] = await sql(`select id, provider, external_id from public.matches where external_id = '991010'`)
    expect(m).toEqual({ id: manual, provider: 'api-football', external_id: '991010' })
    const [log] = await sql(`select action from public.audit_logs where entity_id = $1 and action = 'match.manual_linked'`, [manual])
    expect(log).toBeTruthy()
  })

  it('sincronización de API-Football: también adopta el manual', async () => {
    const [h, a] = [await teamId('66003'), await teamId('66004')]
    const [c] = await asUser(admin, `select public.admin_create_pool_match($1, $2, $3, null, 'La Liga') as r`, [h, a, ko(21)])
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([ev('991011', '66003', '66004', ko(21))])])
    expect(await count(h, a)).toBe(1)
    const [m] = await sql(`select id, provider from public.matches where external_id = '991011'`)
    expect(m).toEqual({ id: c!.r.match_id, provider: 'api-football' })
  })

  it('agregar a mano uno que ya llegó automáticamente reutiliza el oficial', async () => {
    await cal([ev('991012', '66002', '66001', ko(22))])
    const [h, a] = [await teamId('66002'), await teamId('66001')]
    const [c] = await asUser(admin, `select public.admin_create_pool_match($1, $2, $3, null, null) as r`, [h, a, ko(22, 23)])
    expect(c!.r.created).toBe(false)
    expect(await count(h, a)).toBe(1)
  })

  it('no se pueden publicar los mismos equipos dos veces en la misma fecha', async () => {
    const [h, a] = [await teamId('66004'), await teamId('66003')]
    const k = ko(23)
    const [{ id: m1 }] = (await sql(`insert into public.matches (provider, external_id, home_team_id, away_team_id, kickoff_at, is_test_data)
      values ('test', 'dup-a', $1, $2, $3, false) returning id`, [h, a, k])) as { id: string }[]
    const [{ id: m2 }] = (await sql(`insert into public.matches (provider, external_id, home_team_id, away_team_id, kickoff_at, is_test_data)
      values ('test', 'dup-b', $1, $2, $3::timestamptz + interval '3 hours', false) returning id`, [h, a, k])) as { id: string }[]
    await sql(`insert into public.pool_matches (match_id, status, source) values ($1, 'published', 'admin')`, [m1])
    await expectDbError(sql(`insert into public.pool_matches (match_id, status, source) values ($1, 'published', 'admin')`, [m2]), 'DUPLICATE_FIXTURE')
    // Si se retira el primero, ya se puede publicar el otro.
    await sql(`update public.pool_matches set status = 'withdrawn' where match_id = $1`, [m1])
    await sql(`insert into public.pool_matches (match_id, status, source) values ($1, 'published', 'admin')`, [m2])
    await expectDbError(sql(`update public.pool_matches set status = 'published' where match_id = $1`, [m1]), 'DUPLICATE_FIXTURE')
  })
})
