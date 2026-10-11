import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos FICTICIOS con forma de API-Football (Liga MX 262, Barcelona 529, Real Madrid 541).
let monday = ''
const at = (dayOffset: number, hhmm: string) => `${monday}T${hhmm}:00-06:00`.replace(monday, addDays(monday, dayOffset))
function addDays(d: string, n: number) { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const fx = (id: string, home: string, away: string, kickoff: string, league = '262') => ({
  external_id: id, kickoff_at: kickoff, status: 'scheduled',
  competition: { external_id: league, name: league === '262' ? 'Liga MX' : 'La Liga' },
  home: { external_id: home, name: `Eq AW ${home}` }, away: { external_id: away, name: `Eq AW ${away}` },
})
const importFx = (list: unknown[]) => asService(`select public.pool_auto_import('api-football', $1::jsonb) as r`, [JSON.stringify(list)])
const idOf = async (ext: string) => ((await sql(`select id from public.matches where external_id = $1`, [ext])) as { id: string }[])[0]!.id
const stateOf = async (ext: string) => ((await sql(`select c.state, (pm.status = 'published') as published from public.matches m
  left join public.pool_candidates c on c.match_id = m.id left join public.pool_matches pm on pm.match_id = m.id where m.external_id = $1`, [ext])) as { state: string | null; published: boolean | null }[])[0]!

describe('quiniela automática por semana', () => {
  let admin: string
  let player: string
  let week: string
  beforeAll(async () => {
    admin = await createAdmin()
    player = await createUser('Jugador AW')
    // Una semana lejana para no chocar con otras pruebas.
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 28, 'YYYY-MM-DD') as d`)) as { d: string }[]
    monday = d
    const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 3, array['529','541'], array['262'], true) as r`, [monday])
    week = r!.r.id
  })

  it('solo el admin cambia el modo', async () => {
    await expectDbError(asUser(player, `select public.admin_set_week_mode($1, 'publish')`, [week]), 'FORBIDDEN')
    await expectDbError(asUser(admin, `select public.admin_set_week_mode($1, 'todo')`, [week]), 'INVALID_MODE')
  })

  it('«solo seleccionar»: llena el cupo (equipos primero, lugar guardado) sin publicar', async () => {
    await importFx([
      fx('aw-l1', 'm1', 'm2', at(4, '19:00')), fx('aw-l2', 'm3', 'm4', at(5, '19:00')), fx('aw-l3', 'm5', 'm6', at(6, '19:00')),
      fx('aw-barca-wed', '529', 'x1', at(2, '12:00'), '140'), // entre semana: no cuenta para el equipo
      fx('aw-barca', '529', 'x2', at(5, '13:00'), '140'),
    ])
    expect(await stateOf('aw-barca')).toEqual({ state: 'selected', published: null })
    expect(await stateOf('aw-l1')).toEqual({ state: 'selected', published: null })
    // Cupo 3: Barcelona + 1 de liga; queda un lugar guardado para Real Madrid.
    expect(await stateOf('aw-l2')).toEqual({ state: 'suggested', published: null })
    expect((await stateOf('aw-barca-wed')).state).toBe('suggested')
    const [p] = await asUser(admin, `select public.admin_week_plans() as r`)
    expect(p!.r.plans.find((x: { id: string }) => x.id === week)).toMatchObject({ auto_mode: 'select', selected: 2, published: 0, teams_found: ['529'] })
  })

  it('lo que el admin quita no vuelve a entrar solo', async () => {
    const l1 = await idOf('aw-l1')
    await asUser(admin, `select public.admin_save_selection($1::jsonb)`, [JSON.stringify([{ match_id: l1, selected: false }])])
    await importFx([fx('aw-l1', 'm1', 'm2', at(4, '19:00'))])
    expect((await stateOf('aw-l1')).state).toBe('suggested')
  })

  it('«automática»: selecciona y publica sola; el retirado no regresa', async () => {
    const [m] = await asUser(admin, `select public.admin_set_week_mode($1, 'publish') as r`, [week])
    expect(m!.r.mode).toBe('publish')
    expect(await stateOf('aw-barca')).toEqual({ state: 'selected', published: true })
    // aw-l1 lo quitó el admin; entra el siguiente de la liga.
    expect(await stateOf('aw-l2')).toEqual({ state: 'selected', published: true })
    await importFx([fx('aw-rm', 'x3', '541', at(6, '14:00'), '140')])
    expect(await stateOf('aw-rm')).toEqual({ state: 'selected', published: true })
    const [pool1] = await asUser(player, `select public.get_pool(10) as p`)
    const ids = await Promise.all(['aw-barca', 'aw-l2', 'aw-rm'].map(idOf))
    expect(pool1!.p.matches.filter((x: { match_id: string }) => ids.includes(x.match_id))).toHaveLength(3)
  })

  it('«apagada»: lo nuevo solo queda como sugerencia', async () => {
    await asUser(admin, `select public.admin_set_week_mode($1, 'off')`, [week])
    await importFx([fx('aw-l4', 'm7', 'm8', at(1, '19:00'))])
    expect(await stateOf('aw-l4')).toEqual({ state: 'suggested', published: null })
    expect(await sql(`select 1 from public.audit_logs where action = 'pool.week_mode' and entity_id = $1`, [week])).toHaveLength(2)
  })

  it('solo viernes a domingo también para la liga', async () => {
    await asUser(admin, `select public.admin_set_week_mode($1, 'select')`, [week])
    await importFx([fx('aw-l-wed', 'm9', 'm10', at(2, '19:00'))])
    expect((await stateOf('aw-l-wed')).state).toBe('suggested')
  })

  it('calendario adelantado: ids oficiales, sin duplicados, escudo de API-Football y plan aplicado', async () => {
    const cal = (list: unknown[]) => asService(`select public.calendar_import($1::jsonb) as r`, [JSON.stringify(list)])
    const ev = (id: string, h: string, a: string, ko: string) => ({ external_id: id, kickoff_at: ko, competition: { external_id: '262', name: 'Liga MX' },
      home: { external_id: h, name: `Cal ${h}` }, away: { external_id: a, name: `Cal ${a}` } })
    await expectDbError(asUser(admin, `select public.calendar_import('[]'::jsonb)`), 'permission denied')
    await asUser(admin, `select public.admin_set_week_mode($1, 'publish')`, [week])
    const [r1] = await cal([ev('880001', '77001', '77002', at(6, '17:00')), ev('x-bad', '1', '2', at(6, '17:00')), ev('880002', '77003', '77003', at(6, '18:00'))])
    expect(r1!.r).toMatchObject({ received: 3, new_matches: 1, skipped: 2 })
    const [t] = await sql(`select provider, logo_url from public.teams where external_id = '77001'`)
    expect(t).toEqual({ provider: 'api-football', logo_url: 'https://media.api-sports.io/football/teams/77001.png' })
    const [r2] = await cal([ev('880001', '77001', '77002', at(6, '17:00'))])
    expect(r2!.r).toMatchObject({ new_matches: 0 })
    expect(await sql(`select 1 from public.matches where external_id = '880001'`)).toHaveLength(1)
    // La sincronización de API-Football actualiza el MISMO partido (mismo id).
    await importFx([{ ...fx('880001', '77001', '77002', at(6, '17:30')), home: { external_id: '77001', name: 'Oficial 77001' } }])
    expect(await sql(`select 1 from public.matches where external_id = '880001'`)).toHaveLength(1)
  })

  it('repetir cada semana copia el plan a la siguiente', async () => {
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) - (extract(isodow from private.local_day(now()))::int - 1), 'YYYY-MM-DD') as d`)) as { d: string }[]
    const [p] = await asUser(admin, `select public.admin_plan_week($1::date, 9, array['99999'], array[]::text[], true) as r`, [d])
    await expectDbError(asUser(player, `select public.admin_set_week_repeat($1, true)`, [p!.r.id]), 'FORBIDDEN')
    await asUser(admin, `select public.admin_set_week_repeat($1, true)`, [p!.r.id])
    await asService(`select public.calendar_weeks()`)
    const [n] = await sql(`select max_matches, repeat_weekly, team_ids from public.pool_weeks where week_start = $1::date + 7`, [d])
    expect(n).toEqual({ max_matches: 9, repeat_weekly: true, team_ids: ['99999'] })
    const [o] = await sql(`select repeat_weekly from public.pool_weeks where id = $1`, [p!.r.id])
    expect(o!.repeat_weekly).toBe(false)
  })
})
