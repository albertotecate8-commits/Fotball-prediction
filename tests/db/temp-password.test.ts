import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asUser, createAdmin, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Cuentas FICTICIAS: el admin pone una contraseña temporal sin correo.
describe('contraseña temporal del admin', () => {
  let admin: string
  let player: string
  beforeAll(async () => {
    admin = await createAdmin()
    player = await createUser('Olvidadizo')
  })

  it('solo el admin; la contraseña funciona y no queda en ningún registro', async () => {
    await expectDbError(asUser(player, `select public.admin_temp_password($1)`, [player]), 'FORBIDDEN')
    const [r] = await asUser(admin, `select public.admin_temp_password($1) as r`, [player])
    const pw = r!.r.password as string
    expect(pw).toMatch(/^GB[2-9A-HJ-NP-Z]{8}$/)
    const [{ ok }] = (await sql(`select encrypted_password = extensions.crypt($2, encrypted_password) as ok from auth.users where id = $1`, [player, pw])) as { ok: boolean }[]
    expect(ok).toBe(true)
    const logs = await sql(`select details::text as d from public.audit_logs where action = 'member.temp_password' and entity_id = $1`, [player])
    expect(logs.length).toBe(1)
    expect((logs[0] as { d: string }).d).not.toContain(pw)
  })

  it('no se puede usar sobre otra cuenta de administración', async () => {
    const other = await createAdmin()
    await expectDbError(asUser(admin, `select public.admin_temp_password($1)`, [other]), 'FORBIDDEN')
  })
})
