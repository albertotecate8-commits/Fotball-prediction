// Vincula un partido capturado a mano con el partido del proveedor:
// mismos equipos (nombres normalizados), fecha cercana y, si se indicó,
// la misma competición. Solo se vincula cuando hay UN candidato claro.
import type { NormalizedFixture } from './types.ts'

const STOP = new Set(['club', 'fc', 'cf', 'cd', 'sc', 'ac', 'de', 'del', 'la', 'el', 'futbol', 'football', 'deportivo', 'atletico'])

export function normalizeTeam(name: string): string[] {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w))
}

/** 1 = coincidencia total; 0 = ninguna. */
export function teamSimilarity(a: string, b: string): number {
  const ta = normalizeTeam(a)
  const tb = normalizeTeam(b)
  if (!ta.length || !tb.length) return 0
  const ja = ta.join(' ')
  const jb = tb.join(' ')
  if (ja === jb) return 1
  if (ja.includes(jb) || jb.includes(ja)) return 0.9
  const setB = new Set(tb)
  const common = ta.filter((w) => setB.has(w) || tb.some((x) => x.length >= 4 && (x.startsWith(w) || w.startsWith(x)))).length
  return common / Math.max(ta.length, tb.length)
}

export interface ManualMatchInput {
  home: string
  away: string
  /** ISO UTC */
  kickoff_at: string
  competitionId?: string
}

export type MatchDecision =
  | { kind: 'linked'; fixture: NormalizedFixture; score: number }
  | { kind: 'ambiguous'; candidates: NormalizedFixture[] }
  | { kind: 'not_found'; suggestions: NormalizedFixture[] }

const MAX_HOURS = 6

export function findProviderMatch(input: ManualMatchInput, fixtures: NormalizedFixture[]): MatchDecision {
  const t = Date.parse(input.kickoff_at)
  const scored = fixtures
    .filter((f) => !input.competitionId || f.competition?.external_id === input.competitionId)
    .filter((f) => Math.abs(Date.parse(f.kickoff_at) - t) <= MAX_HOURS * 3600e3)
    .map((f) => ({ f, s: Math.min(teamSimilarity(input.home, f.home.name), teamSimilarity(input.away, f.away.name)) }))
    .sort((a, b) => b.s - a.s)
  const strong = scored.filter((x) => x.s >= 0.5)
  if (strong.length === 1) return { kind: 'linked', fixture: strong[0]!.f, score: strong[0]!.s }
  if (strong.length > 1) {
    // Si uno es claramente mejor (coincidencia exacta frente a parcial), se toma ese.
    if (strong[0]!.s === 1 && strong[1]!.s < 1) return { kind: 'linked', fixture: strong[0]!.f, score: 1 }
    return { kind: 'ambiguous', candidates: strong.slice(0, 5).map((x) => x.f) }
  }
  // Sugerencias: un equipo coincide (p. ej. local y visitante invertidos o nombre muy distinto).
  const partial = fixtures
    .map((f) => ({ f, s: Math.max(teamSimilarity(input.home, f.home.name), teamSimilarity(input.away, f.away.name), teamSimilarity(input.home, f.away.name)) }))
    .filter((x) => x.s >= 0.5 && Math.abs(Date.parse(x.f.kickoff_at) - t) <= MAX_HOURS * 3600e3)
    .sort((a, b) => b.s - a.s)
  return { kind: 'not_found', suggestions: partial.slice(0, 5).map((x) => x.f) }
}

/** Días UTC que cubren ±6 h alrededor del inicio (1 o 2 consultas). */
export function utcDaysAround(kickoffIso: string): string[] {
  const t = Date.parse(kickoffIso)
  return [...new Set([t - MAX_HOURS * 3600e3, t, t + MAX_HOURS * 3600e3].map((x) => new Date(x).toISOString().slice(0, 10)))]
}
