import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS: la quiniela de una semana lejana ya empezó y aparece un partido tarde.
describe('una quiniela empezada no recibe partidos nuevos', () => {
  let admin: string
  let weekId: string
  let mon = ''
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const fx = (id: string, h: string, a: string, day: number) => ({ external_id: id, kickoff_at: `${addDays(mon, day)}T19:00:00-06:00`, status: 'scheduled',
    competition: { external_id: '262', name: 'Liga MX' }, home: { external_id: h, name: `Eq NL ${h}` }, away: { external_id: a, name: `Eq NL ${a}` } })
  const idOf = async (ext: string) => ((await sql(`select id from public.matches where external_id = $1`, [ext])) as { id: string }[])[0]!.id

  beforeAll(async () => {
    admin = await createAdmin()
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 224, 'YYYY-MM-DD') as d`)) as { d: string }[]
    mon = d
    const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 12, array[]::text[], array['262'], true) as r`, [mon])
    weekId = r!.r.id
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('nl-1', 'n1', 'n2', 4)])])
    await sql(`insert into public.pool_matches (match_id, status, source, week_id) values ($1, 'published', 'admin', $2)`, [await idOf('nl-1'), weekId])
    // Su primer partido ya empezó.
    await sql(`update public.matches set kickoff_at = now() - interval '1 hour', status = 'live' where external_id = 'nl-1'`)
    await sql(`update public.pool_weeks set auto_mode = 'publish' where id = $1`, [weekId])
  })

  it('el partido que aparece tarde no se agrega ni se publica', async () => {
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('nl-2', 'n3', 'n4', 6)])])
    const [{ added }] = (await sql(`select private.fill_week($1) as added`, [weekId])) as { added: number }[]
    expect(added).toBe(0)
    expect(await sql(`select 1 from public.pool_matches where match_id = $1`, [await idOf('nl-2')])).toHaveLength(0)
  })
})
