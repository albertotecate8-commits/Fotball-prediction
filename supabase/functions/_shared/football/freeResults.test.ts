import { describe, expect, it } from 'vitest'
import { freeRequests, shouldApply, toFreeUpdate, type FreeTarget } from './freeResults'

const t = (over: Partial<FreeTarget> = {}): FreeTarget => ({ match_id: 'm', external_id: '1550993', kickoff_at: '2026-10-17T01:00:00Z', league: '262', status: 'scheduled', home_goals: null, away_goals: null, ...over })

describe('resultados de respaldo (TheSportsDB)', () => {
  it('convierte en vivo, final, aplazado y cancelado', () => {
    expect(toFreeUpdate({ strStatus: '2H', intHomeScore: '0', intAwayScore: '1' })).toEqual({ status: 'live', status_detail: '2H', home_goals: 0, away_goals: 1 })
    expect(toFreeUpdate({ strStatus: 'FT', intHomeScore: '0', intAwayScore: '1' })).toEqual({ status: 'finished', status_detail: 'FT', home_goals: 0, away_goals: 1 })
    expect(toFreeUpdate({ strStatus: 'Match Finished', intHomeScore: '2', intAwayScore: '2' })).toMatchObject({ status: 'finished', status_detail: 'FT' })
    expect(toFreeUpdate({ strStatus: 'PST' })).toMatchObject({ status: 'postponed' })
    expect(toFreeUpdate({ strStatus: 'CANC' })).toMatchObject({ status: 'cancelled' })
    expect(toFreeUpdate({ strStatus: 'NS' })).toBeNull()
    // Final sin marcador: nunca se marca finalizado.
    expect(toFreeUpdate({ strStatus: 'FT', intHomeScore: null, intAwayScore: '1' })).toBeNull()
  })
  it('nunca retrocede un partido final ni repite lo mismo', () => {
    expect(shouldApply(t({ status: 'finished', home_goals: 0, away_goals: 1 }), { status: 'live', status_detail: '2H', home_goals: 0, away_goals: 1 })).toBe(false)
    expect(shouldApply(t({ status: 'live', home_goals: 0, away_goals: 1 }), { status: 'live', status_detail: '2H', home_goals: 0, away_goals: 1 })).toBe(false)
    expect(shouldApply(t({ status: 'live', home_goals: 0, away_goals: 1 }), { status: 'finished', status_detail: 'FT', home_goals: 0, away_goals: 1 })).toBe(true)
  })
  it('una consulta por día y liga; ligas desconocidas no consultan', () => {
    expect(freeRequests([t(), t({ match_id: 'b' }), t({ league: '263', kickoff_at: '2026-10-18T03:00:00Z' }), t({ league: '999' })]))
      .toEqual([{ date: '2026-10-17', tsdb: '4350' }, { date: '2026-10-18', tsdb: '4654' }])
  })
})
