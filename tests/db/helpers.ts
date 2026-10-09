import pg from 'pg'
import { randomUUID } from 'node:crypto'

const url = process.env.TEST_DATABASE_URL
if (!url) throw new Error('TEST_DATABASE_URL no definido. Ejecuta: npm run test:db')

export const pool = new pg.Pool({ connectionString: url, max: 20 })

type Params = unknown[]

/** Consulta como superusuario (equivale al SQL editor / migraciones). */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: Params = []) {
  const res = await pool.query<T>(text, params)
  return res.rows
}

async function asRole<T extends pg.QueryResultRow>(role: 'authenticated' | 'anon' | 'service_role', uid: string | null, text: string, params: Params) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`set local role ${role}`)
    if (uid) await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid])
    const res = await client.query<T>(text, params)
    await client.query('commit')
    return res.rows
  } catch (e) {
    await client.query('rollback').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

/** Consulta como un usuario autenticado concreto (aplica RLS y permisos reales). */
export const asUser = <T extends pg.QueryResultRow = pg.QueryResultRow>(uid: string, text: string, params: Params = []) =>
  asRole<T>('authenticated', uid, text, params)

export const asAnon = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: Params = []) =>
  asRole<T>('anon', null, text, params)

export const asService = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: Params = []) =>
  asRole<T>('service_role', null, text, params)

const tag = () => randomUUID().slice(0, 8)

export async function createUser(name = `Jugador ${tag()}`) {
  const [row] = await sql<{ id: string }>(
    `insert into auth.users (email, raw_user_meta_data) values ($1, jsonb_build_object('display_name', $2::text)) returning id`,
    [`${tag()}@test.local`, name],
  )
  return row!.id
}

export async function createAdmin() {
  const id = await createUser(`Admin ${tag()}`)
  await sql(`update public.profiles set role = 'admin' where id = $1`, [id])
  return id
}

export async function createGroup(members: string[] = [], status = 'active') {
  const [g] = await sql<{ id: string }>(`insert into public.groups (name) values ($1) returning id`, [`Grupo ${tag()}`])
  for (const m of members) {
    await sql(`insert into public.group_members (group_id, user_id, status) values ($1, $2, $3)`, [g!.id, m, status])
  }
  return g!.id
}

export async function createTeam(name = `Equipo ${tag()}`) {
  const [t] = await sql<{ id: string }>(
    `insert into public.teams (provider, external_id, name, short_name, is_test_data) values ('test', $1, $2, $2, true) returning id`,
    [randomUUID(), name],
  )
  return t!.id
}

export async function createMatch(kickoffOffset = '2 days') {
  const home = await createTeam()
  const away = await createTeam()
  const [m] = await sql<{ id: string; external_id: string }>(
    `insert into public.matches (provider, external_id, home_team_id, away_team_id, kickoff_at, is_test_data)
     values ('test', $1, $2, $3, now() + $4::interval, true) returning id, external_id`,
    [randomUUID(), home, away, kickoffOffset],
  )
  return m!.id
}

/** Jornada abierta con N partidos, fecha límite mañana y partidos pasado mañana. */
export async function createOpenRound(groupId: string, matchCount = 3, opts: { status?: string; participation?: string } = {}) {
  const [r] = await sql<{ id: string }>(
    `insert into public.rounds (group_id, name, status, deadline_at, participation)
     values ($1, $2, $3, now() + interval '1 day', $4) returning id`,
    [groupId, `Jornada ${tag()}`, opts.status ?? 'open', opts.participation ?? 'all_members'],
  )
  const matchIds: string[] = []
  for (let i = 0; i < matchCount; i++) {
    const mid = await createMatch()
    await sql(`insert into public.round_matches (round_id, match_id, position) values ($1, $2, $3)`, [r!.id, mid, i + 1])
    matchIds.push(mid)
  }
  return { roundId: r!.id, matchIds }
}

export type Pick = [number | null, number | null]

export const items = (matchIds: string[], picks: Pick[]) =>
  JSON.stringify(matchIds.map((id, i) => ({ match_id: id, home: picks[i]?.[0] ?? null, away: picks[i]?.[1] ?? null })))

export async function submit(uid: string, roundId: string, matchIds: string[], picks: Pick[]) {
  const [row] = await asUser<{ r: Record<string, unknown> }>(uid, `select public.submit_prediction($1, $2::jsonb) as r`, [
    roundId,
    items(matchIds, picks),
  ])
  return row!.r
}

/** Simula el paso del tiempo: la fecha límite queda en el pasado. */
export async function expireDeadline(roundId: string) {
  await sql(`update public.rounds set deadline_at = now() - interval '1 minute' where id = $1`, [roundId])
}

/** Resultado del proveedor (vía rol de servicio, como la Edge Function). */
export async function providerResult(matchId: string, home: number | null, away: number | null, status = 'finished') {
  const [row] = await asService<{ r: Record<string, unknown> }>(`select public.apply_provider_update($1, $2::jsonb) as r`, [
    matchId,
    JSON.stringify({ status, home_goals: home, away_goals: away, status_detail: status === 'finished' ? 'FT' : null }),
  ])
  return row!.r
}

export async function expectDbError(promise: Promise<unknown>, match: string | RegExp) {
  try {
    await promise
  } catch (e) {
    const msg = (e as Error).message
    if (typeof match === 'string' ? msg.includes(match) : match.test(msg)) return
    throw new Error(`Se esperaba error ${String(match)} y se obtuvo: ${msg}`)
  }
  throw new Error(`Se esperaba error ${String(match)} pero la operación tuvo éxito`)
}
