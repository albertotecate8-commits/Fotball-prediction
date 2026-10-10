import { afterAll, describe, expect, it } from 'vitest'
import { asAnon, pool, sql } from './helpers'

afterAll(() => pool.end())

// Correos ficticios (.test): ninguna cuenta real.
describe('registro sin duplicados', () => {
  it('distingue correo nuevo, cuenta pendiente y cuenta confirmada sin revelar más datos', async () => {
    await sql(`insert into auth.users (email, raw_user_meta_data) values ('pendiente@signup.test', '{"display_name":"Pendiente"}')`)
    await sql(`insert into auth.users (email, email_confirmed_at, raw_user_meta_data) values ('lista@signup.test', now(), '{"display_name":"Lista"}')`)
    const status = async (e: string) => (await asAnon<{ s: string }>(`select public.auth_email_status($1) as s`, [e]))[0]!.s
    expect(await status('nueva@signup.test')).toBe('new')
    expect(await status('  PENDIENTE@signup.test ')).toBe('pending')
    expect(await status('lista@signup.test')).toBe('registered')
    expect(await status('x'.repeat(300))).toBe('new')
  })

  it('la confirmación de un correo no autorizado no da privilegios de administrador', async () => {
    const [u] = await sql(`insert into auth.users (email, raw_user_meta_data) values ('otra@signup.test', '{"display_name":"Otra"}') returning id`)
    await sql(`update auth.users set email_confirmed_at = now() where id = $1`, [u!.id])
    const [p] = await sql(`select role from public.profiles where id = $1`, [u!.id])
    expect(p!.role).toBe('player')
  })
})
