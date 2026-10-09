import { afterAll, describe, expect, it } from 'vitest'
import { asUser, createGroup, createOpenRound, createUser, expireDeadline, pool, providerResult, sql, submit, type Pick } from './helpers'

afterAll(() => pool.end())

describe('reglas oficiales de puntuación (SQL)', () => {
  // [real, pronóstico, puntos] — tabla del reglamento
  const cases: [[number, number], [number, number], number][] = [
    [[2, 1], [2, 1], 5],
    [[2, 1], [3, 1], 3],
    [[2, 1], [1, 0], 3],
    [[2, 1], [0, 2], 0],
    [[1, 1], [1, 1], 5],
    [[1, 1], [0, 0], 3],
    [[1, 1], [2, 1], 0],
    // victoria visitante
    [[0, 2], [1, 3], 3],
    [[0, 2], [0, 2], 5],
    [[0, 2], [2, 0], 0],
  ]
  it.each(cases)('real %j, pronóstico %j → %i pts', async (real, pred, pts) => {
    const [r] = await sql(`select public.score_prediction($1, $2, $3, $4) as p`, [pred[0], pred[1], real[0], real[1]])
    expect(r!.p).toBe(pts)
  })

  it('error de goles = suma de diferencias absolutas', async () => {
    const [r] = await sql(`select public.goal_error(3, 1, 1, 2) as e`)
    expect(r!.e).toBe(3)
  })
})

async function playRound(group: string, players: Record<string, Pick[]>, results: Pick[]) {
  const { roundId, matchIds } = await createOpenRound(group, results.length)
  for (const [uid, picks] of Object.entries(players)) await submit(uid, roundId, matchIds, picks)
  await expireDeadline(roundId)
  for (const [i, [h, a]] of results.entries()) await providerResult(matchIds[i]!, h, a)
  return { roundId, matchIds }
}

describe('jornada completa: puntos, cierre y máximo', () => {
  it('10 partidos todos exactos = 50 puntos y la jornada se finaliza sola', async () => {
    const u = await createUser()
    const g = await createGroup([u])
    const results: Pick[] = Array.from({ length: 10 }, (_, i) => [i % 3, (i + 1) % 2])
    const { roundId } = await playRound(g, { [u]: results }, results)
    const [rs] = await sql(`select points, exact_hits, outcome_hits, scored_matches, is_official from public.round_scores where round_id = $1`, [roundId])
    expect(rs).toMatchObject({ points: 50, exact_hits: 10, outcome_hits: 10, scored_matches: 10, is_official: true })
    const [r] = await sql(`select status from public.rounds where id = $1`, [roundId])
    expect(r!.status).toBe('finished')
  })

  it('los puntos nunca vienen del cliente: round_scores no es escribible', async () => {
    const u = await createUser()
    const g = await createGroup([u])
    const { roundId } = await createOpenRound(g, 1)
    await expect(asUser(u, `insert into public.round_scores (round_id, user_id, points) values ($1, $2, 99)`, [roundId, u])).rejects.toThrow(/permission denied/)
  })
})

describe('desempates oficiales', () => {
  it('ordena por puntos, exactos, menor error y aciertos 1X2; comparte posición en empate total', async () => {
    const [a, b, c, d, e, f] = await Promise.all(Array.from({ length: 6 }, () => createUser()))
    const g = await createGroup([a!, b!, c!, d!, e!, f!])
    // Resultados reales: 2-1, 0-0, 1-3
    const results: Pick[] = [[2, 1], [0, 0], [1, 3]]
    const players: Record<string, Pick[]> = {
      // A: 5+5+3 = 13 pts, 2 exactos
      [a!]: [[2, 1], [0, 0], [0, 2]],
      // B: 5+3+3 = 11 pts, 1 exacto, error 0+2+2=4
      [b!]: [[2, 1], [1, 1], [0, 2]],
      // C: 3+5+3 = 11 pts, 1 exacto, error 2+0+0... → [3,1]=1, [0,0]=0, [1,4]=1 → error 2  (gana a B por menor error)
      [c!]: [[3, 1], [0, 0], [1, 4]],
      // D: 3+3+3 = 9 pts, 0 exactos
      [d!]: [[1, 0], [2, 2], [0, 1]],
      // E y F: idénticos → empate total, posición compartida
      [e!]: [[0, 3], [1, 0], [3, 0]],
      [f!]: [[0, 3], [1, 0], [3, 0]],
    }
    const { roundId } = await playRound(g, players, results)

    const rows = await asUser(a!, `select * from public.get_leaderboard($1, $2)`, [g, roundId])
    const by = (uid: string) => rows.find((r) => r.user_id === uid)!
    expect(by(a!)).toMatchObject({ rank_position: 1, points: 13, exact_hits: 2 })
    expect(by(c!)).toMatchObject({ rank_position: 2, points: 11, goal_error: 2 })
    expect(by(b!)).toMatchObject({ rank_position: 3, points: 11, goal_error: 4 })
    expect(by(d!)).toMatchObject({ rank_position: 4, points: 9, exact_hits: 0 })
    expect(by(e!).rank_position).toBe(5)
    expect(by(f!).rank_position).toBe(5)
    expect(by(a!).is_me).toBe(true)
    expect(by(b!).is_me).toBe(false)
  })

  it('a igualdad de puntos, exactos y error, decide el número de aciertos 1X2', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const g = await createGroup([a!, b!])
    // Nota: con puntos = 3·aciertos1X2 + 2·exactos, si empatan puntos y exactos
    // también empatan los aciertos 1X2, así que este criterio nunca decide con
    // datos reales. Se verifica igualmente el orden con agregados construidos.
    const { roundId } = await createOpenRound(g, 1)
    await sql(`update public.rounds set status = 'finished' where id = $1`, [roundId])
    await sql(
      `insert into public.round_scores (round_id, user_id, points, exact_hits, outcome_hits, goal_error, scored_matches, is_official)
       values ($1, $2, 6, 0, 3, 5, 3, true), ($1, $3, 6, 0, 2, 5, 3, true)`,
      [roundId, a, b],
    )
    const rows = await asUser(a!, `select user_id, rank_position from public.get_leaderboard($1, $2)`, [g, roundId])
    expect(rows.find((r) => r.user_id === a)!.rank_position).toBe(1)
    expect(rows.find((r) => r.user_id === b)!.rank_position).toBe(2)
  })

  it('clasificación acumulada e historial de posiciones', async () => {
    const [a, b] = await Promise.all([createUser(), createUser()])
    const g = await createGroup([a!, b!])
    await playRound(g, { [a!]: [[1, 0]], [b!]: [[0, 1]] }, [[1, 0]]) // A 5, B 0
    await sql(`update public.rounds set deadline_at = now() - interval '2 days' where group_id = $1`, [g])
    await playRound(g, { [a!]: [[0, 1]], [b!]: [[2, 2]] }, [[2, 2]]) // A 0, B 5 → empate 5-5, 1 exacto c/u

    const total = await asUser(b!, `select user_id, points, rank_position from public.get_leaderboard($1)`, [g])
    expect(total.map((r) => r.points)).toEqual([5, 5])

    const hist = await asUser(b!, `select * from public.get_position_history($1)`, [g])
    expect(hist).toHaveLength(2)
    expect(hist[0]).toMatchObject({ round_points: 0, cumulative_points: 0, cumulative_position: 2 })
    expect(hist[1]).toMatchObject({ round_points: 5, round_position: 1, cumulative_points: 5 })

    const [summary] = await asUser(a!, `select public.get_player_summary($1) as s`, [g])
    expect(summary!.s).toMatchObject({ total_points: 5, exact_hits: 1, outcome_hits: 1, players: 2 })
    expect(summary!.s.last_round.points).toBe(0)
  })

  it('quien no envía su quiniela no suma ni aparece en la jornada', async () => {
    const [a, lazy] = await Promise.all([createUser(), createUser()])
    const g = await createGroup([a!, lazy!])
    const { roundId, matchIds } = await createOpenRound(g, 1)
    await asUser(lazy!, `select public.save_prediction_draft($1, $2::jsonb, 1)`, [roundId, JSON.stringify([{ match_id: matchIds[0], home: 1, away: 0 }])])
    await submit(a!, roundId, matchIds, [[0, 0]])
    await expireDeadline(roundId)
    await providerResult(matchIds[0]!, 1, 0)
    const rows = await asUser(a!, `select user_id from public.get_leaderboard($1, $2)`, [g, roundId])
    expect(rows.map((r) => r.user_id)).toEqual([a])
  })
})
