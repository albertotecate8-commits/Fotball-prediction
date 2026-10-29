import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createAdmin, createUser, pool, sql } from './helpers'

afterAll(() => pool.end())

// Pagos FICTICIOS: cada pago cubre la quiniela de su semana (lunes a domingo, CDMX).
describe('el pago vale solo para su semana', () => {
  let admin: string
  let player: string
  const member = async (u: string) => ((await sql(`select payment_status, payment_valid_until, private.week_close(now()) as close
    from public.group_members where user_id = $1 and group_id = private.default_group_id()`, [u])) as { payment_status: string; payment_valid_until: Date; close: Date }[])[0]!

  beforeAll(async () => {
    admin = await createAdmin()
    player = await createUser('Pago semanal')
  })

  it('confirmado sin vigencia: vence al terminar el domingo de esta semana', async () => {
    await asUser(admin, `select public.admin_confirm_payment($1, 'authorized', null, null, null, null, null)`, [player])
    const m = await member(player)
    expect(m.payment_status).toBe('authorized')
    expect(new Date(m.payment_valid_until).toISOString()).toBe(new Date(m.close).toISOString())
    // Lunes 00:00 en CDMX y dentro de los próximos 7 días.
    const [{ local }] = (await sql(`select to_char($1::timestamptz at time zone 'America/Mexico_City', 'ID HH24:MI') as local`, [m.payment_valid_until])) as { local: string }[]
    expect(local).toBe('1 00:00')
    const left = new Date(m.payment_valid_until).getTime() - Date.now()
    expect(left).toBeGreaterThan(0)
    expect(left).toBeLessThanOrEqual(7 * 86400e3 + 3600e3)
    const [p] = await asUser(player, `select public.get_my_payment() as p`)
    expect(p!.p.state).toBe('confirmed')
  })

  it('un pago de una semana anterior ya no cuenta como confirmado', async () => {
    await sql(`select set_config('shabex.payment_rpc', 'on', false)`)
    await sql(`update public.group_members set payment_confirmed_at = now() - interval '10 days', payment_valid_until = null
      where user_id = $1 and group_id = private.default_group_id()`, [player])
    await sql(`select set_config('shabex.payment_rpc', 'off', false)`)
    const m = await member(player)
    expect(new Date(m.payment_valid_until).getTime()).toBeLessThan(Date.now())
    const [p] = await asUser(player, `select public.get_my_payment() as p`)
    expect(p!.p.state).toBe('expired')
  })

  it('una vigencia fijada a mano se respeta', async () => {
    await asUser(admin, `select public.admin_confirm_payment($1, 'authorized', now() + interval '30 days', null, null, null, null)`, [player])
    expect(new Date((await member(player)).payment_valid_until).getTime()).toBeGreaterThan(Date.now() + 29 * 86400e3)
  })
})
