import { describe, expect, it } from 'vitest'
import { findProviderMatch, teamSimilarity, utcDaysAround } from './matching.ts'
import type { NormalizedFixture } from './types.ts'

// Partidos FICTICIOS con nombres reales solo para probar la comparación.
const fx = (id: string, home: string, away: string, kickoff: string, league = '262'): NormalizedFixture => ({
  external_id: id, kickoff_at: kickoff, status: 'scheduled', status_detail: 'NS', elapsed: null, home_goals: null, away_goals: null,
  competition: { external_id: league, name: 'L' }, home: { external_id: `h${id}`, name: home, short_name: home }, away: { external_id: `a${id}`, name: away, short_name: away },
})

const day = [
  fx('1', 'Club Queretaro', 'Atlante FC', '2026-10-10T23:00:00Z'),
  fx('2', 'FC Juarez', 'Club Tijuana', '2026-10-10T23:00:00Z'),
  fx('3', 'Tigres UANL', 'Toluca', '2026-10-10T03:00:00Z'),
  fx('4', 'Real Madrid', 'Barcelona', '2026-10-10T19:00:00Z', '140'),
]

describe('vinculación de partidos manuales', () => {
  it('normaliza acentos, prefijos y abreviaturas', () => {
    expect(teamSimilarity('Querétaro', 'Club Queretaro')).toBe(1)
    expect(teamSimilarity('Tigres', 'Tigres UANL')).toBeGreaterThanOrEqual(0.9)
    expect(teamSimilarity('América', 'Toluca')).toBe(0)
  })

  it('vincula con un único candidato claro', () => {
    const r = findProviderMatch({ home: 'Querétaro', away: 'Atlante', kickoff_at: '2026-10-10T23:00:00Z' }, day)
    expect(r).toMatchObject({ kind: 'linked', fixture: { external_id: '1' } })
  })

  it('respeta la competición indicada', () => {
    expect(findProviderMatch({ home: 'Real Madrid', away: 'Barcelona', kickoff_at: '2026-10-10T19:00:00Z', competitionId: '262' }, day).kind).toBe('not_found')
    expect(findProviderMatch({ home: 'Real Madrid', away: 'Barcelona', kickoff_at: '2026-10-10T19:00:00Z', competitionId: '140' }, day).kind).toBe('linked')
  })

  it('no vincula si la fecha está lejos ni si local y visitante están invertidos (lo sugiere)', () => {
    expect(findProviderMatch({ home: 'Querétaro', away: 'Atlante', kickoff_at: '2026-10-13T23:00:00Z' }, day).kind).toBe('not_found')
    const swapped = findProviderMatch({ home: 'Atlante', away: 'Querétaro', kickoff_at: '2026-10-10T23:00:00Z' }, day)
    expect(swapped.kind).toBe('not_found')
    expect(swapped.kind === 'not_found' && swapped.suggestions.map((f) => f.external_id)).toEqual(['1'])
  })

  it('varios candidatos parecidos: no adivina', () => {
    const twins = [fx('7', 'Atlas', 'Leon', '2026-10-10T23:00:00Z'), fx('8', 'Atlas Femenil', 'Leon Femenil', '2026-10-10T20:00:00Z')]
    expect(findProviderMatch({ home: 'Atlas', away: 'León', kickoff_at: '2026-10-10T22:00:00Z' }, twins).kind).toBe('linked')
    const same = [fx('7', 'Atlas', 'Leon', '2026-10-10T23:00:00Z'), fx('9', 'Atlas', 'Leon', '2026-10-11T02:00:00Z')]
    expect(findProviderMatch({ home: 'Atlas', away: 'León', kickoff_at: '2026-10-10T23:30:00Z' }, same).kind).toBe('ambiguous')
  })

  it('días UTC a consultar alrededor del inicio', () => {
    expect(utcDaysAround('2026-10-10T12:00:00Z')).toEqual(['2026-10-10'])
    expect(utcDaysAround('2026-10-11T02:00:00Z')).toEqual(['2026-10-10', '2026-10-11'])
  })
})
