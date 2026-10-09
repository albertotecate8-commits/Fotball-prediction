import { describe, expect, it } from 'vitest'
import { MockProvider } from './mock.ts'

describe('proveedor de demostración', () => {
  const now = new Date('2026-10-10T12:00:00Z')
  const p = new MockProvider(() => now)

  it('marca sus datos como ficticios y es determinista', async () => {
    expect(p.isTestData).toBe(true)
    const a = await p.searchFixtures({ from: '2026-10-11', to: '2026-10-11' })
    const b = await p.searchFixtures({ from: '2026-10-11', to: '2026-10-11' })
    expect(a).toHaveLength(6)
    expect(a).toEqual(b)
    expect(a.every((f) => f.status === 'scheduled' && f.home_goals === null)).toBe(true)
  })

  it('partidos pasados terminan con marcador; nunca se muestran resultados futuros', async () => {
    const past = await p.searchFixtures({ from: '2026-10-08', to: '2026-10-08' })
    expect(past.every((f) => f.status === 'finished' && f.home_goals !== null)).toBe(true)
    const future = await p.searchFixtures({ from: '2026-10-12', to: '2026-10-20' })
    expect(future.every((f) => f.home_goals === null)).toBe(true)
  })

  it('getFixturesByIds devuelve solo los pedidos', async () => {
    const [first] = await p.searchFixtures({ from: '2026-10-11', to: '2026-10-11' })
    const r = await p.getFixturesByIds([first!.external_id, 'nope'])
    expect(r.map((f) => f.external_id)).toEqual([first!.external_id])
  })
})
