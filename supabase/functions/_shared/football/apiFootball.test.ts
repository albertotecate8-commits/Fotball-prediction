import { describe, expect, it, vi } from 'vitest'
import { ApiFootballProvider, classifyApiFootballErrors, mapApiFootballStatus, normalizeApiFootballFixture } from './apiFootball.ts'
import { createProvider, defaultProviderId, realProviderConfigured } from './index.ts'
import { ProviderError, type RequestGate } from './types.ts'

// Respuestas FICTICIAS con la forma documentada de API-Football (solo pruebas).
const fixture = (over: Record<string, unknown> = {}) => ({
  fixture: { id: 1001, date: '2026-10-12T02:00:00+00:00', status: { short: 'FT', elapsed: 90 } },
  league: { id: 262, name: 'Liga de prueba', country: 'Test', season: 2026, logo: null },
  teams: { home: { id: 1, name: 'Club Local', logo: null }, away: { id: 2, name: 'Visitante FC', logo: null } },
  goals: { home: 2, away: 1 },
  score: { fulltime: { home: 2, away: 1 } },
  ...over,
})

const ok = (response: unknown[]) => new Response(JSON.stringify({ errors: [], results: response.length, response }), { status: 200 })

describe('mapeo de estados de API-Football', () => {
  it.each([
    ['NS', 'scheduled'], ['TBD', 'scheduled'], ['1H', 'live'], ['HT', 'live'], ['2H', 'live'], ['ET', 'live'], ['P', 'live'],
    ['FT', 'finished'], ['AET', 'finished'], ['PEN', 'finished'], ['PST', 'postponed'], ['SUSP', 'suspended'],
    ['INT', 'suspended'], ['CANC', 'cancelled'], ['ABD', 'abandoned'], ['AWD', 'unknown'], ['WO', 'unknown'], ['???', 'unknown'],
  ])('%s → %s', (code, expected) => expect(mapApiFootballStatus(code)).toBe(expected))
})

describe('normalización', () => {
  it('usa el marcador de 90 minutos cuando hubo tiempo extra/penales', () => {
    const f = normalizeApiFootballFixture(fixture({
      fixture: { id: 5, date: '2026-10-12T02:00:00Z', status: { short: 'PEN', elapsed: 120 } },
      goals: { home: 2, away: 2 }, score: { fulltime: { home: 1, away: 1 } },
    }) as never)
    expect(f).toMatchObject({ status: 'finished', home_goals: 1, away_goals: 1, external_id: '5' })
  })
  it('no expone marcador para partidos no iniciados o aplazados', () => {
    const f = normalizeApiFootballFixture(fixture({ fixture: { id: 6, date: '2026-10-12T02:00:00Z', status: { short: 'PST', elapsed: null } }, goals: { home: null, away: null } }) as never)
    expect(f).toMatchObject({ status: 'postponed', home_goals: null, away_goals: null })
  })
  it('normaliza la fecha a ISO UTC y limpia prefijos del nombre', () => {
    const f = normalizeApiFootballFixture(fixture() as never)
    expect(f.kickoff_at).toBe('2026-10-12T02:00:00.000Z')
    expect(f.home.short_name).toBe('Local')
  })
})

describe('cliente HTTP', () => {
  const sleep = () => Promise.resolve()

  it('pide por lotes de 20 ids y envía la clave en cabecera', async () => {
    const fetchImpl = vi.fn(async () => ok([fixture()]))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl: fetchImpl as never, sleep })
    await p.getFixturesByIds(Array.from({ length: 45 }, (_, i) => String(i)))
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('ids=0-1-2')
    expect((init.headers as Record<string, string>)['x-apisports-key']).toBe('k')
  })

  it('reintenta ante 429/5xx y luego tiene éxito', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok([fixture()]))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl, sleep, retries: 2 })
    const r = await p.getFixturesByIds(['1001'])
    expect(r).toHaveLength(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('proveedor no disponible: error reintentable tras agotar intentos', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl, sleep, retries: 1 })
    await expect(p.getFixturesByIds(['1'])).rejects.toMatchObject({ name: 'ProviderError', retryable: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('clave inválida: el error del cuerpo no se reintenta', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: { token: 'Error/Missing application key' }, response: [] }), { status: 200 }))
    const p = new ApiFootballProvider({ apiKey: 'bad', fetchImpl: fetchImpl as never, sleep })
    await expect(p.getFixturesByIds(['1'])).rejects.toBeInstanceOf(ProviderError)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('sin clave no se puede construir', () => {
    expect(() => new ApiFootballProvider({ apiKey: '' })).toThrow(/API_FOOTBALL_KEY/)
  })
})

/** Control de cuota en memoria (en producción vive en provider_usage). */
function memoryGate(budget: number) {
  let used = 0
  const reports: { remainingDaily: number | null; limitDaily: number | null; error?: string | null }[] = []
  const gate: RequestGate = {
    take: async () => (used < budget ? (used++, { allowed: true }) : { allowed: false, reason: 'DAILY_BUDGET' }),
    report: async (r) => { reports.push(r) },
  }
  return { gate, reports, used: () => used }
}

const withHeaders = (body: unknown, status = 200, remaining = '57', limit = '100') =>
  new Response(JSON.stringify(body), { status, headers: { 'x-ratelimit-requests-remaining': remaining, 'x-ratelimit-requests-limit': limit } })

describe('protección de la cuota', () => {
  const sleep = () => Promise.resolve()

  it('reserva cupo antes de cada solicitud y guarda lo que informa el proveedor', async () => {
    const g = memoryGate(10)
    const fetchImpl = vi.fn(async () => withHeaders({ errors: [], results: 1, response: [fixture()] }))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl: fetchImpl as never, sleep, gate: g.gate })
    await p.getFixturesByIds(['1001'])
    expect(g.used()).toBe(1)
    expect(g.reports[0]).toEqual({ remainingDaily: 57, limitDaily: 100 })
  })

  it('sin cupo no hace la solicitud HTTP y no se reintenta', async () => {
    const g = memoryGate(0)
    const fetchImpl = vi.fn()
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl, sleep, gate: g.gate })
    await expect(p.getFixturesByIds(['1'])).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED', retryable: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('cada reintento consume cupo: un bucle de errores no puede agotar la cuota', async () => {
    const g = memoryGate(2)
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 }))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl: fetchImpl as never, sleep, gate: g.gate, retries: 5 })
    await expect(p.getFixturesByIds(['1'])).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('espera progresiva, más larga ante límite por minuto', async () => {
    const waits: number[] = []
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(new Response('', { status: 429 }))
      .mockResolvedValueOnce(ok([fixture()]))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl, sleep: async (ms) => { waits.push(ms) }, retries: 2 })
    await p.getFixturesByIds(['1'])
    expect(waits).toEqual([6000, 12000])
  })

  it('cuota diaria del proveedor agotada: no reintenta y registra el error', async () => {
    const g = memoryGate(10)
    const fetchImpl = vi.fn(async () => withHeaders({ errors: { requests: 'You have reached the request limit for the day' }, response: [] }, 200, '0'))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl: fetchImpl as never, sleep, gate: g.gate })
    await expect(p.getFixturesByIds(['1'])).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(g.reports.at(-1)?.error).toMatch(/request limit/)
  })
})

describe('clasificación de errores', () => {
  it.each([
    [{ token: 'Error/Missing application key' }, 'INVALID_KEY'],
    [{ plan: 'Free plans do not have access to this season, try from 2022 to 2024.' }, 'PLAN_RESTRICTED'],
    [{ requests: 'You have reached the request limit for the day' }, 'QUOTA_EXHAUSTED'],
    [{ rateLimit: 'Too many requests. Your rate limit is 10 requests per minute.' }, 'RATE_LIMITED'],
    [{ date: 'The Date field must contain a valid date' }, 'BAD_REQUEST'],
  ])('%j → %s', (errors, code) => expect(classifyApiFootballErrors(errors).code).toBe(code))

  it('HTTP 401/403 → INVALID_KEY sin reintentos', async () => {
    const fetchImpl = vi.fn(async () => new Response('', { status: 403 }))
    const p = new ApiFootballProvider({ apiKey: 'bad', fetchImpl: fetchImpl as never, sleep: async () => {} })
    await expect(p.getFixturesByIds(['1'])).rejects.toMatchObject({ code: 'INVALID_KEY' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('temporada fuera del plan: PLAN_RESTRICTED', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: { plan: 'Free plans do not have access to this season' }, response: [] }), { status: 200 }))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl: fetchImpl as never, sleep: async () => {} })
    await expect(p.searchFixtures({ competitionId: '262', season: '2026', from: '2026-10-10', to: '2026-10-20' })).rejects.toMatchObject({ code: 'PLAN_RESTRICTED' })
  })
})

describe('búsqueda agrupada', () => {
  it('competición + rango de fechas = una sola solicitud', async () => {
    const fetchImpl = vi.fn(async () => ok([fixture()]))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl: fetchImpl as never })
    await p.searchFixtures({ competitionId: '262', season: '2026', from: '2026-10-10', to: '2026-10-20' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0])
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ league: '262', season: '2026', from: '2026-10-10', to: '2026-10-20' })
  })

  it('sin competición solo se permite un día (todas las ligas en una solicitud)', async () => {
    const fetchImpl = vi.fn(async () => ok([]))
    const p = new ApiFootballProvider({ apiKey: 'k', fetchImpl: fetchImpl as never })
    await p.searchFixtures({ from: '2026-10-10' })
    expect(new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]).searchParams.get('date')).toBe('2026-10-10')
    await expect(p.searchFixtures({ from: '2026-10-10', to: '2026-10-15' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(p.searchFixtures({ competitionId: '262' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('status() no consume cuota propia y nunca devuelve la clave', async () => {
    const g = memoryGate(0)
    const fetchImpl = vi.fn(async () => withHeaders({ errors: [], results: 1, response: { subscription: { plan: 'Free', active: true }, requests: { current: 3, limit_day: 100 } } }))
    const p = new ApiFootballProvider({ apiKey: 'SECRET-KEY-123', fetchImpl: fetchImpl as never, gate: g.gate })
    const s = await p.status()
    expect(s).toMatchObject({ ok: true, plan: 'Free', active: true, requests_today: 3, requests_limit: 100, is_test_data: false })
    expect(JSON.stringify(s)).not.toContain('SECRET-KEY-123')
  })

  it('status() con clave inválida: ok=false sin la clave en el mensaje', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ errors: { token: 'Error/Missing application key' }, response: [] }), { status: 200 }))
    const p = new ApiFootballProvider({ apiKey: 'SECRET-KEY-123', fetchImpl: fetchImpl as never })
    const s = await p.status()
    expect(s.ok).toBe(false)
    expect(s.error).toMatch(/application key/)
    expect(JSON.stringify(s)).not.toContain('SECRET-KEY-123')
  })
})

describe('selección del proveedor', () => {
  it('sin clave: demostración; con clave: real; FOOTBALL_PROVIDER=mock fuerza demostración', () => {
    expect(realProviderConfigured({})).toBe(false)
    expect(defaultProviderId({})).toBe('mock')
    expect(defaultProviderId({ API_FOOTBALL_KEY: 'k' })).toBe('api-football')
    expect(defaultProviderId({ API_FOOTBALL_KEY: 'k', FOOTBALL_PROVIDER: 'mock' })).toBe('mock')
  })
  it('pedir el real sin clave falla con NOT_CONFIGURED (nunca cae a datos ficticios)', () => {
    expect(() => createProvider('api-football', {})).toThrow(expect.objectContaining({ code: 'NOT_CONFIGURED' }))
    expect(createProvider('mock', {}).isTestData).toBe(true)
    expect(createProvider('api-football', { API_FOOTBALL_KEY: 'k' }).isTestData).toBe(false)
  })
})
