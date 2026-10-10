import { describe, expect, it } from 'vitest'
import { featuredDue, selectFeatured } from './featured.ts'
import type { NormalizedFixture } from './types.ts'

// Partidos FICTICIOS (ids de equipos/ligas reales solo para probar la selección).
const fx = (id: string, home: string, away: string, league: string, kickoff: string, status: NormalizedFixture['status'] = 'scheduled'): NormalizedFixture => ({
  external_id: id, kickoff_at: kickoff, status, status_detail: null, elapsed: null, home_goals: null, away_goals: null,
  competition: { external_id: league, name: `L${league}` },
  home: { external_id: home, name: `T${home}`, short_name: `T${home}` }, away: { external_id: away, name: `T${away}`, short_name: `T${away}` },
})

describe('partidos destacados', () => {
  it('prioriza Barcelona/Real Madrid/Durango, luego Liga MX; descarta lo demás', () => {
    const r = selectFeatured([
      fx('1', '1', '2', '999', '2026-10-10T20:00:00Z'),
      fx('2', '10', '11', '262', '2026-10-10T23:00:00Z'),
      fx('3', '529', '50', '140', '2026-10-11T19:00:00Z'),
      fx('4', '15941', '60', '264', '2026-10-11T01:00:00Z'),
      fx('5', '12', '13', '262', '2026-10-10T21:00:00Z', 'cancelled'),
      fx('2', '10', '11', '262', '2026-10-10T23:00:00Z'),
    ])
    expect(r.map((x) => [x.external_id, x.reason])).toEqual([['3', 'Barcelona'], ['4', 'Durango (México)'], ['2', 'Liga MX']])
  })

  it('refresca cada 3 h, o cada 20 min si hay partidos en juego', () => {
    const now = Date.parse('2026-10-10T12:00:00Z')
    expect(featuredDue(null, now)).toBe(true)
    expect(featuredDue({ refreshed_at: '2026-10-10T10:00:00Z', live: 0 }, now)).toBe(false)
    expect(featuredDue({ refreshed_at: '2026-10-10T08:59:00Z', live: 0 }, now)).toBe(true)
    expect(featuredDue({ refreshed_at: '2026-10-10T11:30:00Z', live: 2 }, now)).toBe(true)
    expect(featuredDue({ refreshed_at: '2026-10-10T11:50:00Z', live: 2 }, now)).toBe(false)
  })
})
