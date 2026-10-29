import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, fillWeekGoals, pool, sql } from './helpers'

afterAll(() => pool.end())

describe('referencias de pago', () => {
  let admin: string
  beforeAll(async () => { admin = await createAdmin() })

  it('alias legible sin tildes, única aunque se repita y estable aunque cambie el alias', async () => {
    const a = await createUser('María López')
    const b = await createUser('Maria  Lopez!')
    const ref = async (u: string) => ((await sql(`select reference, legacy_reference from public.payment_references where user_id = $1`, [u])) as { reference: string; legacy_reference: string }[])[0]!
    const ra = await ref(a)
    const rb = await ref(b)
    expect(ra.reference).toBe('SHABEX-MARIA-LOPEZ')
    expect(rb.reference).toMatch(/^SHABEX-MARIA-LOPEZ-[0-9A-F]{3,}$/)
    expect(ra.legacy_reference).toMatch(/^SHX-[0-9A-F]{6}$/)
    await sql(`update public.profiles set display_name = 'Otro Nombre' where id = $1`, [a])
    expect((await ref(a)).reference).toBe('SHABEX-MARIA-LOPEZ')
    const c = await createUser('Ñu')
    expect((await ref(c)).reference).toBe('SHABEX-NU')
  })

  it('cada quien ve solo su referencia; nadie la escribe desde el cliente', async () => {
    const a = await createUser('Carlos Ref')
    const b = await createUser('Otro Ref')
    const [mine] = await asUser(a, `select public.get_my_payment() as p`)
    expect(mine!.p).toMatchObject({ reference: 'SHABEX-CARLOS-REF', alias: 'Carlos Ref', state: 'none' })
    expect(await asUser(a, `select * from public.payment_references where user_id = $1`, [b])).toEqual([])
    await expectDbError(asUser(a, `insert into public.payment_references (user_id, reference) values ($1, 'SHABEX-X')`, [a]), 'permission denied')
    await expectDbError(asUser(a, `update public.payment_references set reference = 'SHABEX-HACK' where user_id = $1`, [a]), 'permission denied')
    void admin
  })

  it('confirmación manual con importe, método, vigencia y quién confirmó; vencido y revocado', async () => {
    const u = await createUser('Pagador Ref')
    await expectDbError(asUser(u, `select public.admin_confirm_payment($1, 'authorized', null, 50, 'SPEI', 'TR-1', 'Captura enviada')`, [u]), 'FORBIDDEN')
    // Un solo toque: sin folio ni motivo también confirma (manual, por el admin, auditado).
    const quick = await createUser('Rapido Ref')
    const [qr] = await asUser(admin, `select public.admin_confirm_payment($1, 'authorized', null, null, null, null, null) as r`, [quick])
    expect(qr!.r.state).toBe('confirmed')
    const [qa] = await sql(`select actor_id, details from public.audit_logs where action = 'member.payment_changed' and entity_id like '%' || $1 order by id desc limit 1`, [quick])
    expect(qa!.actor_id).toBe(admin)
    expect(qa!.details.reason).toBe('Pago confirmado por el administrador')
    const [r] = await asUser(admin, `select public.admin_confirm_payment($1, 'authorized', now() + interval '7 days', 50, 'SPEI', 'TR-998877', 'Transferencia revisada en el banco') as r`, [u])
    expect(r!.r).toMatchObject({ reference: 'SHABEX-PAGADOR-REF', state: 'confirmed', amount: 50 })
    const [l] = await asUser(admin, `select public.admin_payment_list() as l`)
    const row = (l!.l as { user_id: string; confirmed_by: string }[]).find((x) => x.user_id === u)
    expect(row).toMatchObject({ alias: 'Pagador Ref', reference: 'SHABEX-PAGADOR-REF', state: 'confirmed', amount: 50, method: 'SPEI', bank_reference: 'TR-998877' })
    expect(row!.confirmed_by).toMatch(/^Admin/)
    const [audit] = await sql(`select details from public.audit_logs where action = 'member.payment_changed' and entity_id like '%' || $1 order by id desc limit 1`, [u])
    expect(audit!.details).toMatchObject({ reference: 'SHABEX-PAGADOR-REF', amount: 50, method: 'SPEI', to: 'authorized' })
    // Vence: deja de contar como pagado.
    await sql(`update public.group_members set payment_valid_until = now() - interval '1 day' where user_id = $1`, [u])
    expect(((await asUser(u, `select public.get_my_payment() as p`))[0]!.p).state).toBe('expired')
    await asUser(admin, `select public.admin_confirm_payment($1, 'rejected', null, null, null, null, 'Pago devuelto por el banco')`, [u])
    expect(((await asUser(u, `select public.get_my_payment() as p`))[0]!.p).state).toBe('revoked')
    await expectDbError(asUser(u, `select public.admin_payment_list()`), 'FORBIDDEN')
  })
})

describe('clasificación en vivo y privacidad de pronósticos', () => {
  let admin: string
  let p1: string
  let p2: string
  let week: string
  let a: string
  let b: string
  const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  let monday = ''
  const fx = (id: string, h: string, aw: string, day: number) => ({
    external_id: id, kickoff_at: `${addDays(monday, day)}T19:00:00-06:00`, status: 'scheduled', competition: { external_id: '262', name: 'Liga MX' },
    home: { external_id: h, name: `Eq ST ${h}` }, away: { external_id: aw, name: `Eq ST ${aw}` },
  })
  const allOpen = async (uid: string, override: Record<string, string>) => {
    const [p] = await asUser(uid, `select public.get_pool(10) as p`)
    return (p!.p.matches as { match_id: string; open: boolean; pick: { status: string } | null }[])
      .filter((m) => m.open && m.pick?.status !== 'submitted').map((m) => ({ match_id: m.match_id, outcome: override[m.match_id] ?? '1' }))
  }
  const standings = async (uid: string) => (await asUser(uid, `select public.get_week_standings($1) as s`, [week]))[0]!.s
  const detail = async (uid: string, of: string) => (await asUser(uid, `select public.get_week_participant($1, $2) as d`, [week, of]))[0]!.d

  beforeAll(async () => {
    admin = await createAdmin()
    p1 = await createUser('Jugador ST1')
    p2 = await createUser('Jugador ST2')
    const [{ g }] = (await sql(`select id as g from public.groups where is_default`)) as { g: string }[]
    for (const u of [p1, p2]) await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', now() + interval '400 days', 'REF-ST', 'Pago de prueba verificado')`, [g, u])
    const [{ d }] = (await sql(`select to_char(private.local_day(now()) + (8 - extract(isodow from private.local_day(now()))::int) + 70, 'YYYY-MM-DD') as d`)) as { d: string }[]
    monday = d
    const [r] = await asUser(admin, `select public.admin_plan_week($1::date, 5, array[]::text[], array['262'], true) as r`, [monday])
    week = r!.r.id
    await asUser(admin, `select public.admin_set_week_mode($1, 'publish')`, [week])
    await asService(`select public.pool_auto_import('api-football', $1::jsonb)`, [JSON.stringify([fx('st-1', 's1', 's2', 4), fx('st-2', 's3', 's4', 5)])])
    a = ((await sql(`select id from public.matches where external_id = 'st-1'`)) as { id: string }[])[0]!.id
    b = ((await sql(`select id from public.matches where external_id = 'st-2'`)) as { id: string }[])[0]!.id
    for (const [u, goals, pick] of [[p1, 3, '1'], [p2, 8, '2']] as const) {
      await fillWeekGoals(u, 5)
      await asUser(u, `select public.save_week_goals($1, $2)`, [week, goals])
      await asUser(u, `select public.submit_pool_picks($1::jsonb)`, [JSON.stringify(await allOpen(u, { [a]: pick, [b]: 'X' }))])
    }
  })

  it('antes de empezar: quien pagó y envió ve quién eligió qué; quien no ha enviado no ve nada ajeno', async () => {
    const s = await standings(p2)
    expect(s.summary).toMatchObject({ total: 2, finished: 0, live: 0, pending: 2 })
    const rows = s.rows as { user_id: string; guess: number | null; points: number; pending: number }[]
    // p2 ya pagó y envió: ve el total de goles y los pronósticos de p1.
    expect(rows.find((x) => x.user_id === p1)).toMatchObject({ guess: 3, points: 0, pending: 2 })
    expect(rows.find((x) => x.user_id === p2)!.guess).toBe(8)
    const other = await detail(p2, p1)
    expect(other.guess).toBe(3)
    expect(other.matches.map((m: { pick: string | null; hidden: boolean }) => [m.pick, m.hidden])).toEqual([['1', false], ['X', false]])
    const own = await detail(p1, p1)
    expect(own.matches.map((m: { pick: string }) => m.pick)).toEqual(['1', 'X'])
    // Quien no ha enviado (aunque haya pagado) no ve los ajenos: nadie puede copiar.
    const late = await createUser('Jugador ST3')
    const [{ g }] = (await sql(`select id as g from public.groups where is_default`)) as { g: string }[]
    await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', now() + interval '400 days', 'REF-ST', 'Pago de prueba verificado')`, [g, late])
    const hidden = await detail(late, p1)
    expect(hidden.guess).toBeNull()
    expect(hidden.matches.map((m: { pick: string | null; hidden: boolean }) => [m.pick, m.hidden])).toEqual([[null, true], [null, true]])
    expect((((await standings(late)).rows) as { user_id: string; guess: number | null }[]).find((x) => x.user_id === p1)!.guess).toBeNull()
    // Las tablas tampoco dejan leer pronósticos ajenos directamente.
    expect(await asUser(p2, `select * from public.pool_picks where user_id = $1`, [p1])).toEqual([])
    // Enviados ya no se pueden cambiar.
    await asUser(p1, `select public.save_pool_picks($1::jsonb)`, [JSON.stringify([{ match_id: b, outcome: '2' }])]).catch(() => undefined)
    expect(await sql(`select outcome, status from public.pool_picks where user_id = $1 and match_id = $2`, [p1, b])).toEqual([{ outcome: 'X', status: 'submitted' }])
  })

  it('en vivo: no cuenta como acierto ni fallo', async () => {
    await asService(`select public.apply_provider_update($1, '{"status":"live","status_detail":"1H","elapsed":30,"home_goals":1,"away_goals":0}'::jsonb)`, [a])
    const s = await standings(p2)
    expect(s.summary).toMatchObject({ live: 1, pending: 1, finished: 0 })
    const r1 = (s.rows as { user_id: string; points: number; hits: number; misses: number; live: number }[]).find((x) => x.user_id === p1)!
    expect(r1).toMatchObject({ points: 0, hits: 0, misses: 0, live: 1 })
    const other = await detail(p2, p1)
    // p2 ya envió: ve ambos (el que empezó y el que sigue).
    expect(other.matches.map((m: { pick: string | null; result: string }) => [m.pick, m.result])).toEqual([['1', 'live'], ['X', 'pending']])
    expect(other.guess).toBe(3) // la jornada ya empezó: el total ya es público
  })

  it('final confirmado: puntos una sola vez; corrección recalcula sin duplicar', async () => {
    for (let k = 0; k < 2; k++) await asService(`select public.apply_provider_update($1, '{"status":"finished","status_detail":"FT","home_goals":2,"away_goals":0}'::jsonb)`, [a])
    let s = await standings(p1)
    expect(s.summary).toMatchObject({ finished: 1, confirmed: 1, pending: 1 })
    let rows = s.rows as { user_id: string; rank_position: number; points: number; hits: number; misses: number; pending: number }[]
    expect(rows.find((x) => x.user_id === p1)).toMatchObject({ rank_position: 1, points: 1, hits: 1, misses: 0, pending: 1 })
    expect(rows.find((x) => x.user_id === p2)).toMatchObject({ rank_position: 2, points: 0, hits: 0, misses: 1 })
    const d = await detail(p2, p1)
    expect(d.matches[0]).toMatchObject({ result: 'hit', points: 1, home_goals: 2, away_goals: 0 })
    // Corrección del admin: ganó el visitante.
    await asUser(admin, `select public.admin_record_result($1, 0, 1, 'finished', 'Corrección de prueba')`, [a])
    s = await standings(p1)
    rows = s.rows as typeof rows
    expect(rows.find((x) => x.user_id === p1)).toMatchObject({ points: 0, hits: 0, misses: 1 })
    expect(rows.find((x) => x.user_id === p2)).toMatchObject({ rank_position: 1, points: 1, hits: 1 })
    expect(await sql(`select count(*)::int as n from public.pool_scores where match_id = $1`, [a])).toEqual([{ n: 2 }])
  })
})
