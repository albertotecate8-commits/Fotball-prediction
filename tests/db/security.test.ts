import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asAnon, asService, asUser, createAdmin, createGroup, createOpenRound, createUser, expectDbError, pool, sql, submit,
} from './helpers'

afterAll(() => pool.end())

describe('RLS y separación entre grupos', () => {
  let alice: string, bob: string, carol: string
  let groupA: string, groupB: string
  let roundA: { roundId: string; matchIds: string[] }
  let roundB: { roundId: string; matchIds: string[] }

  beforeAll(async () => {
    ;[alice, bob, carol] = await Promise.all([createUser('Alice'), createUser('Bob'), createUser('Carol')])
    groupA = await createGroup([alice, bob])
    groupB = await createGroup([carol])
    roundA = await createOpenRound(groupA, 2)
    roundB = await createOpenRound(groupB, 2)
    await submit(alice, roundA.roundId, roundA.matchIds, [[1, 0], [2, 2]])
    await submit(bob, roundA.roundId, roundA.matchIds, [[0, 1], [1, 1]])
    await submit(carol, roundB.roundId, roundB.matchIds, [[3, 3], [0, 0]])
  })

  it('un jugador solo ve sus propios pronósticos', async () => {
    const preds = await asUser(alice, `select user_id from public.predictions`)
    expect(new Set(preds.map((p) => p.user_id))).toEqual(new Set([alice]))
    const itemsRows = await asUser(alice, `select prediction_id from public.prediction_items`)
    const [own] = await sql(`select id from public.predictions where user_id = $1`, [alice])
    expect(itemsRows.every((r) => r.prediction_id === own!.id)).toBe(true)
  })

  it('no ve jornadas, partidos ni clasificación de otro grupo', async () => {
    const rounds = await asUser(alice, `select id from public.rounds`)
    expect(rounds.map((r) => r.id)).toEqual([roundA.roundId])
    const matches = await asUser(alice, `select id from public.matches where id = any($1::uuid[])`, [roundB.matchIds])
    expect(matches).toHaveLength(0)
    await expectDbError(asUser(alice, `select * from public.get_leaderboard($1)`, [groupB]), 'FORBIDDEN')
    await expectDbError(asUser(alice, `select public.get_round_detail($1)`, [roundB.roundId]), 'ROUND_NOT_FOUND')
    await expectDbError(asUser(alice, `select * from public.get_my_rounds($1)`, [groupB]), 'FORBIDDEN')
  })

  it('solo ve perfiles de personas con quienes comparte grupo', async () => {
    const profiles = await asUser(alice, `select id from public.profiles`)
    const ids = new Set(profiles.map((p) => p.id))
    expect(ids.has(alice)).toBe(true)
    expect(ids.has(bob)).toBe(true)
    expect(ids.has(carol)).toBe(false)
  })

  it('no puede cambiar su rol, estado ni puntuación', async () => {
    await expectDbError(asUser(alice, `update public.profiles set role = 'admin' where id = $1`, [alice]), 'permission denied')
    await expectDbError(asUser(alice, `update public.profiles set status = 'active' where id = $1`, [alice]), 'permission denied')
    await expectDbError(asUser(alice, `update public.round_scores set points = 50`), 'permission denied')
    await expectDbError(asUser(alice, `update public.group_members set status = 'active'`), 'permission denied')
    // Sí puede cambiar su alias, y solo el suyo.
    await asUser(alice, `update public.profiles set display_name = 'Alicia' where id = $1`, [alice])
    await asUser(alice, `update public.profiles set display_name = 'Hack' where id = $1`, [bob])
    const [b] = await sql(`select display_name from public.profiles where id = $1`, [bob])
    expect(b!.display_name).toBe('Bob')
  })

  it('el trigger protege rol/estado aunque se otorgara permiso de columna por error', async () => {
    await sql(`grant update (role) on public.profiles to authenticated`)
    try {
      await expectDbError(asUser(alice, `update public.profiles set role = 'admin' where id = $1`, [alice]), 'PROFILE_FIELD_LOCKED')
    } finally {
      await sql(`revoke update (role) on public.profiles from authenticated`)
    }
  })

  it('no puede escribir directamente en tablas protegidas', async () => {
    for (const stmt of [
      `insert into public.predictions (round_id, user_id) values ('${roundA.roundId}', '${alice}')`,
      `insert into public.rounds (group_id, name, deadline_at) values ('${groupA}', 'x', now())`,
      `update public.matches set home_goals = 9`,
      `insert into public.match_results (match_id, status, is_final, source) values ('${roundA.matchIds[0]}', 'finished', true, 'provider')`,
      `insert into public.audit_logs (action, entity_type) values ('x', 'y')`,
      `update public.app_settings set value = 'true' where key = 'payments_enabled'`,
    ]) {
      await expectDbError(asUser(alice, stmt), 'permission denied')
    }
  })

  it('no puede ejecutar acciones administrativas', async () => {
    await expectDbError(asUser(alice, `select public.admin_dashboard_stats()`), 'FORBIDDEN')
    await expectDbError(asUser(alice, `select public.admin_set_user_role($1, 'admin')`, [alice]), 'FORBIDDEN')
    await expectDbError(asUser(alice, `select public.admin_record_result($1, 1, 0, 'finished', 'quiero ganar')`, [roundA.matchIds[0]]), 'FORBIDDEN')
    await expectDbError(asUser(alice, `select * from public.admin_list_participants()`), 'FORBIDDEN')
    await expectDbError(asUser(alice, `select public.admin_set_round_status($1, 'closed')`, [roundA.roundId]), 'FORBIDDEN')
  })

  it('no puede invocar las funciones del sincronizador ni las internas', async () => {
    await expectDbError(
      asUser(alice, `select public.apply_provider_update($1, '{"status":"finished","home_goals":1,"away_goals":0}')`, [roundA.matchIds[0]]),
      'permission denied',
    )
    await expectDbError(asUser(alice, `select public.run_maintenance()`), 'permission denied')
    await expectDbError(asUser(alice, `select private.recompute_round_scores($1)`, [roundA.roundId]), 'permission denied')
    await expectDbError(asUser(alice, `select private.log_audit('x', 'y', null)`), 'permission denied')
  })

  it('auditoría y sincronizaciones solo visibles para admin', async () => {
    expect(await asUser(alice, `select id from public.audit_logs`)).toHaveLength(0)
    const admin = await createAdmin()
    const logs = await asUser(admin, `select id from public.audit_logs`)
    expect(logs.length).toBeGreaterThan(0)
  })

  it('anon no puede leer nada ni llamar RPC del juego', async () => {
    await expectDbError(asAnon(`select * from public.profiles`), 'permission denied')
    await expectDbError(asAnon(`select * from public.rounds`), 'permission denied')
    await expectDbError(asAnon(`select public.submit_prediction($1, '[]')`, [roundA.roundId]), 'permission denied')
    const [t] = await asAnon(`select public.get_server_time() as t`)
    expect(t!.t).toBeInstanceOf(Date)
  })

  it('RLS está activado en todas las tablas públicas', async () => {
    const rows = await sql(`select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(rows).toEqual([])
  })

  it('las funciones security definer fijan search_path', async () => {
    const rows = await sql(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname in ('public', 'private') and p.prosecdef
                              and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')`)
    expect(rows).toEqual([])
  })

  it('claim_first_admin solo funciona si no hay ningún admin', async () => {
    await createAdmin()
    const [r] = await asUser(alice, `select public.claim_first_admin() as ok`)
    expect(r!.ok).toBe(false)
    const [p] = await sql(`select role from public.profiles where id = $1`, [alice])
    expect(p!.role).toBe('player')
  })

  it('el rol de servicio sí puede sincronizar', async () => {
    const [r] = await asService(`select public.run_maintenance() as n`)
    expect(typeof r!.n).toBe('number')
  })
})

describe('admin frente a jugador', () => {
  it('el admin ve todo y sus acciones quedan auditadas', async () => {
    const admin = await createAdmin()
    const p = await createUser()
    const g = await createGroup([p])
    await asUser(admin, `select public.admin_set_user_status($1, 'suspended')`, [p])
    const [log] = await sql(`select actor_id, details from public.audit_logs where action = 'user.status_changed' and entity_id = $1`, [p])
    expect(log!.actor_id).toBe(admin)
    expect(log!.details).toMatchObject({ from: 'active', to: 'suspended' })
    const members = await asUser(admin, `select * from public.admin_group_members($1)`, [g])
    expect(members[0]!.email).toMatch(/@test\.local$/)
  })

  it('un admin suspendido pierde sus permisos', async () => {
    const admin = await createAdmin()
    await sql(`update public.profiles set status = 'suspended' where id = $1`, [admin])
    await expectDbError(asUser(admin, `select public.admin_dashboard_stats()`), 'FORBIDDEN')
  })

  it('el admin no puede cambiar su propio rol (evita quedarse sin admins)', async () => {
    const admin = await createAdmin()
    await expectDbError(asUser(admin, `select public.admin_set_user_role($1, 'player')`, [admin]), 'CANNOT_CHANGE_SELF')
  })

  it('los registros de auditoría son inmutables', async () => {
    await expectDbError(sql(`update public.audit_logs set action = 'x'`), 'APPEND_ONLY_TABLE')
    await expectDbError(sql(`delete from public.audit_logs`), 'APPEND_ONLY_TABLE')
  })

  it('los cobros no pueden habilitarse', async () => {
    const admin = await createAdmin()
    await expectDbError(asUser(admin, `select public.admin_update_setting('payments_enabled', 'true')`), 'SETTING_LOCKED')
  })
})
