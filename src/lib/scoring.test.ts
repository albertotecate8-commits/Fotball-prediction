import { describe, expect, it } from 'vitest'
import { goalError, maxPointsFor, scorePrediction } from './scoring'

describe('reglas oficiales de puntuación', () => {
  // Tabla del reglamento: real, pronóstico, puntos
  it.each([
    ['2-1', '2-1', 5],
    ['2-1', '3-1', 3],
    ['2-1', '1-0', 3],
    ['2-1', '0-2', 0],
    ['1-1', '1-1', 5],
    ['1-1', '0-0', 3],
    ['1-1', '2-1', 0],
    ['0-2', '1-3', 3], // victoria visitante
    ['0-2', '2-0', 0],
    ['3-0', '1-0', 3], // victoria local
  ])('real %s, pronóstico %s → %i', (real, pred, pts) => {
    const [rh, ra] = real.split('-').map(Number) as [number, number]
    const [ph, pa] = pred.split('-').map(Number) as [number, number]
    expect(scorePrediction({ home: ph, away: pa }, { home: rh, away: ra })).toBe(pts)
  })

  it('el marcador exacto incluye el acierto 1X2 (3 + 2)', () => {
    expect(scorePrediction({ home: 4, away: 4 }, { home: 4, away: 4 })).toBe(5)
  })

  it('máximo 50 puntos en una jornada de 10 partidos', () => {
    expect(maxPointsFor(10)).toBe(50)
  })

  it('error de goles', () => {
    expect(goalError({ home: 3, away: 1 }, { home: 1, away: 2 })).toBe(3)
  })
})
