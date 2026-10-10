import { afterAll, describe, expect, it } from 'vitest'
import { asService, asUser, createAdmin, createUser, expectDbError, pool, sql } from './helpers'

afterAll(() => pool.end())

// Todo simulado en una base efímera: ninguna solicitud sale a API-Football.
// Cada prueba usa su propio nombre de proveedor para no mezclar contadores.
const reserve = (provider: string, priority = 1, counted = true) =>
  asService<{ r: { allowed: boolean; reason?: string; request_id?: number; effective_remaining: number } }>(
    `select public.provider_reserve($1, $2, 'prueba', '/fixtures?date=2026-10-10', $3) as r`, [provider, priority, counted],
  ).then((rows) => rows[0]!.r)
const finish = (id: number, outcome: string, remaining: number | null = null, limit: number | null = null, http = 200) =>
  asService(`select public.provider_finish($1, $2, $3, $4, $5, 120, 3, null) as r`, [id, outcome, http, remaining, limit]).then((r) => r[0]!.r)
const state = (provider: string) => asService<{ s: Record<string, unknown> }>(`select public.provider_quota_state($1) as s`, [provider]).then((r) => r[0]!.s)
/** Simula que pasó el minuto (el límite por minuto no interfiere con las pruebas de presupuesto). */
const passMinute = (provider: string) => sql(`update public.provider_requests set created_at = created_at - interval '2 minutes' where provider = $1`, [provider])

describe('presupuesto de API-Football', () => {
  it('el presupuesto diario nunca supera 80 aunque se cambie el ajuste', async () => {
    await sql(`update public.app_settings set value = '500' where key = 'api_daily_budget'`)
    expect((await state('qa-cap')).budget).toBe(80)
    await sql(`update public.app_settings set value = '80' where key = 'api_daily_budget'`)
  })

  it('funciones concurrentes: la reserva es atómica y respeta el límite por minuto', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => reserve('qa-minute')))
    expect(results.filter((r) => r.allowed)).toHaveLength(8)
    expect(new Set(results.filter((r) => !r.allowed).map((r) => r.reason))).toEqual(new Set(['MINUTE_LIMIT']))
    const [u] = await sql(`select requests, blocked from public.provider_usage where provider = 'qa-minute'`)
    expect(u).toEqual({ requests: 8, blocked: 12 })
  })

  it('exactamente 80 solicitudes por día, también con reservas simultáneas; la 81 se bloquea', async () => {
    let allowed = 0
    for (let batch = 0; batch < 11; batch++) {
      const r = await Promise.all(Array.from({ length: 8 }, () => reserve('qa-budget')))
      allowed += r.filter((x) => x.allowed).length
      await passMinute('qa-budget')
    }
    expect(allowed).toBe(80)
    const blocked = await reserve('qa-budget')
    expect(blocked).toMatchObject({ allowed: false, reason: 'BUDGET_EXHAUSTED' })
    const s = await state('qa-budget')
    expect(s).toMatchObject({ used: 80, remaining_internal: 0, effective_remaining: 0 })
    const [{ n }] = await sql(`select count(*)::int as n from public.provider_requests where provider = 'qa-budget' and counted`)
    expect(n).toBe(80)
  })

  it('prioridades: con poca cuota solo pasa lo vital (en vivo primero)', async () => {
    await sql(`insert into public.provider_usage (provider, usage_date, requests) values ('qa-prio', (now() at time zone 'utc')::date, 70)`)
    // Quedan 10: en vivo (1) y próximos (2) sí; calendario (3) y panel (5) no.
    expect((await reserve('qa-prio', 1)).allowed).toBe(true)
    expect((await reserve('qa-prio', 2)).allowed).toBe(true)
    expect(await reserve('qa-prio', 3)).toMatchObject({ allowed: false, reason: 'LOW_BUDGET_P3' })
    expect(await reserve('qa-prio', 5)).toMatchObject({ allowed: false, reason: 'LOW_BUDGET_P5' })
  })

  it('el saldo informado por el proveedor manda si es menor (margen de 20)', async () => {
    const r = await reserve('qa-provider')
    await finish(r.request_id!, 'success', 30, 100)
    // 80 - 1 propio = 79, pero el proveedor dice 30 → 30 - 20 = 10 utilizables.
    expect((await state('qa-provider')).effective_remaining).toBe(10)
    const r2 = await reserve('qa-provider')
    await finish(r2.request_id!, 'success', 20, 100)
    expect(await state('qa-provider')).toMatchObject({ paused: true, pause_reason: 'PROVIDER_MARGIN', effective_remaining: 0 })
    expect(await reserve('qa-provider')).toMatchObject({ allowed: false, reason: 'PAUSED:PROVIDER_MARGIN' })
  })

  it('detecta consumo ajeno con la misma clave', async () => {
    const r = await reserve('qa-shared')
    await finish(r.request_id!, 'success', 50, 100) // el proveedor contó 50; SHABEX solo 1
    expect((await state('qa-shared')).external_usage).toBe(true)
  })

  it('HTTP 429: pausa breve; cuota diaria del proveedor agotada: pausa hasta el reinicio (00:00 UTC)', async () => {
    const r = await reserve('qa-429')
    await finish(r.request_id!, 'rate_limited', null, null, 429)
    expect(await reserve('qa-429')).toMatchObject({ allowed: false, reason: 'PAUSED:RATE_LIMITED' })
    const [p] = await sql(`select paused_until > now() + interval '1 minute' and paused_until <= now() + interval '2 minutes' as ok from public.provider_usage where provider = 'qa-429'`)
    expect(p!.ok).toBe(true)

    const d = await reserve('qa-daily')
    await finish(d.request_id!, 'quota_exhausted', 0, 100)
    const [q] = await sql(`select paused_until = ((now() at time zone 'utc')::date + 1)::timestamp at time zone 'utc' as midnight from public.provider_usage where provider = 'qa-daily'`)
    expect(q!.midnight).toBe(true)
  })

  it('reinicio correcto: un día UTC nuevo empieza con el presupuesto completo y sin pausa', async () => {
    await sql(`update public.provider_usage set usage_date = usage_date - 1 where provider in ('qa-budget', 'qa-daily')`)
    expect(await state('qa-budget')).toMatchObject({ used: 0, effective_remaining: 80, paused: false })
    expect(await state('qa-daily')).toMatchObject({ paused: false, effective_remaining: 80 })
    expect((await reserve('qa-budget')).allowed).toBe(true)
  })

  it('las respuestas de caché no cuentan como solicitudes; el resultado se registra una sola vez', async () => {
    await asService(`select public.provider_cache_hit('qa-cache', 5)`)
    expect(await state('qa-cache')).toMatchObject({ used: 0, cache_hits: 5 })
    const r = await reserve('qa-cache')
    expect((await finish(r.request_id!, 'success')).applied).toBe(true)
    expect((await finish(r.request_id!, 'error')).applied).toBe(false)
    expect(await state('qa-cache')).toMatchObject({ used: 1, succeeded: 1, failed: 0 })
    // /status no cuenta para el presupuesto.
    await reserve('qa-cache', 5, false)
    expect((await state('qa-cache')).used).toBe(1)
  })
})

describe('seguridad del consumo y panel', () => {
  it('los participantes no ven ni modifican registros internos de consumo', async () => {
    const player = await createUser('Jugador cuota')
    await expectDbError(asUser(player, `select * from public.provider_requests`), 'permission denied')
    expect(await asUser(player, `select * from public.provider_usage`)).toEqual([])
    await expectDbError(asUser(player, `select public.provider_reserve('api-football', 1, 'x', 'y', true)`), 'permission denied')
    await expectDbError(asUser(player, `select public.provider_finish(1, 'success', 200, 1, 1, 1, 1, null)`), 'permission denied')
    await expectDbError(asUser(player, `update public.provider_usage set requests = 0`), 'permission denied')
    await expectDbError(asUser(player, `select public.admin_api_usage()`), 'FORBIDDEN')
    // Solo ven cuándo se actualizaron los resultados.
    const [f] = await asUser(player, `select public.get_results_freshness() as f`)
    expect(Object.keys(f!.f).sort()).toEqual(['delayed', 'updated_at'])
  })

  it('solo el administrador autorizado abre el panel «Consumo API»; sin claves ni cabeceras', async () => {
    const intruder = await createUser('Admin no autorizado')
    await sql(`update public.profiles set role = 'admin' where id = $1`, [intruder])
    await expectDbError(asUser(intruder, `select public.admin_api_usage()`), 'FORBIDDEN')

    const admin = await createAdmin()
    const r = await reserve('api-football', 3)
    await finish(r.request_id!, 'success', 60, 100)
    const [row] = await asUser(admin, `select public.admin_api_usage() as u`)
    const u = row!.u
    expect(u).toMatchObject({ budget: 80, margin: 20, status: expect.stringMatching(/normal|low|paused|error/) })
    expect(u.recent[0]).toMatchObject({ endpoint: '/fixtures?date=2026-10-10', outcome: 'success', counted: true })
    expect(JSON.stringify(u)).not.toMatch(/x-apisports-key|apikey|token/i)
  })

  it('pronósticos y clasificación funcionan aunque la API esté pausada', async () => {
    await sql(`insert into public.provider_usage (provider, usage_date, paused_until, pause_reason) values ('api-football', (now() at time zone 'utc')::date, now() + interval '1 hour', 'RATE_LIMITED')
               on conflict (provider, usage_date) do update set paused_until = excluded.paused_until, pause_reason = excluded.pause_reason`)
    const player = await createUser('Jugador sin API')
    const [p] = await asUser(player, `select public.get_pool(10) as p`)
    expect(Array.isArray(p!.p.matches)).toBe(true)
    await asUser(player, `select * from public.get_pool_leaderboard()`)
    const [f] = await asUser(player, `select public.get_results_freshness() as f`)
    expect(f!.f.delayed).toBe(true)
    await sql(`update public.provider_usage set paused_until = null where provider = 'api-football'`)
  })
})
