import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, fillWeekGoals, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS con forma de API-Football (Liga MX 262).
let monday = ''
const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const fx = (id: string, home: string, away: string, day: number) => ({
  external_id: id, kickoff_at: `${addDays(monday, day)}T19:00:00-06:00`, status: 'scheduled',
  competition: { external_id: '262', name: 'Liga MX' },
  home: { external_id: home, name: `Eq WG ${home}` }, away: { external_id: away, name: `Eq WG ${away}` },
})
const idOf = async (ext: string) => ((await sql(`select id from public.matches where external_id = $1`, [ext])) as { id: string }[])[0]!.id
/** Toda la quiniela abierta del jugador: 1 (local) salvo lo indicado. */
const allOpen = async (uid: string, overrides: Record<string, string> = {}) => {
  const [p] = await asUser(uid, `select public.get_pool(10) as p`)
  return (p!.p.matches as { match_id: string; open: boolean; pick: { status: string } | null }[])
    .filter((m) => m.open && m.pick?.status !== 'submitted').map((m) => ({ match_id: m.match_id, outcome: overrides[m.match_id] ?? '1' }))
}

describe('quiniela 1X2 con total de goles de la jornada', () => {
  let admin: string
  let p1: string
  let p2: string
  let week: string
  let a: string
  let b: string
  beforeAll(async () => {
    admin = await createAdmin()
    p1 = await createUser('Jugador WG1')
    p2 = await createUser('Jugador WG2')
    const [{ g }] = (await sql(`select id as g from public.groups where is_default`)) as { g: string }[]
    for (const u of [p1, p2]) await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', null, 'REF-WG', 'Pago de prueba verificado')`, [g, u])
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 56, 'YYYY-MM-DD') as d`)) as { d: string }[]
    monday = d
    const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 5, array[]::text[], array['262'], true) as r`, [monday])
    week = r!.r.id
    await asUser(admin, `select public.admin_set_week_mode($1, 'publish')`, [week])
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('wg-1', 'w1', 'w2', 4), fx('wg-2', 'w3', 'w4', 5)])])
    a = await idOf('wg-1')
    b = await idOf('wg-2')
  })

  it('sin marcador: se elige 1/X/2; el total de goles de la semana es obligatorio al enviar', async () => {
    await expectDbError(asUser(p1, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify((await allOpen(p1)).map(({ match_id }) => ({ match_id })))]), 'OUTCOME_REQUIRED')
    await expectDbError(asUser(p1, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(await allOpen(p1))]), 'WEEK_GOALS_REQUIRED')
    await expectDbError(asUser(p1, `select public.save_week_goals($1, 500)`, [week]), 'INVALID_GOALS_TOTAL')
    // Otras pruebas comparten la base: llena las demás semanas abiertas y luego la nuestra.
    await fillWeekGoals(p1, 7)
    await asUser(p1, `select public.save_week_goals($1, 4)`, [week])
    const [r] = await asUser(p1, `select public.submit_pool_picks($1::jsonb) as r`, [JSON.stringify(await allOpen(p1))])
    expect(r!.r.week_goals).toBeGreaterThanOrEqual(1)
    const [pk] = await sql(`select outcome, home_goals, status from public.pool_picks where user_id = $1 and match_id = $2`, [p1, a])
    expect(pk).toEqual({ outcome: '1', home_goals: null, status: 'submitted' })
    // Enviado: ya no se cambia.
    await expectDbError(asUser(p1, `select public.save_week_goals($1, 6)`, [week]), 'PREDICTION_LOCKED')
    expect(await sql(`select total_goals, status from public.pool_week_goals where user_id = $1 and week_id = $2`, [p1, week])).toEqual([{ total_goals: 4, status: 'submitted' }])
  })

  it('otros no ven el total de goles de los demás', async () => {
    await asUser(p2, `select public.save_week_goals($1, 9)`, [week])
    expect(await asUser(p2, `select * from public.pool_week_goals where user_id = $1`, [p1])).toEqual([])
    await expectDbError(asUser(p2, `insert into public.pool_week_goals (user_id, week_id, total_goals) values ($1, $2, 1)`, [p2, week]), 'permission denied')
  })

  it('clasificación: aciertos primero y, si empatan, gana quien más se acerca a los goles de la jornada', async () => {
    await fillWeekGoals(p2, 7)
    await asUser(p2, `select public.save_week_goals($1, 9)`, [week])
    await asUser(p2, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(await allOpen(p2))])
    // Se juegan: 2-1 (gana local) y 1-1 (empate) → 5 goles; ambos aciertan 1 de 2.
    await asService(`select public.apply_provider_update($1, '{"status":"finished","status_detail":"FT","home_goals":2,"away_goals":1}'::jsonb)`, [a])
    await asService(`select public.apply_provider_update($1, '{"status":"finished","status_detail":"FT","home_goals":1,"away_goals":1}'::jsonb)`, [b])
    const [r] = await asUser(p1, `select public.get_week_leaderboard($1) as r`, [week])
    expect(r!.r.week.real).toMatchObject({ goals: 5, counted: 2, total: 2 })
    const rows = r!.r.rows as { user_id: string; rank_position: number; hits: number; guess: number; diff: number; is_me: boolean }[]
    expect(rows.map((x) => [x.user_id, x.rank_position, x.hits, x.guess, x.diff])).toEqual([[p1, 1, 1, 4, 1], [p2, 2, 1, 9, 4]])
    expect(rows[0]!.is_me).toBe(true)
    // Ya empezó la jornada: el total de goles queda cerrado.
    const late = await createUser('Jugador WG tarde')
    await expectDbError(asUser(late, `select public.save_week_goals($1, 3)`, [week]), 'WEEK_GOALS_CLOSED')
  })
})
