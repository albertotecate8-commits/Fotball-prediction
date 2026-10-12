import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS en dos semanas seguidas, lejanas para no chocar con otras pruebas.
describe('una quiniela a la vez', () => {
  let admin: string
  let monday = ''
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const fx = (id: string, h: string, a: string, day: number) => ({
    external_id: id, kickoff_at: `${addDays(monday, day)}T19:00:00-06:00`, status: 'scheduled', competition: { external_id: '262', name: 'Liga MX' },
    home: { external_id: h, name: `Eq OW ${h}` }, away: { external_id: a, name: `Eq OW ${a}` },
  })
  const published = async (ext: string) => ((await sql(`select pm.status from public.pool_matches pm join public.matches m on m.id = pm.match_id where m.external_id = $1`, [ext])) as { status: string }[])[0]?.status ?? null
  const idOf = async (ext: string) => ((await sql(`select id from public.matches where external_id = $1`, [ext])) as { id: string }[])[0]!.id

  beforeAll(async () => {
    admin = await createAdmin()
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 112, 'YYYY-MM-DD') as d`)) as { d: string }[]
    monday = d
    for (const start of [monday, addDays(monday, 7)]) {
      const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 5, array[]::text[], array['262'], true) as r`, [start])
      await asUser(admin, `select public.admin_set_week_mode($1, 'publish')`, [r!.r.id])
    }
  })

  it('la semana siguiente espera a que termine la actual y luego se publica sola', async () => {
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('ow-1', 'o1', 'o2', 4), fx('ow-2', 'o3', 'o4', 11)])])
    expect(await published('ow-1')).toBe('published')
    expect(await published('ow-2')).toBeNull() // elegido, pero en espera
    const [{ s }] = (await sql(`select c.state as s from public.pool_candidates c where c.match_id = $1`, [await idOf('ow-2')])) as { s: string }[]
    expect(s).toBe('selected')
    // Termina el último partido de la semana actual: se publica la siguiente.
    await asService(`select public.apply_provider_update($1, '{"status":"finished","status_detail":"FT","home_goals":1,"away_goals":0}'::jsonb)`, [await idOf('ow-1')])
    expect(await published('ow-2')).toBe('published')
  })
})
