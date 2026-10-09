import { describe, expect, it, vi } from 'vitest'
import { ApiFootballProvider, mapApiFootballStatus, normalizeApiFootballFixture } from './apiFootball.ts'
import { ProviderError } from './types.ts'

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
