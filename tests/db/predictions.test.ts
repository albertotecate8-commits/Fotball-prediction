import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import pg from 'pg'
import {
  asUser, createGroup, createOpenRound, createUser, expectDbError, expireDeadline, items, pool, sql, submit,
} from './helpers'

describe('pronósticos: envío y bloqueo', () => {
  let player: string
  let group: string

  beforeAll(async () => {
    player = await createUser()
    group = await createGroup([player])
  })
  afterAll(() => pool.end())

  it('acepta un envío válido y registra la hora del servidor', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 3)
    const r = await submit(player, roundId, matchIds, [[2, 1], [0, 0], [1, 3]])
    expect(r.status).toBe('submitted')
    expect(r.already_submitted).toBe(false)
    const [p] = await sql(`select status, submitted_at from public.predictions where round_id = $1 and user_id = $2`, [roundId, player])
    expect(p!.status).toBe('submitted')
    expect(p!.submitted_at).toBeInstanceOf(Date)
    const stored = await sql(`select count(*)::int as n from public.prediction_items pi join public.predictions p on p.id = pi.prediction_id where p.round_id = $1`, [roundId])
    expect(stored[0]!.n).toBe(3)
  })

  it('un segundo envío no crea otra quiniela ni modifica la existente', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 2)
    await submit(player, roundId, matchIds, [[1, 0], [2, 2]])
    const again = await submit(player, roundId, matchIds, [[5, 5], [5, 5]])
    expect(again.already_submitted).toBe(true)
    const rows = await sql(`select count(*)::int as n from public.predictions where round_id = $1 and user_id = $2`, [roundId, player])
    expect(rows[0]!.n).toBe(1)
    const picks = await sql(
      `select pi.home_goals, pi.away_goals from public.prediction_items pi join public.predictions p on p.id = pi.prediction_id
       where p.round_id = $1 order by pi.home_goals`, [roundId])
    expect(picks.map((x) => [x.home_goals, x.away_goals])).toEqual([[1, 0], [2, 2]])
  })

  it('bloquea cualquier modificación posterior al envío (RPC, tabla directa y superusuario)', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 1)
    await submit(player, roundId, matchIds, [[1, 1]])

    const [draft] = await asUser(player, `select public.save_prediction_draft($1, $2::jsonb, 999) as r`, [roundId, items(matchIds, [[3, 0]])])
    expect(draft!.r.applied).toBe(false)
    expect(draft!.r.status).toBe('submitted')

    await expectDbError(asUser(player, `update public.prediction_items set home_goals = 4`), 'permission denied')
    await expectDbError(asUser(player, `delete from public.predictions where round_id = $1`, [roundId]), 'permission denied')
    // Ni siquiera el superusuario puede alterar un pronóstico enviado.
    await expectDbError(
      sql(`update public.prediction_items pi set home_goals = 4 from public.predictions p where p.id = pi.prediction_id and p.round_id = $1`, [roundId]),
      'PREDICTION_LOCKED',
    )
    await expectDbError(sql(`update public.predictions set status = 'draft', submitted_at = null where round_id = $1`, [roundId]), 'PREDICTION_LOCKED')
    await expectDbError(sql(`delete from public.predictions where round_id = $1`, [roundId]), 'PREDICTION_LOCKED')
  })

  it('rechaza el envío fuera de plazo', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 1)
    await expireDeadline(roundId)
    await expectDbError(submit(player, roundId, matchIds, [[1, 0]]), 'DEADLINE_PASSED')
    await expectDbError(
      asUser(player, `select public.save_prediction_draft($1, $2::jsonb, 1)`, [roundId, items(matchIds, [[1, 0]])]),
      'DEADLINE_PASSED',
    )
  })

  it('rechaza envíos en jornadas cerradas o que aún no abren', async () => {
    const closed = await createOpenRound(group, 1, { status: 'closed' })
    await expectDbError(submit(player, closed.roundId, closed.matchIds, [[1, 0]]), 'ROUND_CLOSED')
    const upcoming = await createOpenRound(group, 1)
    await sql(`update public.rounds set opens_at = now() + interval '1 hour' where id = $1`, [upcoming.roundId])
    await expectDbError(submit(player, upcoming.roundId, upcoming.matchIds, [[1, 0]]), 'ROUND_NOT_OPEN_YET')
  })

  it('rechaza campos incompletos', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 3)
    await expectDbError(submit(player, roundId, matchIds, [[1, 0], [2, 2], [null, null]]), 'INCOMPLETE_PREDICTION')
    await expectDbError(submit(player, roundId, matchIds.slice(0, 2), [[1, 0], [2, 2]]), 'INCOMPLETE_PREDICTION')
    await expectDbError(submit(player, roundId, matchIds, [[1, 0], [2, 2], [1, null]]), 'INVALID_GOALS')
  })

  it('rechaza valores negativos, decimales, texto o fuera de rango', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 1)
    await expectDbError(submit(player, roundId, matchIds, [[-1, 0]]), 'INVALID_GOALS')
    await expectDbError(submit(player, roundId, matchIds, [[1.5, 0]]), 'INVALID_GOALS')
    await expectDbError(submit(player, roundId, matchIds, [[16, 0]]), 'INVALID_GOALS')
    await expectDbError(
      asUser(player, `select public.submit_prediction($1, $2::jsonb)`, [roundId, JSON.stringify([{ match_id: matchIds[0], home: '2', away: 1 }])]),
      'INVALID_GOALS',
    )
  })

  it('rechaza partidos ajenos a la jornada y duplicados', async () => {
    const a = await createOpenRound(group, 1)
    const b = await createOpenRound(group, 1)
    await expectDbError(submit(player, a.roundId, b.matchIds, [[1, 0]]), 'MATCH_NOT_IN_ROUND')
    await expectDbError(
      asUser(player, `select public.submit_prediction($1, $2::jsonb)`, [
        a.roundId,
        JSON.stringify([{ match_id: a.matchIds[0], home: 1, away: 0 }, { match_id: a.matchIds[0], home: 1, away: 0 }]),
      ]),
      'DUPLICATE_MATCH',
    )
  })

  it('controla solicitudes simultáneas: exactamente un envío efectivo', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 2)
    const body = items(matchIds, [[1, 0], [0, 1]])
    const attempt = async () => {
      const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL })
      await c.connect()
      try {
        await c.query('begin')
        await c.query('set local role authenticated')
        await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [player])
        const res = await c.query(`select public.submit_prediction($1, $2::jsonb) as r`, [roundId, body])
        await c.query('commit')
        return res.rows[0].r as { already_submitted: boolean }
      } finally {
        await c.end()
      }
    }
    const results = await Promise.all(Array.from({ length: 6 }, attempt))
    expect(results.filter((r) => r.already_submitted === false)).toHaveLength(1)
    const rows = await sql(`select count(*)::int as n from public.predictions where round_id = $1`, [roundId])
    expect(rows[0]!.n).toBe(1)
  })

  it('un reintento tras perder la conexión devuelve el estado existente', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 1)
    const first = await submit(player, roundId, matchIds, [[2, 0]])
    const retry = await submit(player, roundId, matchIds, [[2, 0]])
    expect(retry.already_submitted).toBe(true)
    expect(retry.submitted_at).toBe(first.submitted_at)
  })

  it('borradores: guarda parcial, ignora guardados fuera de orden', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 3)
    const save = (seq: number, picks: [number | null, number | null][]) =>
      asUser(player, `select public.save_prediction_draft($1, $2::jsonb, $3) as r`, [roundId, items(matchIds, picks), seq])

    const [s1] = await save(2, [[1, 0], [null, null], [null, null]])
    expect(s1!.r.applied).toBe(true)
    expect(s1!.r.items_count).toBe(1)
    // Llega tarde una petición anterior (seq 1): se descarta.
    const [stale] = await save(1, [[9, 9], [9, 9], [9, 9]])
    expect(stale!.r.applied).toBe(false)
    const [s3] = await save(3, [[1, 0], [2, 2], [null, null]])
    expect(s3!.r.items_count).toBe(2)

    const [detail] = await asUser(player, `select public.get_round_detail($1) as d`, [roundId])
    const picks = (detail!.d.matches as { pick: { home: number; away: number } | null }[]).map((m) => m.pick)
    expect(picks).toEqual([{ home: 1, away: 0 }, { home: 2, away: 2 }, null])
    expect(detail!.d.prediction.status).toBe('draft')

    // Enviar después de un borrador funciona y reemplaza los valores.
    const done = await submit(player, roundId, matchIds, [[1, 0], [2, 2], [0, 3]])
    expect(done.status).toBe('submitted')
  })

  it('jugadores sin acceso no pueden jugar la jornada', async () => {
    const outsider = await createUser()
    const pending = await createUser()
    const suspended = await createUser()
    await sql(`insert into public.group_members (group_id, user_id, status) values ($1, $2, 'pending'), ($1, $3, 'suspended')`, [group, pending, suspended])
    const { roundId, matchIds } = await createOpenRound(group, 1)
    for (const u of [outsider, pending, suspended]) {
      await expectDbError(submit(u, roundId, matchIds, [[1, 0]]), 'ROUND_NOT_FOUND')
    }
    // Cuenta suspendida globalmente
    const blocked = await createUser()
    await sql(`insert into public.group_members (group_id, user_id, status) values ($1, $2, 'active')`, [group, blocked])
    await sql(`update public.profiles set status = 'suspended' where id = $1`, [blocked])
    await expectDbError(submit(blocked, roundId, matchIds, [[1, 0]]), 'ROUND_NOT_FOUND')
  })

  it('jornadas en borrador no son visibles ni jugables', async () => {
    const { roundId, matchIds } = await createOpenRound(group, 1, { status: 'draft' })
    await expectDbError(submit(player, roundId, matchIds, [[1, 0]]), 'ROUND_NOT_FOUND')
    const rows = await asUser(player, `select id from public.rounds where id = $1`, [roundId])
    expect(rows).toHaveLength(0)
  })

  it('participación selectiva: solo los jugadores elegidos', async () => {
    const invited = await createUser()
    const notInvited = await createUser()
    await sql(`insert into public.group_members (group_id, user_id, status) values ($1, $2, 'active'), ($1, $3, 'active')`, [group, invited, notInvited])
    const { roundId, matchIds } = await createOpenRound(group, 1, { participation: 'selected' })
    await sql(`insert into public.round_participants (round_id, user_id) values ($1, $2)`, [roundId, invited])
    expect((await submit(invited, roundId, matchIds, [[0, 0]])).status).toBe('submitted')
    await expectDbError(submit(notInvited, roundId, matchIds, [[0, 0]]), 'ROUND_NOT_FOUND')
  })
})
