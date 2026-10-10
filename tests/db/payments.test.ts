import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  asUser, createAdmin, createOpenRound, createUser, expectDbError, expireDeadline, items, pool, providerResult, sql, submit,
} from './helpers'

afterAll(() => pool.end())

// Todas las cuentas son de prueba en una base efímera: ningún pago real.
describe('participación con pago confirmado (Quiniela oficial)', () => {
  let official: string
  let admin: string
  let free: string
  let paid: string
  let round: { roundId: string; matchIds: string[] }

  beforeAll(async () => {
    ;[{ id: official }] = (await sql(`select id from public.groups where is_default`)) as { id: string }[]
    admin = await createAdmin()
    free = await createUser('Gratis')
    paid = await createUser('Pagado')
    round = await createOpenRound(official, 2)
  })

  it('la Quiniela oficial exige pago; ambos usuarios entran como miembros sin pago', async () => {
    const [g] = await sql(`select requires_payment from public.groups where id = $1`, [official])
    expect(g!.requires_payment).toBe(true)
    const rows = await sql(`select user_id, status, payment_status from public.group_members where group_id = $1 and user_id = any($2::uuid[])`, [official, [free, paid]])
    expect(rows.every((r) => r.status === 'active' && r.payment_status === 'not_applicable')).toBe(true)
  })

  it('sin pago: ve jornadas, partidos y clasificación', async () => {
    const rounds = await asUser(free, `select round_id from public.get_my_rounds($1)`, [official])
    expect(rounds.map((r) => r.round_id)).toContain(round.roundId)
    const [d] = await asUser(free, `select public.get_round_detail($1) as d`, [round.roundId])
    expect(d!.d.matches).toHaveLength(2)
    await asUser(free, `select * from public.get_leaderboard($1)`, [official])
    const [p] = await asUser(free, `select public.get_my_participation($1) as p`, [round.roundId])
    expect(p!.p).toMatchObject({ requires_payment: true, can_participate: false, payment_status: 'not_applicable' })
  })

  it('sin pago: la API rechaza borradores y envíos (no se guarda nada en el servidor)', async () => {
    await expectDbError(asUser(free, `select public.save_prediction_draft($1, $2::jsonb, 1)`, [round.roundId, items(round.matchIds, [[1, 0], [0, 0]])]), 'PAYMENT_REQUIRED')
    await expectDbError(submit(free, round.roundId, round.matchIds, [[1, 0], [0, 0]]), 'PAYMENT_REQUIRED')
    expect(await sql(`select 1 from public.predictions where round_id = $1 and user_id = $2`, [round.roundId, free])).toHaveLength(0)
  })

  it('el jugador no puede declararse pagado ni el admin saltarse la confirmación', async () => {
    await expectDbError(asUser(free, `update public.group_members set payment_status = 'authorized' where user_id = $1`, [free]), 'permission denied')
    await expectDbError(asUser(free, `insert into public.group_members (group_id, user_id, status, payment_status) values ($1, $2, 'active', 'authorized')`, [official, free]), 'permission denied')
    await expectDbError(asUser(free, `select public.admin_set_payment($1, $2, 'authorized', null, 'REF-1', 'me pagué yo')`, [official, free]), 'FORBIDDEN')
    await expectDbError(asUser(admin, `select public.admin_set_member($1, $2, 'active', 'authorized')`, [official, free]), 'USE_PAYMENT_CONFIRMATION')
    await expectDbError(asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', null, '', 'confirmado')`, [official, free]), 'PAYMENT_REFERENCE_REQUIRED')
    await expectDbError(asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', null, 'REF-1', '')`, [official, free]), 'REASON_REQUIRED')
    const [m] = await sql(`select payment_status from public.group_members where group_id = $1 and user_id = $2`, [official, free])
    expect(m!.payment_status).toBe('not_applicable')
  })

  it('con pago confirmado por el admin: envía, queda bloqueado y sin duplicados', async () => {
    await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', now() + interval '30 days', 'TRANSF-PRUEBA-001', 'Pago de prueba verificado')`, [official, paid])
    const [log] = await sql(`select actor_id, details from public.audit_logs where action = 'member.payment_changed' and entity_id = $1`, [`${official}:${paid}`])
    expect(log!.actor_id).toBe(admin)
    expect(log!.details).toMatchObject({ from: 'not_applicable', to: 'authorized', reference: 'TRANSF-PRUEBA-001' })

    const [p] = await asUser(paid, `select public.get_my_participation($1) as p`, [round.roundId])
    expect(p!.p.can_participate).toBe(true)
    const results = await Promise.all(Array.from({ length: 4 }, () => submit(paid, round.roundId, round.matchIds, [[2, 1], [0, 0]])))
    expect(results.filter((r) => r.already_submitted === false)).toHaveLength(1)
    expect(await sql(`select 1 from public.predictions where round_id = $1 and user_id = $2`, [round.roundId, paid])).toHaveLength(1)
    await expectDbError(sql(`update public.prediction_items set home_goals = 9 where prediction_id = (select id from public.predictions where round_id = $1 and user_id = $2)`, [round.roundId, paid]), 'PREDICTION_LOCKED')
  })

  it('cierre de jornada: ni pagado puede enviar después de la fecha límite', async () => {
    const late = await createOpenRound(official, 1)
    await expireDeadline(late.roundId)
    await expectDbError(submit(paid, late.roundId, late.matchIds, [[1, 1]]), /ROUND_CLOSED|DEADLINE_PASSED/)
  })

  it('puntos: solo los pronósticos enviados (con pago) suman en la clasificación', async () => {
    await expireDeadline(round.roundId)
    await providerResult(round.matchIds[0]!, 2, 1)
    await providerResult(round.matchIds[1]!, 1, 0)
    const [s] = await sql(`select points, exact_hits, outcome_hits from public.round_scores where round_id = $1 and user_id = $2`, [round.roundId, paid])
    expect(s).toEqual({ points: 5, exact_hits: 1, outcome_hits: 1 })
    expect(await sql(`select 1 from public.round_scores where round_id = $1 and user_id = $2`, [round.roundId, free])).toHaveLength(0)
  })

  it('vigencia: un pago vencido antes del cierre no habilita la jornada; revocar bloquea', async () => {
    const next = await createOpenRound(official, 1)
    await sql(`update public.rounds set deadline_at = now() + interval '10 days' where id = $1`, [next.roundId])
    await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', now() + interval '2 days', 'TRANSF-PRUEBA-002', 'Vigencia corta de prueba')`, [official, free])
    await expectDbError(submit(free, next.roundId, next.matchIds, [[1, 0]]), 'PAYMENT_REQUIRED')
    await asUser(admin, `select public.admin_set_payment($1, $2, 'rejected', null, null, 'Pago no recibido')`, [official, paid])
    await expectDbError(submit(paid, next.roundId, next.matchIds, [[1, 0]]), 'PAYMENT_REQUIRED')
  })

  it('grupos privados sin pago siguen funcionando como antes', async () => {
    const [g] = await sql(`select requires_payment from public.groups where not is_default limit 1`)
    if (g) expect(g.requires_payment).toBe(false)
  })
})
