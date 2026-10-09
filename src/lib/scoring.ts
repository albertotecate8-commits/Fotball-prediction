// Espejo en TypeScript de las reglas oficiales (public.score_prediction).
// El servidor es la fuente de verdad; esto se usa para explicar las reglas
// en la interfaz y se prueba contra los mismos ejemplos que el SQL.
export const POINTS_OUTCOME = 3
export const POINTS_EXACT_BONUS = 2
export const MAX_POINTS_PER_MATCH = POINTS_OUTCOME + POINTS_EXACT_BONUS

export type Score = { home: number; away: number }

export const outcome = (s: Score) => Math.sign(s.home - s.away) as -1 | 0 | 1

export function scorePrediction(pred: Score, real: Score): number {
  if (pred.home === real.home && pred.away === real.away) return MAX_POINTS_PER_MATCH
  if (outcome(pred) === outcome(real)) return POINTS_OUTCOME
  return 0
}

export const goalError = (pred: Score, real: Score) => Math.abs(pred.home - real.home) + Math.abs(pred.away - real.away)

export const maxPointsFor = (matches: number) => matches * MAX_POINTS_PER_MATCH
