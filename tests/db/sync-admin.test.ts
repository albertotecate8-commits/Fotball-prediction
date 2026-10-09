import { afterAll, describe, expect, it } from 'vitest'
import {
  asService, asUser, createAdmin, createGroup, createMatch, createOpenRound, createUser, expectDbError, expireDeadline,
  pool, providerResult, sql, submit,
} from './helpers'

afterAll(() => pool.end())

const scoreOf = async (roundId: string, uid: string) =>
  (await sql(`select points, is_official from public.round_scores where round_id = $1 and user_id = $2`, [roundId, uid]))[0]

describe('sincronización de resultados', () => {
  it('es idempotente: el mismo resultado no duplica historial ni puntos', async () => {
    const u = await createUser()
    const g = await createGroup([u])
    const { roundId, matchIds } = await createOpenRound(g, 1)
    await submit(u, roundId, matchIds, [[2, 1]])
    await expireDeadline(roundId)
    const first = await providerResult(matchIds[0]!, 2, 1)
    const second = await providerResult(matchIds[0]!, 2, 1)
    expect(first.result_changed).toBe(true)
    expect(second.result_changed).toBe(false)
    const hist = await sql(`select count(*)::int as n from public.match_results where match_id = $1`, [matchIds[0]])
    expect(hist[0]!.n).toBe(1)
    expect(await scoreOf(roundId, u)).toMatchObject({ points: 5, is_official: true })
  })

  it('marcador en vivo da puntos provisionales; el final los confirma', async () => {
    const u = await createUser()
    const g = await createGroup([u])
    const { roundId, matchIds } = await createOpenRound(g, 2)
    await submit(u, roundId, matchIds, [[1, 0], [0, 0]])
    await expireDeadline(roundId)
    await providerResult(matchIds[0]!, 1, 0, 'live')
    expect(await scoreOf(roundId, u)).toMatchObject({ points: 5, is_official: false })
    const [r1] = await sql(`select status from public.rounds where id = $1`, [roundId])
    expect(r1!.status).toBe('closed')
    await providerResult(matchIds[0]!, 2, 0)
    await providerResult(matchIds[1]!, 0, 0)
    expect(await scoreOf(roundId, u)).toMatchObject({ points: 8, is_official: true })
  })

  it('nunca da por finalizado un partido sin marcador ni por su horario', async () => {
    const mid = await createMatch('-3 hours')
    const r = await providerResult(mid, null, null, 'finished')
    expect(r.changed).toBe(false)
    const [m] = await sql(`select status, result_confirmed, last_sync_error from public.matches where id = $1`, [mid])
    expect(m).toMatchObject({ status: 'scheduled', result_confirmed: false, last_sync_error: 'FINISHED_WITHOUT_SCORE' })
  })

  it('un estado desconocido no degrada un partido conocido', async () => {
    const mid = await createMatch('-1 hour')
    await providerResult(mid, 1, 1, 'live')
    await providerResult(mid, null, null, 'unknown')
    const [m] = await sql(`select status, home_goals from public.matches where id = $1`, [mid])
    expect(m).toMatchObject({ status: 'live', home_goals: 1 })
  })

  it('corrección del proveedor: recalcula y audita', async () => {
    const u = await createUser()
    const g = await createGroup([u])
    const { roundId, matchIds } = await createOpenRound(g, 1)
    await submit(u, roundId, matchIds, [[2, 1]])
    await expireDeadline(roundId)
    await providerResult(matchIds[0]!, 2, 1)
    expect((await scoreOf(roundId, u))!.points).toBe(5)
    await providerResult(matchIds[0]!, 2, 2)
    expect((await scoreOf(roundId, u))!.points).toBe(0)
    const logs = await sql(`select 1 from public.audit_logs where action = 'match.result_corrected_by_provider' and entity_id = $1`, [matchIds[0]])
    expect(logs).toHaveLength(1)
    const hist = await sql(`select count(*)::int as n from public.match_results where match_id = $1`, [matchIds[0]])
    expect(hist[0]!.n).toBe(2)
  })

  it('aplazado y cancelado: no puntúan; cancelados permiten cerrar la jornada', async () => {
    const u = await createUser()
    const g = await createGroup([u])
    const { roundId, matchIds } = await createOpenRound(g, 2)
    await submit(u, roundId, matchIds, [[1, 0], [1, 0]])
    await expireDeadline(roundId)
    await providerResult(matchIds[0]!, 1, 0)
    await providerResult(matchIds[1]!, null, null, 'postponed')
    const [r] = await sql(`select status from public.rounds where id = $1`, [roundId])
    expect(r!.status).toBe('closed') // aplazado: sigue pendiente
    await providerResult(matchIds[1]!, null, null, 'cancelled')
    const [r2] = await sql(`select status from public.rounds where id = $1`, [roundId])
    expect(r2!.status).toBe('finished')
    expect(await scoreOf(roundId, u)).toMatchObject({ points: 5, is_official: true })
    const [d] = await asUser(u, `select public.get_round_detail($1) as d`, [roundId])
    expect(d!.d.summary.max_possible).toBe(5)
  })

  it('la corrección manual del admin protege el marcador frente al proveedor', async () => {
    const admin = await createAdmin()
    const u = await createUser()
    const g = await createGroup([u])
    const { roundId, matchIds } = await createOpenRound(g, 1)
    await submit(u, roundId, matchIds, [[3, 0]])
    await expireDeadline(roundId)
    await providerResult(matchIds[0]!, 2, 0)
    await expectDbError(asUser(admin, `select public.admin_record_result($1, 3, 0, 'finished', '')`, [matchIds[0]]), 'REASON_REQUIRED')
    await asUser(admin, `select public.admin_record_result($1, 3, 0, 'finished', 'Acta oficial de la liga')`, [matchIds[0]])
    expect((await scoreOf(roundId, u))!.points).toBe(5)
    const ignored = await providerResult(matchIds[0]!, 2, 0)
    expect(ignored.reason).toBe('admin_override')
    expect((await scoreOf(roundId, u))!.points).toBe(5)
    const [log] = await sql(`select details from public.audit_logs where action = 'match.result_overridden' and entity_id = $1`, [matchIds[0]])
    expect(log!.details.before).toMatchObject({ home: 2, away: 0 })
  })

  it('run_maintenance cierra jornadas vencidas', async () => {
    const g = await createGroup([])
    const { roundId } = await createOpenRound(g, 1)
    await expireDeadline(roundId)
    await asService(`select public.run_maintenance()`)
    const [r] = await sql(`select status from public.rounds where id = $1`, [roundId])
    expect(r!.status).toBe('closed')
  })

  it('upsert de partidos del proveedor es idempotente', async () => {
    const fx = [{
      external_id: 'fx-1001', kickoff_at: new Date(Date.now() + 86400e3).toISOString(), status: 'scheduled',
      competition: { external_id: 'L1', name: 'Liga de prueba' },
      home: { external_id: 'T1', name: 'Equipo Prueba Norte', short_name: 'Norte', code: 'NOR' },
      away: { external_id: 'T2', name: 'Equipo Prueba Sur', short_name: 'Sur', code: 'SUR' },
    }]
    const [a] = await asService(`select public.upsert_provider_fixtures('mock', $1::jsonb, true) as r`, [JSON.stringify(fx)])
    const [b] = await asService(`select public.upsert_provider_fixtures('mock', $1::jsonb, true) as r`, [JSON.stringify(fx)])
    expect(a!.r.inserted).toBe(1)
    expect(b!.r.inserted).toBe(0)
    expect(a!.r.match_ids).toEqual(b!.r.match_ids)
    const [m] = await sql(`select is_test_data from public.matches where provider = 'mock' and external_id = 'fx-1001'`)
    expect(m!.is_test_data).toBe(true)
  })

  it('get_sync_targets solo incluye partidos de jornadas activas', async () => {
    const g = await createGroup([])
    const live = await createOpenRound(g, 1)
    await sql(`update public.matches set kickoff_at = now() - interval '30 minutes' where id = $1`, [live.matchIds[0]])
    const loose = await createMatch('-30 minutes')
    const targets = await asService(`select match_id from public.get_sync_targets(15)`)
    const ids = targets.map((t) => t.match_id)
    expect(ids).toContain(live.matchIds[0])
    expect(ids).not.toContain(loose)
  })
})

describe('gestión de jornadas por el admin', () => {
  it('no permite el mismo partido dos veces', async () => {
    const admin = await createAdmin()
    const g = await createGroup([admin])
    const [r] = await asUser(admin, `select public.admin_save_round(null, $1, 'J1', null, null, now() + interval '1 day', 'all_members') as id`, [g])
    const m = await createMatch()
    await expectDbError(asUser(admin, `select public.admin_set_round_matches($1, array[$2, $2]::uuid[])`, [r!.id, m]), 'DUPLICATE_MATCH')
  })

  it('valida la apertura: partidos, fecha límite antes del primer partido', async () => {
    const admin = await createAdmin()
    const g = await createGroup([admin])
    const [r] = await asUser(admin, `select public.admin_save_round(null, $1, 'J2', null, null, now() + interval '3 days', 'all_members') as id`, [g])
    await expectDbError(asUser(admin, `select public.admin_set_round_status($1, 'open')`, [r!.id]), 'ROUND_NEEDS_MATCHES')
    const m1 = await createMatch('2 days')
    const m2 = await createMatch('4 days')
    await asUser(admin, `select public.admin_set_round_matches($1, array[$2, $3]::uuid[])`, [r!.id, m1, m2])
    await expectDbError(asUser(admin, `select public.admin_set_round_status($1, 'open')`, [r!.id]), 'DEADLINE_AFTER_KICKOFF')
    await asUser(admin, `select public.admin_save_round($1, $2, 'J2', null, null, now() + interval '1 day', 'all_members')`, [r!.id, g])
    await asUser(admin, `select public.admin_set_round_status($1, 'open')`, [r!.id])
    const [row] = await sql(`select status, opened_at from public.rounds where id = $1`, [r!.id])
    expect(row!.status).toBe('open')
    // reordenar partidos funciona sin chocar con la unicidad de posición
    await asUser(admin, `select public.admin_set_round_matches($1, array[$2, $3]::uuid[])`, [r!.id, m2, m1])
    const order = await sql(`select match_id from public.round_matches where round_id = $1 order by position`, [r!.id])
    expect(order.map((o) => o.match_id)).toEqual([m2, m1])
  })

  it('con quinielas enviadas, los partidos de la jornada quedan bloqueados', async () => {
    const admin = await createAdmin()
    const u = await createUser()
    const g = await createGroup([u, admin])
    const { roundId, matchIds } = await createOpenRound(g, 2)
    await submit(u, roundId, matchIds, [[1, 0], [0, 1]])
    const extra = await createMatch()
    await expectDbError(
      asUser(admin, `select public.admin_set_round_matches($1, $2::uuid[])`, [roundId, [matchIds[0], extra]]),
      'ROUND_HAS_SUBMISSIONS',
    )
    await expectDbError(asUser(admin, `select public.admin_set_round_status($1, 'draft')`, [roundId]), 'ROUND_HAS_PREDICTIONS')
    await expectDbError(asUser(admin, `select public.admin_delete_round($1)`, [roundId]), 'ROUND_LOCKED')
  })

  it('cambios de la fecha límite quedan auditados', async () => {
    const admin = await createAdmin()
    const g = await createGroup([admin])
    const { roundId } = await createOpenRound(g, 1)
    await asUser(admin, `select public.admin_save_round($1, $2, 'Renombrada', null, null, now() + interval '20 hours', 'all_members')`, [roundId, g])
    const [log] = await sql(`select details from public.audit_logs where action = 'round.updated' and entity_id = $1`, [roundId])
    expect(log!.details.after.name).toBe('Renombrada')
    await expectDbError(
      asUser(admin, `select public.admin_save_round($1, $2, 'x1', null, null, now() - interval '1 hour', 'all_members')`, [roundId, g]),
      'DEADLINE_IN_PAST',
    )
  })

  it('unirse con código: queda pendiente hasta aprobación', async () => {
    const admin = await createAdmin()
    const u = await createUser()
    const [gid] = await asUser(admin, `select public.admin_save_group(null, 'Amigos', null, true, true) as id`)
    const [code] = await sql(`select invite_code from public.groups where id = $1`, [gid!.id])
    const [j] = await asUser(u, `select public.join_group($1) as r`, [code!.invite_code.toLowerCase()])
    expect(j!.r.status).toBe('pending')
    await expectDbError(asUser(u, `select * from public.get_leaderboard($1)`, [gid!.id]), 'FORBIDDEN')
    await asUser(admin, `select public.admin_set_member($1, $2, 'active', 'authorized')`, [gid!.id, u])
    const lb = await asUser(u, `select * from public.get_leaderboard($1)`, [gid!.id])
    expect(lb).toEqual([])
    await expectDbError(asUser(u, `select public.join_group('NOPE1234')`), 'INVALID_INVITE_CODE')
  })
})
