import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createAdmin, createOpenRound, createUser, expectDbError, expireDeadline, pool, providerResult, sql } from './helpers'

afterAll(() => pool.end())

// Cuentas de prueba en una base efímera: ningún dato ni pago real.
const picks = (ids: string[], vals: (string | null | [number, number])[]) =>
  JSON.stringify(ids.map((id, i) => {
    const v = vals[i]
    return Array.isArray(v) ? { match_id: id, home: v[0], away: v[1] } : { match_id: id, outcome: v ?? null }
  }))

describe('Mi quiniela 1X2', () => {
  let official: string
  let admin: string
  let free: string
  let paid: string
  let round: { roundId: string; matchIds: string[] }

  beforeAll(async () => {
    ;[{ id: official }] = (await sql(`select id from public.groups where is_default`)) as { id: string }[]
    admin = await createAdmin()
    free = await createUser('Sin pago')
    paid = await createUser('Con pago')
    round = await createOpenRound(official, 3)
    await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', now() + interval '60 days', 'TRANSF-PRUEBA', 'Pago de prueba verificado')`, [official, paid])
  })

  it('sin pago: guarda su borrador en el servidor y lo recupera en otro dispositivo', async () => {
    const [r] = await asUser(free, `select public.save_quiniela($1, $2::jsonb, 1) as r`, [round.roundId, picks(round.matchIds, ['1', 'X', null])])
    expect(r!.r).toMatchObject({ status: 'draft', picks: 2, total: 3, can_submit: false })
    const [d] = await asUser(free, `select public.get_round_detail($1) as d`, [round.roundId])
    expect(d!.d.matches.map((m: { pick: { outcome: string } | null }) => m.pick?.outcome ?? null)).toEqual(['1', 'X', null])
    const [s] = await sql(`select status from public.predictions where round_id = $1 and user_id = $2`, [round.roundId, free])
    expect(s!.status).toBe('draft')
  })

  it('sin pago: no puede enviar por API directa ni escribir en las tablas', async () => {
    await expectDbError(asUser(free, `select public.submit_quiniela($1, $2::jsonb, 2)`, [round.roundId, picks(round.matchIds, ['1', 'X', '2'])]), 'PAYMENT_REQUIRED')
    await expectDbError(asUser(free, `insert into public.prediction_picks (prediction_id, match_id, outcome) select id, $2, '1' from public.predictions where user_id = $1`, [free, round.matchIds[0]]), 'permission denied')
    await expectDbError(asUser(free, `update public.predictions set status = 'submitted', submitted_at = now() where user_id = $1`, [free]), 'permission denied')
  })

  it('con pago: valida, envía completo, es idempotente e inmutable', async () => {
    await expectDbError(asUser(paid, `select public.submit_quiniela($1, $2::jsonb, 1)`, [round.roundId, picks(round.matchIds, ['1', null, '2'])]), 'INCOMPLETE_PREDICTION')
    await expectDbError(asUser(paid, `select public.save_quiniela($1, $2::jsonb, 1)`, [round.roundId, JSON.stringify([{ match_id: round.matchIds[0], outcome: '2', home: 3, away: 0 }])]), 'OUTCOME_MISMATCH')
    await expectDbError(asUser(paid, `select public.save_quiniela($1, $2::jsonb, 1)`, [round.roundId, JSON.stringify([{ match_id: round.matchIds[0], outcome: 'Z' }])]), 'INVALID_OUTCOME')
    const items = picks(round.matchIds, [[2, 1], 'X', '2'])
    const all = await Promise.all(Array.from({ length: 4 }, (_, i) => asUser(paid, `select public.submit_quiniela($1, $2::jsonb, $3) as r`, [round.roundId, items, 10 + i])))
    expect(all.filter(([x]) => x!.r.already_submitted === false)).toHaveLength(1)
    await expectDbError(asUser(paid, `select public.save_quiniela($1, $2::jsonb, 99)`, [round.roundId, picks(round.matchIds, ['2', '2', '2'])]), 'PREDICTION_LOCKED')
    await expectDbError(sql(`update public.prediction_picks set outcome = '1' where prediction_id = (select id from public.predictions where round_id = $1 and user_id = $2)`, [round.roundId, paid]), 'PREDICTION_LOCKED')
    const [pp] = await sql(`select outcome from public.prediction_picks pp join public.predictions p on p.id = pp.prediction_id where p.user_id = $1 and pp.match_id = $2`, [paid, round.matchIds[0]])
    expect(pp!.outcome).toBe('1') // derivado del marcador 2-1
  })

  it('cierre: después de la fecha límite nadie guarda ni envía', async () => {
    await expireDeadline(round.roundId)
    await expectDbError(asUser(free, `select public.save_quiniela($1, $2::jsonb, 5)`, [round.roundId, picks(round.matchIds, ['1', '1', '1'])]), /DEADLINE_PASSED|ROUND_CLOSED/)
  })

  it('puntos: exacto 5, 1X2 3, fallo 0; solo los enviados entran a la clasificación', async () => {
    await providerResult(round.matchIds[0]!, 2, 1) // pronóstico 2-1 → 5
    await providerResult(round.matchIds[1]!, 1, 1) // X → 3
    await providerResult(round.matchIds[2]!, 3, 0) // 2 → 0
    const [s] = await sql(`select points, exact_hits, outcome_hits, scored_matches, goal_error from public.round_scores where round_id = $1 and user_id = $2`, [round.roundId, paid])
    expect(s).toEqual({ points: 8, exact_hits: 1, outcome_hits: 2, scored_matches: 3, goal_error: 0 + 2 + 3 })
    expect(await sql(`select 1 from public.round_scores where round_id = $1 and user_id = $2`, [round.roundId, free])).toHaveLength(0)
    const board = await asUser(free, `select user_id, points from public.get_leaderboard($1, $2)`, [official, round.roundId])
    expect(board.map((b) => b.user_id)).toEqual([paid])
  })

  it('corrección de un resultado recalcula los puntos', async () => {
    await asUser(admin, `select public.admin_record_result($1, 1, 1, 'finished', 'Corrección de prueba')`, [round.matchIds[2]])
    const [s] = await sql(`select points from public.round_scores where round_id = $1 and user_id = $2`, [round.roundId, paid])
    expect(s!.points).toBe(8) // 2 vs 1-1 sigue siendo fallo
    await asUser(admin, `select public.admin_record_result($1, 0, 2, 'finished', 'Corrección de prueba 2')`, [round.matchIds[2]])
    const [s2] = await sql(`select points from public.round_scores where round_id = $1 and user_id = $2`, [round.roundId, paid])
    expect(s2!.points).toBe(11)
  })
})

describe('datos de pago', () => {
  it('solo el admin los configura; CLABE validada; el jugador ve datos y su referencia', async () => {
    const admin = await createAdmin()
    const u = await createUser()
    const [before] = await asUser(u, `select public.get_my_payment() as p`)
    expect(before!.p.reference).toMatch(/^[A-Z0-9][A-Z0-9-]+$/)
    await expectDbError(asUser(u, `select public.admin_save_payment_info('B', 'T', '012345678901234567', null, 100, 'c', 'i', null)`), 'FORBIDDEN')
    await expectDbError(asUser(u, `update public.payment_info set clabe = '000000000000000000'`), 'permission denied')
    await expectDbError(asUser(admin, `select public.admin_save_payment_info('B', 'T', '123', null, 100, null, null, null)`), 'INVALID_CLABE')
    await asUser(admin, `select public.admin_save_payment_info('Banco Prueba', 'Titular Prueba', '0123 4567 8901 2345 67', null, 150, 'Quiniela', 'Envía tu comprobante', null)`)
    const [p] = await asUser(u, `select public.get_my_payment() as p`)
    expect(p!.p).toMatchObject({ configured: true, clabe: '012345678901234567', amount: 150, payment_status: 'not_applicable' })
    const [log] = await sql(`select details from public.audit_logs where action = 'payment_info.updated' order by id desc limit 1`)
    expect(log!.details.clabe_last4).toBe('4567')
    expect(JSON.stringify(log!.details)).not.toContain('012345678901234567')
    await expectDbError(asUser(u, `select * from public.admin_payments()`), 'FORBIDDEN')
    const rows = await asUser(admin, `select * from public.admin_payments()`)
    expect(rows.find((r) => r.user_id === u)).toMatchObject({ payment_status: 'not_applicable' })
  })
})

describe('administrador por correo autorizado', () => {
  it('se vuelve admin solo al confirmar el correo', async () => {
    await sql(`insert into private.admin_email_allowlist (email) values ('jefe-prueba@test.local') on conflict do nothing`)
    const [u] = await sql(`insert into auth.users (email, raw_user_meta_data) values ('Jefe-Prueba@test.local', '{"display_name":"Jefe"}') returning id`)
    const [p1] = await sql(`select role from public.profiles where id = $1`, [u!.id])
    expect(p1!.role).toBe('player')
    await sql(`update auth.users set email_confirmed_at = now() where id = $1`, [u!.id])
    const [p2] = await sql(`select role from public.profiles where id = $1`, [u!.id])
    expect(p2!.role).toBe('admin')
    const other = await createUser()
    await sql(`update auth.users set email_confirmed_at = now() where id = $1`, [other])
    const [p3] = await sql(`select role from public.profiles where id = $1`, [other])
    expect(p3!.role).toBe('player')
  })
})
