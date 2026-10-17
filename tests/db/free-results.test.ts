import { afterAll, describe, expect, it } from 'vitest'
import { asService, asUser, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partido FICTICIO ya empezado: entra a la lista del respaldo hasta tener resultado final.
describe('resultados de respaldo', () => {
  it('lista partidos publicados empezados sin final; aplicar el final los quita y suma puntos', async () => {
    const ko = new Date(Date.now() - 2 * 3600e3).toISOString()
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([{ external_id: '880990', kickoff_at: ko, status: 'scheduled',
      competition: { external_id: '262', name: 'Liga MX' }, home: { external_id: 'fr1', name: 'Eq FR 1' }, away: { external_id: 'fr2', name: 'Eq FR 2' } }])])
    const [{ id }] = (await sql(`select id from public.matches where external_id = '880990'`)) as { id: string }[]
    await sql(`insert into public.pool_matches (match_id, status, source) values ($1, 'published', 'admin') on conflict (match_id) do update set status = 'published'`, [id])
    const list = async () => (await asService(`select * from public.free_result_targets_v2()`)) as { match_id: string; league: string }[]
    expect((await list()).find((x) => x.match_id === id)).toMatchObject({ league: '262', home_name: 'Eq FR 1', away_name: 'Eq FR 2' })
    const u = await createUser('Curioso FR')
    await expectDbError(asUser(u, `select * from public.free_result_targets_v2()`), 'permission denied')
    await asService(`select public.apply_provider_update($1, '{"status":"finished","status_detail":"FT","home_goals":0,"away_goals":1}'::jsonb)`, [id])
    expect((await list()).find((x) => x.match_id === id)).toBeUndefined()
    expect(await sql(`select status, home_goals, away_goals, result_confirmed from public.matches where id = $1`, [id])).toEqual([{ status: 'finished', home_goals: 0, away_goals: 1, result_confirmed: true }])
  })
})
