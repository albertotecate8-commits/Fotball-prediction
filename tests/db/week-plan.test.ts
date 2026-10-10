import { afterAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS con la forma de API-Football (equipos 529/541 y liga 262 simulados).
const nextMonday = async () => (await sql<{ d: string }>(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int), 'YYYY-MM-DD') as d`))[0]!.d
const fx = (id: string, isoUtc: string, league: string, home: string, away: string) => ({
  external_id: id, kickoff_at: isoUtc, status: 'scheduled',
  competition: { external_id: league, name: `Liga ${league}` },
  home: { external_id: home, name: `Equipo ${home}` }, away: { external_id: away, name: `Equipo ${away}` },
})
const at = (monday: string, dayOffset: number, hourUtc: number) => {
  const d = new Date(`${monday}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dayOffset)
  d.setUTCHours(hourUtc)
  return d.toISOString()
}

describe('quiniela de la próxima semana', () => {
  it('solo el admin la pide; se llena hasta 12 con Barcelona y Real Madrid (fin de semana) y Liga MX', async () => {
    const admin = await createAdmin()
    const player = await createUser('Jugador semana')
    await expectDbError(asUser(player, `select public.admin_plan_week()`), 'FORBIDDEN')
    const [p] = await asUser(admin, `select public.admin_plan_week() as r`)
    const monday = await nextMonday()
    expect(p!.r.week_start).toBe(monday)
    // Pedirla otra vez no duplica la semana.
    const [p2] = await asUser(admin, `select public.admin_plan_week() as r`)
    expect(p2!.r.id).toBe(p!.r.id)

    // Viernes: 12 partidos de Liga MX llegan antes que Barcelona y Real Madrid (sábado/domingo).
    const friday = Array.from({ length: 12 }, (_, i) => fx(`mx-${i}`, at(monday, 4, 18 + (i % 5)), '262', `mx-h${i}`, `mx-a${i}`))
    // Barcelona en Champions entre semana: no entra (solo su partido de fin de semana).
    const midweek = [fx('ucl-529', at(monday, 1, 19), '2', '529', 'x-ucl')]
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([...friday, ...midweek])])
    let [w] = await asUser(admin, `select public.admin_week_plans() as r`)
    let plan = w!.r.find((x: { id: string }) => x.id === p!.r.id)
    // Se guardan 2 lugares para Barcelona y Real Madrid.
    expect(plan.filled).toBe(10)

    const weekend = [fx('liga-529', at(monday, 5, 14), '140', '529', 'x1'), fx('liga-541', at(monday, 6, 19), '140', 'x2', '541'), fx('otra-liga', at(monday, 5, 16), '39', 'y1', 'y2')]
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify(weekend)])
    ;[w] = await asUser(admin, `select public.admin_week_plans() as r`)
    plan = w!.r.find((x: { id: string }) => x.id === p!.r.id)
    expect(plan.filled).toBe(12)
    expect([...plan.teams_found].sort()).toEqual(['529', '541'])
    const inPool = await sql(`select m.external_id from public.pool_matches pm join public.matches m on m.id = pm.match_id where pm.week_id = $1`, [p!.r.id])
    const ids = inPool.map((r) => r.external_id)
    expect(ids).not.toContain('ucl-529')
    expect(ids).not.toContain('otra-liga')
    expect(ids.filter((x: string) => x.startsWith('mx-'))).toHaveLength(10)

    // Reimportar no duplica ni excede el cupo.
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([...friday, ...weekend])])
    const [{ n }] = await sql(`select count(*)::int as n from public.pool_matches where week_id = $1`, [p!.r.id])
    expect(n).toBe(12)

    // Los jugadores ven el avance de la semana.
    const [g] = await asUser(player, `select public.get_pool_week() as g`)
    expect(g!.g).toMatchObject({ max_matches: 12, filled: 12 })
  })

  it('Durango (Liga de Expansión) ya no es fuente automática', async () => {
    const rows = await sql(`select external_id, enabled from public.pool_sources where external_id = '15941'`)
    for (const r of rows) expect(r.enabled).toBe(false)
  })
})
