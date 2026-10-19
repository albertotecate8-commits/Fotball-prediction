import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS: una semana lejana con su quiniela normal (fin de semana)
// y una quiniela entre semana con entrada aparte.
describe('quiniela entre semana con entrada aparte', () => {
  let admin: string
  let paidWeek: string
  let entrant: string
  let weekId: string
  let weekdayId: string
  let mon = ''
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const fx = (id: string, h: string, a: string, day: number) => ({ external_id: id, kickoff_at: `${addDays(mon, day)}T19:00:00-06:00`, status: 'scheduled',
    competition: { external_id: '262', name: 'Liga MX' }, home: { external_id: h, name: `Eq WD ${h}` }, away: { external_id: a, name: `Eq WD ${a}` } })
  const idOf = async (ext: string) => ((await sql(`select id from public.matches where external_id = $1`, [ext])) as { id: string }[])[0]!.id
  const pool = async (u: string) => (await asUser(u, `select public.get_pool(10) as p`))[0]!.p as {
    matches: { match_id: string; week_id: string; can_submit: boolean; open: boolean; pick: { status: string } | null }[]
    weeks: { id: string; kind: string; entry_amount: number | null; my_entry: boolean }[]
  }

  beforeAll(async () => {
    admin = await createAdmin()
    paidWeek = await createUser('Pago semana WD')
    entrant = await createUser('Pago entre semana WD')
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 168, 'YYYY-MM-DD') as d`)) as { d: string }[]
    mon = d
    const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 5, array[]::text[], array['262'], true) as r`, [mon])
    weekId = r!.r.id
    await asUser(admin, `select public.admin_set_week_mode($1, 'publish')`, [weekId])
    // Jornada entre semana: martes a miércoles, entrada de $50.
    const [w] = (await sql(`insert into public.pool_weeks (week_start, end_day, kind, entry_amount, label, auto_mode, max_matches)
      values ($1::date + 1, $1::date + 2, 'weekday', 50, 'Entre semana prueba', 'off', 20) returning id`, [mon])) as { id: string }[]
    weekdayId = w!.id
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('wd-1', 'w1', 'w2', 1), fx('wd-2', 'w3', 'w4', 5)])])
    // El admin publica el partido del martes en la jornada entre semana.
    await sql(`insert into public.pool_matches (match_id, status, source, week_id) values ($1, 'published', 'admin', $2)
      on conflict (match_id) do update set status = 'published', week_id = excluded.week_id`, [await idOf('wd-1'), weekdayId])
    const [{ g }] = (await sql(`select id as g from public.groups where is_default`)) as { g: string }[]
    await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', null, 'REF-WD', 'Pago de prueba verificado')`, [g, paidWeek])
  })

  it('cada partido queda en su jornada; la de entre semana gana sobre la semana', async () => {
    const [{ id }] = (await sql(`select (private.week_for($1::date + 1 + time '19:00')).id as id`, [mon])) as { id: string }[]
    expect(id).toBe(weekdayId)
    const p = await pool(paidWeek)
    expect(p.matches.find((m) => m.match_id === (p.matches.find((x) => x.week_id === weekdayId)?.match_id))?.week_id).toBe(weekdayId)
  })

  it('el pago de la semana no cubre la entrada aparte; la entrada la confirma solo el admin', async () => {
    const wd = await idOf('wd-1')
    expect((await pool(paidWeek)).matches.find((m) => m.match_id === wd)!.can_submit).toBe(false)
    await expectDbError(asUser(entrant, `select public.admin_set_entry($1, $2, true)`, [weekdayId, entrant]), 'FORBIDDEN')
    await expectDbError(asUser(entrant, `insert into public.pool_entries (week_id, user_id, amount) values ($1, $2, 50)`, [weekdayId, entrant]), 'permission denied')
    await asUser(admin, `select public.admin_set_entry($1, $2, true)`, [weekdayId, entrant])
    const p = await pool(entrant)
    expect(p.matches.find((m) => m.match_id === wd)!.can_submit).toBe(true)
    const [b] = await asUser(entrant, `select public.get_prize_pot() as p`)
    expect((b!.p.extras as { week_id: string; pot: number; entries: number; mine: boolean }[]).find((x) => x.week_id === weekdayId)).toMatchObject({ pot: 35, entries: 1, mine: true })
    const [log] = await sql(`select details from public.audit_logs where action = 'pool.entry_confirmed' and entity_id = $1 order by id desc limit 1`, [weekdayId])
    expect(log!.details).toMatchObject({ user: entrant, amount: 50, by: admin })
  })

  it('se envía con su propio total de goles; clasificación propia', async () => {
    const wd = await idOf('wd-1')
    await asUser(entrant, `select public.save_week_goals($1, 3)`, [weekdayId])
    const items = (await pool(entrant)).matches.filter((m) => m.open && m.can_submit && m.pick?.status !== 'submitted').map((m) => ({ match_id: m.match_id, outcome: '1' }))
    await asUser(entrant, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(items)])
    expect(await sql(`select status from public.pool_picks where user_id = $1 and match_id = $2`, [entrant, wd])).toEqual([{ status: 'submitted' }])
    const [s] = await asUser(entrant, `select public.get_week_standings($1) as s`, [weekdayId])
    expect(s!.s.week.label).toBe('Entre semana prueba')
    expect((s!.s.rows as { user_id: string }[]).map((r) => r.user_id)).toEqual([entrant])
    // El admin quita la entrada: deja de poder enviar partidos nuevos de esa jornada.
    await asUser(admin, `select public.admin_set_entry($1, $2, false)`, [weekdayId, entrant])
    expect(((await asUser(entrant, `select public.get_prize_pot() as p`))[0]!.p.extras as { week_id: string; entries: number }[]).find((x) => x.week_id === weekdayId)!.entries).toBe(0)
  })
})
