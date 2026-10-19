import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS: una jornada ya terminada y la siguiente en juego.
describe('clasificación: solo la quiniela en curso', () => {
  let admin: string
  let player: string
  let doneWeek: string
  let liveWeek: string
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const fx = (id: string, h: string, a: string, day: string) => ({ external_id: id, kickoff_at: `${day}T19:00:00-06:00`, status: 'scheduled',
    competition: { external_id: '262', name: 'Liga MX' }, home: { external_id: h, name: `Eq CW ${h}` }, away: { external_id: a, name: `Eq CW ${a}` } })
  const idOf = async (ext: string) => ((await sql(`select id from public.matches where external_id = $1`, [ext])) as { id: string }[])[0]!.id
  const weeks = async (u: string) => ((await asUser(u, `select public.get_week_standings(null) as s`))[0]!.s.weeks as { id: string }[]).map((w) => w.id)

  beforeAll(async () => {
    admin = await createAdmin()
    player = await createUser('Jugador CW')
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 196, 'YYYY-MM-DD') as d`)) as { d: string }[]
    const mk = async (start: string, label: string) => ((await sql(`insert into public.pool_weeks (week_start, label, auto_mode, max_matches) values ($1::date, $2, 'off', 5) returning id`, [start, label])) as { id: string }[])[0]!.id
    doneWeek = await mk(d, 'Semana CW terminada')
    liveWeek = await mk(addDays(d, 7), 'Semana CW en juego')
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('cw-1', 'c1', 'c2', addDays(d, 5)), fx('cw-2', 'c3', 'c4', addDays(d, 12))])])
    for (const [ext, w] of [['cw-1', doneWeek], ['cw-2', liveWeek]] as const) {
      await sql(`insert into public.pool_matches (match_id, status, source, week_id) values ($1, 'published', 'admin', $2)
        on conflict (match_id) do update set status = 'published', week_id = excluded.week_id`, [await idOf(ext), w])
    }
    await sql(`update public.matches set status = 'finished', home_goals = 1, away_goals = 0 where id = $1`, [await idOf('cw-1')])
  })

  it('la jornada terminada se guarda: el participante ya no la ve, el admin sí', async () => {
    expect((await sql(`select private.week_done($1) as d`, [doneWeek]))[0]!.d).toBe(true)
    expect((await sql(`select private.week_done($1) as d`, [liveWeek]))[0]!.d).toBe(false)
    const mine = await weeks(player)
    expect(mine).not.toContain(doneWeek)
    expect(mine).toContain(liveWeek)
    expect(await weeks(admin)).toContain(doneWeek)
  })
})
