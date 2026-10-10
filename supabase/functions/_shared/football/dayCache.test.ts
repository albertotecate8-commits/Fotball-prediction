import { describe, expect, it, vi } from 'vitest'
import { getDays, type DayCacheStore } from './dayCache'
import type { FootballProvider, NormalizedFixture } from './types'

// Proveedor y partidos ficticios: solo se cuenta cuántas veces se consulta.
const fx = (id: string): NormalizedFixture => ({
  external_id: id, kickoff_at: '2026-10-10T19:00:00Z', status: 'scheduled', status_detail: 'NS', elapsed: null, home_goals: null, away_goals: null,
  competition: undefined, home: { external_id: 'h', name: 'Local', short_name: 'L' }, away: { external_id: 'a', name: 'Visita', short_name: 'V' },
})

function memoryStore() {
  const data = new Map<string, { payload: NormalizedFixture[]; fetchedAt: number }>()
  const locks = new Set<string>()
  let hits = 0
  const store: DayCacheStore = {
    get: async (k) => data.get(k) ?? null,
    put: async (k, payload) => { data.set(k, { payload, fetchedAt: Date.now() }) },
    hit: async (n) => { hits += n },
    lock: async (k) => {
      if (locks.has(k)) return null
      locks.add(k)
      return async () => { locks.delete(k) }
    },
    sleep: () => new Promise((r) => setTimeout(r, 5)),
  }
  return { store, data, hits: () => hits }
}

const provider = (impl: () => Promise<NormalizedFixture[]>) => {
  const searchFixtures = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return impl() })
  return { p: { id: 'api-football', isTestData: false, searchFixtures } as unknown as FootballProvider, searchFixtures }
}
const ctx = { priority: 3 as const, purpose: 'prueba' }

describe('caché compartida por día', () => {
  it('una lectura de caché no consulta al proveedor y se cuenta como acierto, no como solicitud', async () => {
    const s = memoryStore()
    const { p, searchFixtures } = provider(async () => [fx('1')])
    await getDays(s.store, p, ['2026-10-10'], { mode: 'refresh', context: ctx })
    const r = await getDays(s.store, p, ['2026-10-10'], { mode: 'cache-first', maxAgeMin: 30, context: ctx })
    expect(r.fixtures.map((f) => f.external_id)).toEqual(['1'])
    expect(searchFixtures).toHaveBeenCalledTimes(1)
    expect(s.hits()).toBe(1)
    expect(r.fetched).toEqual([])
  })

  it('solo caché: nunca consulta aunque no haya datos', async () => {
    const s = memoryStore()
    const { p, searchFixtures } = provider(async () => [fx('1')])
    expect((await getDays(s.store, p, ['2026-10-10'], { mode: 'cache-only' })).fixtures).toEqual([])
    expect(searchFixtures).not.toHaveBeenCalled()
  })

  it('varias funciones pidiendo el mismo día a la vez: una sola solicitud', async () => {
    const s = memoryStore()
    const { p, searchFixtures } = provider(async () => [fx('1'), fx('2')])
    const results = await Promise.all([1, 2, 3, 4].map(() => getDays(s.store, p, ['2026-10-10'], { mode: 'refresh', context: ctx })))
    expect(searchFixtures).toHaveBeenCalledTimes(1)
    for (const r of results) expect(r.fixtures).toHaveLength(2)
  })

  it('si la consulta falla se conservan los datos guardados', async () => {
    const s = memoryStore()
    const ok = provider(async () => [fx('1')])
    await getDays(s.store, ok.p, ['2026-10-10'], { mode: 'refresh', context: ctx })
    s.data.get('day:2026-10-10')!.fetchedAt -= 10 * 60e3
    const bad = provider(async () => { throw new Error('caído') })
    await expect(getDays(s.store, bad.p, ['2026-10-10'], { mode: 'refresh', context: ctx })).rejects.toThrow('caído')
    expect(s.data.get('day:2026-10-10')!.payload.map((f) => f.external_id)).toEqual(['1'])
  })

  it('una respuesta vacía no borra un día que tenía partidos', async () => {
    const s = memoryStore()
    await getDays(s.store, provider(async () => [fx('1')]).p, ['2026-10-10'], { mode: 'refresh', context: ctx })
    s.data.get('day:2026-10-10')!.fetchedAt -= 10 * 60e3
    const before = s.data.get('day:2026-10-10')!.fetchedAt
    const r = await getDays(s.store, provider(async () => []).p, ['2026-10-10'], { mode: 'refresh', context: ctx })
    expect(r.fixtures.map((f) => f.external_id)).toEqual(['1'])
    expect(s.data.get('day:2026-10-10')!.fetchedAt).toBeGreaterThan(before)
  })
})

it('lo descargado hace menos de 1 min por otra función se reutiliza sin consultar', async () => {
  const s = memoryStore()
  const first = provider(async () => [fx('1')])
  await getDays(s.store, first.p, ['2026-10-10'], { mode: 'refresh', context: ctx })
  const second = provider(async () => [fx('2')])
  const r = await getDays(s.store, second.p, ['2026-10-10'], { mode: 'refresh', context: ctx })
  expect(second.searchFixtures).not.toHaveBeenCalled()
  expect(r.fixtures.map((f) => f.external_id)).toEqual(['1'])
})
