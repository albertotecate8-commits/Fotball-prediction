import { describe, expect, it } from 'vitest'
import { freeRequests, pickEvent, roundsByLeague, searchQuery, shouldApply, toFreeUpdate, type FreeTarget } from './freeResults'

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
  it('busca por nombre y elige el evento por su id oficial', () => {
    expect(searchQuery('Real Betis', 'Barcelona')).toBe('Real_Betis_vs_Barcelona')
    expect(searchQuery('U.N.A.M. - Pumas', 'Atlético San Luis')).toBe('U_N_A_M_Pumas_vs_Atletico_San_Luis')
    const evs = [{ idEvent: '1', idAPIfootball: '999' }, { idEvent: '2506255', idAPIfootball: '1570413' }]
    expect(pickEvent(evs, '1570413')?.idEvent).toBe('2506255')
    expect(pickEvent(evs, '123')).toBeNull()
    expect(pickEvent(null, '1570413')).toBeNull()
  })
  it('saca la jornada (ronda y temporada) de los eventos del día para pedirla completa', () => {
    const r = roundsByLeague([{ intRound: '13', strSeason: '2026-2027', idLeague: '4350' }, { intRound: '13', strSeason: '2026-2027' }, { intRound: 'x', strSeason: '2026' }], '4350')
    expect([...r.entries()]).toEqual([['4350:13:2026-2027', { round: '13', season: '2026-2027' }]])
  })
})
