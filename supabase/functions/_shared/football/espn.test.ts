import { describe, expect, it } from 'vitest'
import { espnRequests, matchEspn, toEspnUpdate, type EspnEvent } from './espn'
import type { FreeTarget } from './freeResults'

// Datos FICTICIOS con la forma del marcador público de ESPN.
const ev = (home: string, away: string, date: string, name: string, state: string, hs = '2', as = '0', completed = state === 'post'): EspnEvent => ({
  date, status: { type: { name, state, completed } },
  competitions: [{ competitors: [{ homeAway: 'home', score: hs, team: { displayName: home } }, { homeAway: 'away', score: as, team: { displayName: away } }] }],
})
const target = (home: string, away: string, kickoff = '2026-10-22T03:00:00Z'): FreeTarget => ({
  match_id: 'm', external_id: '1', kickoff_at: kickoff, league: '262', status: 'live', home_goals: 2, away_goals: 0, home_name: home, away_name: away,
})

describe('resultados de ESPN', () => {
  it('final, en vivo, aplazado; sin marcador no se aplica', () => {
    expect(toEspnUpdate(ev('A', 'B', '', 'STATUS_FULL_TIME', 'post'))).toEqual({ status: 'finished', status_detail: 'FT', home_goals: 2, away_goals: 0 })
    expect(toEspnUpdate(ev('A', 'B', '', 'STATUS_SECOND_HALF', 'in', '1', '1'))).toEqual({ status: 'live', status_detail: 'LIVE', home_goals: 1, away_goals: 1 })
    expect(toEspnUpdate(ev('A', 'B', '', 'STATUS_POSTPONED', 'post'))!.status).toBe('postponed')
    expect(toEspnUpdate(ev('A', 'B', '', 'STATUS_SCHEDULED', 'pre'))).toBeNull()
    expect(toEspnUpdate(ev('A', 'B', '', 'STATUS_FULL_TIME', 'post', ''))).toBeNull()
  })

  it('reconoce el partido por equipos y hora, aunque los nombres varíen', () => {
    const list = [ev('Santos', 'Pumas UNAM', '2026-10-22T03:10Z', 'STATUS_FULL_TIME', 'post'), ev('Pachuca', 'Cruz Azul', '2026-10-22T03:10Z', 'STATUS_FULL_TIME', 'post', '1', '2')]
    expect(matchEspn(target('Santos Laguna', 'U.N.A.M. - Pumas'), list)).toBe(list[0])
    expect(matchEspn(target('CF Pachuca', 'Cruz Azul'), list)).toBe(list[1])
    expect(matchEspn(target('Club America', 'Atlas'), list)).toBeNull()
  })

  it('no confunde equipos parecidos ni partidos de otro día', () => {
    const list = [ev('Manchester City', 'Arsenal', '2026-10-22T03:00Z', 'STATUS_FULL_TIME', 'post')]
    expect(matchEspn(target('Manchester United', 'Arsenal'), list)).toBeNull()
    expect(matchEspn(target('Manchester City', 'Arsenal', '2026-10-25T03:00:00Z'), list)).toBeNull()
    expect(matchEspn(target('Atlas', 'Puebla'), [ev('Atlante', 'Puebla', '2026-10-22T03:00Z', 'STATUS_FULL_TIME', 'post')])).toBeNull()
  })

  it('pide el día UTC y el día de América, una vez por liga', () => {
    expect(espnRequests([target('A', 'B', '2026-10-22T03:00:00Z'), target('C', 'D', '2026-10-22T03:00:00Z')]))
      .toEqual([{ slug: 'mex.1', date: '20261022' }, { slug: 'mex.1', date: '20261021' }])
    expect(espnRequests([{ ...target('A', 'B'), league: '999' }])).toEqual([])
  })
})
