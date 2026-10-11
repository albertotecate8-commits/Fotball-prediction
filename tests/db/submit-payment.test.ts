import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, fillWeekGoals, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS en una semana lejana para no chocar con otras pruebas.
describe('enviar con el pago vigente', () => {
  let admin: string
  let player: string
  let a: string
  let b: string
  let monday = ''
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const fx = (id: string, h: string, aw: string, day: number) => ({
    external_id: id, kickoff_at: `${addDays(monday, day)}T19:00:00-06:00`, status: 'scheduled', competition: { external_id: '262', name: 'Liga MX' },
    home: { external_id: h, name: `Eq SP ${h}` }, away: { external_id: aw, name: `Eq SP ${aw}` },
  })
  const allOpen = async () => {
    const [p] = await asUser(player, `select public.get_pool(10) as p`)
    return (p!.p.matches as { match_id: string; open: boolean; pick: { status: string } | null }[])
      .filter((m) => m.open && m.pick?.status !== 'submitted').map((m) => ({ match_id: m.match_id, outcome: '1' }))
  }

  beforeAll(async () => {
    admin = await createAdmin()
    player = await createUser('Jugador SP')
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 84, 'YYYY-MM-DD') as d`)) as { d: string }[]
    monday = d
    const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 5, array[]::text[], array['262'], true) as r`, [monday])
    await asUser(admin, `select public.admin_set_week_mode($1, 'publish')`, [r!.r.id])
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('sp-1', 'p1', 'p2', 4), fx('sp-2', 'p3', 'p4', 12)])])
    a = ((await sql(`select id from public.matches where external_id = 'sp-1'`)) as { id: string }[])[0]!.id
    b = ((await sql(`select id from public.matches where external_id = 'sp-2'`)) as { id: string }[])[0]!.id
    await sql(`insert into public.pool_matches (match_id, status, source) values ($1, 'published', 'admin') on conflict (match_id) do update set status = 'published'`, [b])
  })

  it('sin pago no envía nada; con pago hasta una fecha envía lo cubierto y deja lo demás guardado', async () => {
    await fillWeekGoals(player, 4)
    await expectDbError(asUser(player, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(await allOpen())]), 'PAYMENT_REQUIRED')
    await asUser(admin, `select public.admin_confirm_payment($1, 'authorized', $2::date + 6, null, null, null, null)`, [player, monday])
    await fillWeekGoals(player, 4)
    const [r] = await asUser(player, `select public.submit_pool_picks($1::jsonb) as r`, [JSON.stringify(await allOpen())])
    expect(r!.r.unpaid).toBeGreaterThanOrEqual(1)
    const status = async (m: string) => ((await sql(`select status from public.pool_picks where user_id = $1 and match_id = $2`, [player, m])) as { status: string }[])[0]?.status
    expect(await status(a)).toBe('submitted')
    expect(await status(b)).not.toBe('submitted')
  })
})
