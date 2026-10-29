import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, fillWeekGoals, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS en una semana lejana para no chocar con otras pruebas.
describe('el admin autoriza editar una quiniela enviada', () => {
  let admin: string
  let player: string
  let open: string
  let started: string
  let monday = ''
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const pickOf = async (m: string) => ((await sql(`select outcome, status from public.pool_picks where user_id = $1 and match_id = $2`, [player, m])) as { outcome: string; status: string }[])[0]
  const allOpen = async (outcome: string) => {
    const [p] = await asUser(player, `select public.get_pool(10) as p`)
    return (p!.p.matches as { match_id: string; open: boolean; pick: { status: string } | null }[])
      .filter((m) => m.open && m.pick?.status !== 'submitted').map((m) => ({ match_id: m.match_id, outcome }))
  }

  beforeAll(async () => {
    admin = await createAdmin()
    player = await createUser('Jugador UL')
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 140, 'YYYY-MM-DD') as d`)) as { d: string }[]
    monday = d
    const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 5, array[]::text[], array['262'], true) as r`, [monday])
    await asUser(admin, `select public.admin_set_week_mode($1, 'publish')`, [r!.r.id])
    const fx = (id: string, h: string, a: string, day: number) => ({ external_id: id, kickoff_at: `${addDays(monday, day)}T19:00:00-06:00`, status: 'scheduled',
      competition: { external_id: '262', name: 'Liga MX' }, home: { external_id: h, name: `Eq UL ${h}` }, away: { external_id: a, name: `Eq UL ${a}` } })
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('ul-1', 'u1', 'u2', 4), fx('ul-2', 'u3', 'u4', 5)])])
    open = ((await sql(`select id from public.matches where external_id = 'ul-2'`)) as { id: string }[])[0]!.id
    started = ((await sql(`select id from public.matches where external_id = 'ul-1'`)) as { id: string }[])[0]!.id
    await asUser(admin, `select public.admin_confirm_payment($1, 'authorized', now() + interval '400 days', null, null, null, null)`, [player])
    await fillWeekGoals(player, 5)
    await asUser(player, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(await allOpen('1'))])
  })

  it('solo el admin; vuelve a borrador lo que no ha empezado; se cambia y se reenvía', async () => {
    expect((await pickOf(open))!.status).toBe('submitted')
    // Enviada: el participante no puede cambiarla por su cuenta.
    await expectDbError(asUser(player, `select public.admin_unlock_quiniela($1, null)`, [player]), 'FORBIDDEN')
    await asUser(player, `select public.save_pool_picks($1::jsonb)`, [JSON.stringify([{ match_id: open, outcome: '2' }])]).catch(() => undefined)
    expect((await pickOf(open))!.outcome).toBe('1')
    // Un partido ya empezado no se libera.
    await sql(`update public.matches set status = 'live', home_goals = 0, away_goals = 0 where id = $1`, [started])
    const [r] = await asUser(admin, `select public.admin_unlock_quiniela($1, 'Se equivocó de equipo') as r`, [player])
    expect(r!.r.picks).toBeGreaterThanOrEqual(1)
    expect((await pickOf(open))!.status).toBe('draft')
    expect((await pickOf(started))!.status).toBe('submitted')
    const [log] = await sql(`select details from public.audit_logs where action = 'pool.picks_unlocked' and entity_id = $1 order by id desc limit 1`, [player])
    expect(log!.details).toMatchObject({ reason: 'Se equivocó de equipo', by: admin })
    // Cambia y reenvía.
    await asUser(player, `select public.save_pool_picks($1::jsonb)`, [JSON.stringify([{ match_id: open, outcome: '2' }])])
    await fillWeekGoals(player, 6)
    await asUser(player, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(await allOpen('2'))])
    expect(await pickOf(open)).toEqual({ outcome: '2', status: 'submitted' })
    // Si no hay nada enviado por liberar, solo avisa.
    const nobody = await createUser('Sin envíos UL')
    await expectDbError(asUser(admin, `select public.admin_unlock_quiniela($1, null)`, [nobody]), 'NOTHING_TO_UNLOCK')
  })
})
