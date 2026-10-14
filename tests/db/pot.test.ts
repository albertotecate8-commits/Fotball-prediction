import { afterAll, describe, expect, it } from 'vitest'
import { asUser, createAdmin, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Pagos FICTICIOS en una base efímera.
describe('bolsa acumulada', () => {
  it('es el 70 % de los pagos confirmados y vigentes; el 30 % no se expone', async () => {
    const admin = await createAdmin()
    const a = await createUser('Pagó A')
    const b = await createUser('Pagó B')
    const c = await createUser('No pagó')
    const [{ id: g }] = (await sql(`select id from public.groups where is_default`)) as { id: string }[]
    await sql(`insert into public.payment_info (id, amount, currency) values (1, 50, 'MXN') on conflict (id) do update set amount = 50`)
    const before = (await asUser(c, `select public.get_prize_pot() as p`))[0]!.p
    for (const u of [a, b]) await asUser(admin, `select public.admin_set_payment($1, $2, 'authorized', null, 'REF-PRUEBA', 'Pago de prueba verificado')`, [g, u])
    const [r] = await asUser(c, `select public.get_prize_pot() as p`)
    expect(Number(r!.p.pot) - Number(before.pot)).toBe(70)
    expect(r!.p.paid_count - before.paid_count).toBe(2)
    expect(Object.keys(r!.p).sort()).toEqual(['configured', 'currency', 'paid_count', 'pot'])

    // Si cambia el costo, los pagos ya confirmados conservan su monto.
    await sql(`update public.payment_info set amount = 100`)
    const [r2] = await asUser(c, `select public.get_prize_pot() as p`)
    expect(Number(r2!.p.pot)).toBe(Number(r!.p.pot))

    // Un participante no puede inflar la bolsa cambiando su monto.
    await expectDbError(sql(`update public.group_members set payment_amount = 9999 where user_id = $1`, [a]), 'USE_PAYMENT_CONFIRMATION')

    // Un pago retirado deja de contar.
    await asUser(admin, `select public.admin_set_payment($1, $2, 'not_applicable', null, '', 'Pago revertido en prueba')`, [g, b])
    const [r3] = await asUser(c, `select public.get_prize_pot() as p`)
    expect(Number(r3!.p.pot)).toBe(Number(r!.p.pot) - 35)
  })
})
