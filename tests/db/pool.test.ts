import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Todo ficticio en una base efímera: ningún dato, partido ni pago real.
const fx = (id: string, home: string, away: string, league: string, hours: number, status = 'scheduled') => ({
  external_id: id, kickoff_at: new Date(Date.now() + hours * 3600e3).toISOString(), status,
  competition: { external_id: league, name: `Liga ${league}` },
  home: { external_id: `t-${home}`, name: `Equipo ${home}` }, away: { external_id: `t-${away}`, name: `Equipo ${away}` },
})
const pick = (match_id: string, outcome: string | null, home?: number, away?: number) => JSON.stringify([{ match_id, outcome, ...(home !== undefined ? { home, away } : {}) }])

describe('quiniela continua', () => {
  let admin: string
  let paid: string
  let free: string
  let official: string
  beforeAll(async () => {
    admin = await createAdmin()
    paid = await createUser('Pagado')
    free = await createUser('Gratis')
    ;[{ id: official }] = (await sql(`select id from public.groups where is_default`)) as { id: string }[]
    await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', null, 'REF-PRUEBA', 'Pago de prueba verificado')`, [official, paid])
  })

  it('importación automática: solo sugiere, sin duplicados; el admin selecciona y publica', async () => {
    const list = [fx('auto-1', 'A', 'B', '262', 5), fx('auto-2', 'C', 'D', '262', 6), fx('auto-old', 'E', 'F', '262', -3, 'finished')]
    const [r1] = await asService(`select public.pool_auto_import('api-football', $1::jsonb) as r`, [JSON.stringify(list)])
    expect(r1!.r).toMatchObject({ imported: 3, suggested: 2 })
    const [r2] = await asService(`select public.pool_auto_import('api-football', $1::jsonb) as r`, [JSON.stringify(list)])
    expect(r2!.r.suggested).toBe(0)
    // Nada se publica solo.
    const ids = (await sql(`select id, external_id from public.matches where external_id in ('auto-1', 'auto-2')`)) as { id: string; external_id: string }[]
    const id1 = ids.find((x) => x.external_id === 'auto-1')!.id
    const id2 = ids.find((x) => x.external_id === 'auto-2')!.id
    expect(await sql(`select 1 from public.pool_matches where match_id = any($1::uuid[])`, [[id1, id2]])).toHaveLength(0)
    // El admin selecciona auto-1, descarta auto-2 y publica.
    await asUser(admin, `select public.admin_save_selection($1::jsonb)`, [JSON.stringify([{ match_id: id1, selected: true, sort_order: 1 }, { match_id: id2, dismissed: true }])])
    const [p] = await asUser(admin, `select public.admin_publish_selection(null) as r`)
    expect(p!.r).toMatchObject({ published: 1, withdrawn: 0 })
    // Re-sincronizar no pisa la selección ni revive lo descartado.
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify(list)])
    const st = await sql(`select c.state, pm.status from public.pool_candidates c left join public.pool_matches pm on pm.match_id = c.match_id where c.match_id = any($1::uuid[]) order by c.state`, [[id1, id2]])
    expect(st).toEqual([{ state: 'dismissed', status: null }, { state: 'selected', status: 'published' }])
    expect(await sql(`select 1 from public.matches where external_id = 'auto-1'`)).toHaveLength(1)
  })

  it('catálogo de equipos sin duplicados y alta manual de partido', async () => {
    const [t1] = await asUser(admin, `select public.admin_create_team('Alacranes Pool Prueba', 'Alacranes', null, null) as r`)
    const [t2] = await asUser(admin, `select public.admin_create_team('  alacranes POOL prueba ', null, null, null) as r`)
    expect(t1!.r.created).toBe(true)
    expect(t2!.r).toMatchObject({ id: t1!.r.id, created: false })
    await expectDbError(asUser(admin, `select public.admin_create_team('Logo malo', null, 'javascript:alert(1)', null)`), 'INVALID_LOGO_URL')
    const [t3] = await asUser(admin, `select public.admin_create_team('Rival Manual', null, null, null) as r`)
    const found = await asUser(admin, `select name from public.admin_search_teams('pool prueba')`)
    expect(found.map((f) => f.name)).toContain('Alacranes Pool Prueba')
    const k = new Date(Date.now() + 2 * 3600e3).toISOString()
    const [c1] = await asUser(admin, `select public.admin_create_pool_match($1, $2, $3, null, 'Liga Premier') as r`, [t1!.r.id, t3!.r.id, k])
    const [c2] = await asUser(admin, `select public.admin_create_pool_match($1, $2, $3::timestamptz + interval '1 hour', null, 'Liga Premier') as r`, [t1!.r.id, t3!.r.id, k])
    expect(c1!.r.created).toBe(true)
    expect(c2!.r).toEqual({ match_id: c1!.r.match_id, created: false })
    const [m] = await sql(`select provider, result_source from public.matches where id = $1`, [c1!.r.match_id])
    expect(m).toEqual({ provider: 'manual', result_source: 'admin' })
    // El alta manual entra a la selección; los jugadores la ven al publicar.
    await asUser(admin, `select public.admin_publish_selection(null)`)
    const [p] = await asUser(free, `select public.get_pool(10) as p`)
    const mine = p!.p.matches.find((x: { match_id: string }) => x.match_id === c1!.r.match_id)
    expect(mine).toMatchObject({ is_manual: true, open: true, source: 'admin' })
    await expectDbError(asUser(admin, `select public.admin_create_pool_match($1, $2, now() - interval '1 hour', null, null)`, [t1!.r.id, t3!.r.id]), 'KICKOFF_IN_PAST')
  })

  it('pronósticos: borrador sin pago, envío con pago, inmutable, cierre al inicio y sin reabrir', async () => {
    const [{ id: mid }] = (await sql(`select id from public.matches where external_id = 'auto-1'`)) as { id: string }[]
    const [s1] = await asUser(free, `select public.save_pool_picks($1::jsonb) as r`, [pick(mid, 'X')])
    expect(s1!.r.saved).toBe(1)
    // Quiniela completa: todos los partidos abiertos, cada uno con marcador.
    const openIds = async (uid: string) => ((await asUser(uid, `select public.get_pool(10) as p`))[0]!.p.matches as { match_id: string; open: boolean }[]).filter((m) => m.open).map((m) => m.match_id)
    const full = (ids: string[], main: [number, number]) => JSON.stringify(ids.map((id) => ({ match_id: id, home: id === mid ? main[0] : 0, away: id === mid ? main[1] : 0 })))
    const ids = await openIds(paid)
    expect(ids.length).toBeGreaterThan(1)
    await expectDbError(asUser(free, `select public.submit_pool_picks($1::jsonb)`, [full(ids, [1, 1])]), 'PAYMENT_REQUIRED')
    await expectDbError(asUser(free, `update public.pool_picks set status = 'submitted', submitted_at = now() where user_id = $1`, [free]), 'permission denied')
    await expectDbError(asUser(paid, `select public.submit_pool_picks($1::jsonb)`, [pick(mid, '1')]), 'SCORE_REQUIRED')
    await expectDbError(asUser(paid, `select public.submit_pool_picks($1::jsonb)`, [pick(mid, '1', 2, 1)]), 'INCOMPLETE_QUINIELA')
    const [sub] = await asUser(paid, `select public.submit_pool_picks($1::jsonb) as r`, [full(ids, [2, 1])])
    expect(sub!.r.submitted).toBe(ids.length)
    const [again] = await asUser(paid, `select public.submit_pool_picks($1::jsonb) as r`, [pick(mid, '2', 0, 1)])
    expect(again!.r).toMatchObject({ submitted: 0, already_submitted: 1 })
    await expectDbError(sql(`update public.pool_picks set outcome = '2' where user_id = $1 and match_id = $2`, [paid, mid]), 'PREDICTION_LOCKED')
    // El partido empieza: queda cerrado; moverlo después no lo reabre.
    await sql(`update public.matches set kickoff_at = now() - interval '1 minute' where id = $1`, [mid])
    const [late] = await asUser(free, `select public.save_pool_picks($1::jsonb) as r`, [pick(mid, '1')])
    expect(late!.r).toMatchObject({ saved: 0, closed: 1 })
    await sql(`update public.matches set kickoff_at = now() + interval '3 hours' where id = $1`, [mid])
    const [o] = await sql(`select private.pool_match_open($1) as open, (select closes_at is not null from public.pool_matches where match_id = $1) as closed`, [mid])
    expect(o).toEqual({ open: false, closed: true })
    const logs = await sql(`select 1 from public.audit_logs where action = 'pool.kickoff_changed' and entity_id = $1`, [mid])
    expect(logs.length).toBeGreaterThanOrEqual(2)
  })

  it('resultados: proveedor y captura manual; sin doble suma; corrección recalcula; retirado no cuenta', async () => {
    const [{ id: mid }] = (await sql(`select id from public.matches where external_id = 'auto-1'`)) as { id: string }[]
    await asService(`select public.apply_provider_update($1, '{"status":"finished","status_detail":"FT","home_goals":2,"away_goals":1}'::jsonb)`, [mid])
    await asService(`select public.apply_provider_update($1, '{"status":"finished","status_detail":"FT","home_goals":2,"away_goals":1}'::jsonb)`, [mid])
    let [b] = await asUser(free, `select points, exact_hits, is_me from public.get_pool_leaderboard() where user_id = $1`, [paid])
    expect(b).toMatchObject({ points: 5, exact_hits: 1 })
    await asUser(admin, `select public.admin_record_result($1, 1, 0, 'finished', 'Corrección de prueba')`, [mid])
    ;[b] = await asUser(free, `select points from public.get_pool_leaderboard() where user_id = $1`, [paid])
    expect(b!.points).toBe(3)
    await asUser(admin, `select public.admin_set_pool_status($1, 'withdrawn', 'Partido retirado de prueba')`, [mid])
    expect(await asUser(free, `select 1 from public.get_pool_leaderboard() where user_id = $1`, [paid])).toHaveLength(0)
    await asUser(admin, `select public.admin_set_pool_status($1, 'published', 'Se vuelve a publicar')`, [mid])
    ;[b] = await asUser(free, `select points from public.get_pool_leaderboard() where user_id = $1`, [paid])
    expect(b!.points).toBe(3)
    const [{ c }] = (await sql(`select count(*)::int c from public.pool_scores where user_id = $1 and match_id = $2`, [paid, mid])) as { c: number }[]
    expect(c).toBe(1)
  })

  it('solo correos autorizados administran; un rol admin sin autorización no sirve', async () => {
    const fake = await createUser('Admin no autorizado')
    await sql(`update public.profiles set role = 'admin' where id = $1`, [fake])
    const [a] = await asUser(fake, `select public.am_i_admin() as a`)
    expect(a!.a).toBe(false)
    await expectDbError(asUser(fake, `select public.admin_create_team('X equipo', null, null, null)`), 'FORBIDDEN')
    await expectDbError(asUser(fake, `select * from public.admin_payments()`), 'FORBIDDEN')
    await expectDbError(asUser(paid, `select public.admin_pool_list(7)`), 'FORBIDDEN')
    await expectDbError(asUser(paid, `select public.pool_auto_import('api-football', '[]'::jsonb)`), 'permission denied')
    const [ok] = await asUser(admin, `select public.am_i_admin() as a`)
    expect(ok!.a).toBe(true)
  })

  it('al confirmar la cuenta autorizada, los demás admins pasan a participantes y conservan sus datos', async () => {
    const old = await createUser('Admin anterior')
    await sql(`update public.profiles set role = 'admin' where id = $1`, [old])
    await sql(`insert into private.admin_email_allowlist (email) values ('jefe2@test.local') on conflict do nothing`)
    const [u] = await sql(`insert into auth.users (email, raw_user_meta_data) values ('jefe2@test.local', '{"display_name":"Jefe 2"}') returning id`)
    await sql(`update auth.users set email_confirmed_at = now() where id = $1`, [u!.id])
    const [p1] = await sql(`select role from public.profiles where id = $1`, [u!.id])
    const [p2] = await sql(`select role, display_name from public.profiles where id = $1`, [old])
    expect(p1!.role).toBe('admin')
    expect(p2).toEqual({ role: 'player', display_name: 'Admin anterior' })
  })
})
