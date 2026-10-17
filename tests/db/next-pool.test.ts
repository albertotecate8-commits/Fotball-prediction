import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, fillWeekGoals, pool, sql } from './helpers'

afterAll(() => pool.end())

// Partidos y equipos FICTICIOS con forma de API-Football.
const fx = (id: string, home: string, away: string, hours: number, status = 'scheduled') => ({
  external_id: id, kickoff_at: new Date(Date.now() + hours * 3600e3).toISOString(), status,
  competition: { external_id: '262', name: 'Liga 262' },
  home: { external_id: home, name: `Equipo NP ${home}` }, away: { external_id: away, name: `Equipo NP ${away}` },
})
const idOf = async (ext: string) => ((await sql(`select id from public.matches where external_id = $1`, [ext])) as { id: string }[])[0]!.id

describe('próxima quiniela', () => {
  let admin: string
  let paid: string
  let player: string
  beforeAll(async () => {
    admin = await createAdmin()
    paid = await createUser('Pagado NP')
    player = await createUser('Jugador NP')
    const [{ id: g }] = (await sql(`select id from public.groups where is_default`)) as { id: string }[]
    await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', null, 'REF-NP', 'Pago de prueba verificado')`, [g, paid])
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`,
      [JSON.stringify([fx('np-1', 'n1', 'n2', 30), fx('np-2', 'n3', 'n4', 31), fx('np-3', 'n5', 'n6', 32)])])
  })

  it('solo el admin ve y edita la próxima quiniela; el borrador no es visible a jugadores', async () => {
    await expectDbError(asUser(player, `select public.admin_next_pool()`), 'FORBIDDEN')
    await expectDbError(asUser(player, `select public.admin_save_selection('[]'::jsonb)`), 'FORBIDDEN')
    await expectDbError(asUser(player, `select public.admin_publish_selection('x')`), 'FORBIDDEN')
    await expectDbError(asUser(player, `select * from public.pool_candidates`), 'permission denied')
    const [r] = await asUser(admin, `select public.admin_next_pool() as r`)
    const mine = r!.r.filter((m: { external_id: string }) => m.external_id?.startsWith('np-'))
    expect(mine.map((m: { state: string; published: boolean; source: string }) => [m.state, m.published, m.source])).toEqual([
      ['suggested', false, 'auto'], ['suggested', false, 'auto'], ['suggested', false, 'auto']])
  })

  it('ordenar, publicar y actualizar: el orden llega a los jugadores; retirar con pronósticos exige motivo y conserva los datos', async () => {
    const [a, b, c] = [await idOf('np-1'), await idOf('np-2'), await idOf('np-3')]
    // Mismo día local y misma semana (dentro de 90 min) para que solo cuente el orden del admin
    // y la regla de «una quiniela a la vez» no lo deje esperando la semana siguiente.
    await sql(`update public.matches m set kickoff_at = now() + interval '90 minutes' + (x.h || ' seconds')::interval
      from (values ($1::uuid, 0), ($2::uuid, 10), ($3::uuid, 20)) x(id, h) where m.id = x.id`, [a, b, c])
    await asUser(admin, `select public.admin_save_selection($1::jsonb)`, [JSON.stringify([
      { match_id: c, selected: true, sort_order: 1 }, { match_id: a, selected: true, sort_order: 2 }, { match_id: b, selected: true, sort_order: 3 }])])
    // Guardar no publica.
    const [pre] = await asUser(player, `select public.get_pool(10) as p`)
    expect(pre!.p.matches.filter((m: { match_id: string }) => [a, b, c].includes(m.match_id))).toHaveLength(0)
    const [p1] = await asUser(admin, `select public.admin_publish_selection(null) as r`)
    // Otras pruebas en paralelo pueden tener partidos elegidos: se publican al menos los 3 nuestros.
    expect(p1!.r.published).toBeGreaterThanOrEqual(3)
    expect(p1!.r.withdrawn).toBe(0)
    const [pool1] = await asUser(player, `select public.get_pool(10) as p`)
    const ours = pool1!.p.matches.filter((m: { match_id: string }) => [a, b, c].includes(m.match_id))
    expect(ours.map((m: { sort_order: number }) => m.sort_order)).toEqual([1, 2, 3])
    expect(ours.map((m: { match_id: string }) => m.match_id)).toEqual([c, a, b])

    // Un jugador con pago envía su quiniela completa (todos los abiertos).
    // Un marcador enviado se acepta como 1/X/2 (el marcador ya no se guarda).
    const open = (pool1!.p.matches as { match_id: string; open: boolean }[]).filter((m) => m.open).map((m) => ({ match_id: m.match_id, home: 1, away: 0 }))
    await fillWeekGoals(paid)
    await asUser(paid, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(open)])

    // Quitar np-1 (tiene pronóstico enviado): exige motivo, conserva el pronóstico.
    await asUser(admin, `select public.admin_save_selection($1::jsonb)`, [JSON.stringify([{ match_id: a, selected: false }])])
    await expectDbError(asUser(admin, `select public.admin_publish_selection(null)`), 'REASON_REQUIRED')
    const [p2] = await asUser(admin, `select public.admin_publish_selection('Cambio de programación') as r`)
    expect(p2!.r).toMatchObject({ published: 0, withdrawn: 1, withdrawn_picks: 1 })
    const [pk] = await sql(`select status, outcome from public.pool_picks where user_id = $1 and match_id = $2`, [paid, a])
    expect(pk).toEqual({ status: 'submitted', outcome: '1' })
    const [pm] = await sql(`select status, change_reason from public.pool_matches where match_id = $1`, [a])
    expect(pm).toEqual({ status: 'withdrawn', change_reason: 'Cambio de programación' })
  })

  it('un partido ya iniciado no se puede agregar como nuevo', async () => {
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('np-4', 'n7', 'n8', 2)])])
    const d = await idOf('np-4')
    await sql(`update public.matches set kickoff_at = now() - interval '5 minutes' where id = $1`, [d])
    const [r] = await asUser(admin, `select public.admin_save_selection($1::jsonb) as r`, [JSON.stringify([{ match_id: d, selected: true }])])
    expect(r!.r).toMatchObject({ saved: 0, skipped_started: 1 })
  })

  it('aplazados y desaparecidos del proveedor quedan para revisión (no se borran)', async () => {
    const b = await idOf('np-2')
    await asService(`select public.apply_provider_update($1, '{"status":"postponed","status_detail":"PST"}'::jsonb)`, [b])
    let [c] = await sql(`select needs_review, review_reason from public.pool_candidates where match_id = $1`, [b])
    expect(c).toEqual({ needs_review: true, review_reason: 'STATUS:postponed' })
    const cId = await idOf('np-3')
    const [{ d }] = (await sql(`select to_char((kickoff_at at time zone 'utc')::date, 'YYYY-MM-DD') as d from public.matches where id = $1`, [cId])) as { d: string }[]
    await asService(`select public.pool_mark_missing('api-football', $1::date, '{}'::text[])`, [d])
    ;[c] = await sql(`select needs_review, review_reason, state from public.pool_candidates where match_id = $1`, [cId])
    expect(c).toEqual({ needs_review: true, review_reason: 'NOT_IN_PROVIDER', state: 'selected' })
    // Si vuelve a aparecer, se limpia la marca.
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('np-3', 'n5', 'n6', 32)])])
    ;[c] = await sql(`select needs_review from public.pool_candidates where match_id = $1`, [cId])
    expect(c!.needs_review).toBe(false)
  })
})

describe('catálogo de equipos', () => {
  let admin: string
  let player: string
  beforeAll(async () => {
    admin = await createAdmin()
    player = await createUser('Jugador equipos')
  })

  it('sin duplicados: por id oficial y por nombre; un manual se vuelve oficial al identificarlo', async () => {
    const [m1] = await asUser(admin, `select public.admin_create_team('Toros Prueba FC', null, null, null) as r`)
    expect(m1!.r.created).toBe(true)
    const [m2] = await asUser(admin, `select public.admin_create_team('Toros Prueba FC', null, 'https://media.example/escudo.png', '880011') as r`)
    expect(m2!.r).toMatchObject({ id: m1!.r.id, created: false, match: 'name_upgraded' })
    const [t] = await sql(`select provider, external_id, logo_url from public.teams where id = $1`, [m1!.r.id])
    expect(t).toEqual({ provider: 'api-football', external_id: '880011', logo_url: 'https://media.example/escudo.png' })
    const [m3] = await asUser(admin, `select public.admin_create_team('Otro nombre', null, null, '880011') as r`)
    expect(m3!.r).toMatchObject({ id: m1!.r.id, created: false, match: 'provider_id' })
    await expectDbError(asUser(player, `select public.admin_create_team('Intruso', null, null, null)`), 'FORBIDDEN')
    await expectDbError(asUser(player, `select public.admin_team_catalog(null, true)`), 'FORBIDDEN')
  })

  it('equipo sin historial: se elimina de verdad (con motivo y auditoría)', async () => {
    const [n] = await asUser(admin, `select public.admin_create_team('Equipo Borrable', null, null, null) as r`)
    await expectDbError(asUser(admin, `select public.admin_delete_team($1, 'x')`, [n!.r.id]), 'REASON_REQUIRED')
    await asUser(admin, `select public.admin_delete_team($1, 'Registrado por error')`, [n!.r.id])
    expect(await sql(`select 1 from public.teams where id = $1`, [n!.r.id])).toHaveLength(0)
    expect(await sql(`select 1 from public.audit_logs where action = 'team.deleted' and entity_id = $1`, [n!.r.id])).toHaveLength(1)
  })

  it('equipo con historial: no se borra; se retira, sale de sugerencias, no se reimporta y se puede restaurar', async () => {
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('rt-1', 'r1', 'r2', 40)])])
    const [{ id: team }] = (await sql(`select id from public.teams where provider = 'api-football' and external_id = 'r1'`)) as { id: string }[]
    await expectDbError(asUser(admin, `select public.admin_delete_team($1, 'Ya no lo quiero')`, [team]), 'TEAM_HAS_HISTORY')
    const [cat] = await asUser(admin, `select public.admin_team_catalog('NP r1', true) as r`)
    expect(cat!.r[0]).toMatchObject({ deletable: false, matches: 1, retired: false })
    const [r] = await asUser(admin, `select public.admin_retire_team($1, 'No forma parte de la quiniela') as r`, [team])
    expect(r!.r).toMatchObject({ retired: true, suggestions_dismissed: 1 })
    // El partido y el equipo siguen existiendo (historial intacto).
    expect(await sql(`select 1 from public.matches where external_id = 'rt-1'`)).toHaveLength(1)
    // El proveedor lo devuelve otra vez: no vuelve a sugerirse.
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('rt-2', 'r1', 'r3', 50)])])
    expect(await sql(`select 1 from public.pool_candidates c join public.matches m on m.id = c.match_id where m.external_id = 'rt-2'`)).toHaveLength(0)
    const [still] = await sql(`select retired_at is not null as retired from public.teams where id = $1`, [team])
    expect(still!.retired).toBe(true)
    // No aparece en el selector de partidos; sí en el catálogo como retirado.
    expect(await asUser(admin, `select * from public.admin_search_teams('NP r1')`)).toHaveLength(0)
    await asUser(admin, `select public.admin_restore_team($1)`, [team])
    expect(await asUser(admin, `select * from public.admin_search_teams('NP r1')`)).toHaveLength(1)
    expect(await sql(`select action from public.audit_logs where entity_id = $1 order by created_at`, [team])).toEqual([{ action: 'team.retired' }, { action: 'team.restored' }])
  })
})
