// Selección de partidos destacados para Inicio a partir de los partidos del
// día que entrega el proveedor. Solo equipos y competiciones de interés;
// nunca se inventan partidos ni datos.
import type { NormalizedFixture } from './types.ts'

/** Ids de API-Football verificados con la cuenta real (10-oct-2026). */
export const FEATURED_TEAMS: Record<string, { name: string; priority: number }> = {
  '529': { name: 'Barcelona', priority: 100 },
  '541': { name: 'Real Madrid', priority: 100 },
  '15941': { name: 'Durango (México)', priority: 95 },
}

export const FEATURED_LEAGUES: Record<string, { name: string; priority: number }> = {
  '262': { name: 'Liga MX', priority: 80 },
  '16': { name: 'Concacaf Champions Cup', priority: 70 },
  '2': { name: 'UEFA Champions League', priority: 70 },
  '140': { name: 'LaLiga', priority: 60 },
  '39': { name: 'Premier League', priority: 60 },
  '13': { name: 'Copa Libertadores', priority: 50 },
  '135': { name: 'Serie A', priority: 50 },
  '78': { name: 'Bundesliga', priority: 50 },
  '61': { name: 'Ligue 1', priority: 45 },
  '263': { name: 'Liga de Expansión MX', priority: 40 },
}

export interface FeaturedItem {
  external_id: string
  kickoff_at: string
  status: string
  priority: number
  reason: string
  data: Record<string, unknown>
}

export function selectFeatured(fixtures: NormalizedFixture[], max = 14): FeaturedItem[] {
  const seen = new Set<string>()
  const out: FeaturedItem[] = []
  for (const f of fixtures) {
    if (seen.has(f.external_id) || f.status === 'cancelled') continue
    const team = FEATURED_TEAMS[f.home.external_id] ?? FEATURED_TEAMS[f.away.external_id]
    const league = f.competition ? FEATURED_LEAGUES[f.competition.external_id] : undefined
    if (!team && !league) continue
    seen.add(f.external_id)
    out.push({
      external_id: f.external_id,
      kickoff_at: f.kickoff_at,
      status: f.status,
      priority: Math.max(team?.priority ?? 0, league?.priority ?? 0),
      reason: team ? team.name : league!.name,
      data: {
        status_detail: f.status_detail, elapsed: f.elapsed, home_goals: f.home_goals, away_goals: f.away_goals,
        competition: f.competition ? { name: f.competition.name, country: f.competition.country ?? null, logo_url: f.competition.logo_url ?? null } : null,
        home: { name: f.home.name, short_name: f.home.short_name, logo_url: f.home.logo_url ?? null },
        away: { name: f.away.name, short_name: f.away.short_name, logo_url: f.away.logo_url ?? null },
      },
    })
  }
  return out.sort((a, b) => b.priority - a.priority || Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at)).slice(0, max)
}

/** ¿Toca refrescar? Cada 3 h; cada 20 min mientras haya destacados en juego. */
export function featuredDue(last: { refreshed_at: string | null; live: number } | null, now = Date.now()) {
  if (!last?.refreshed_at) return true
  const age = now - Date.parse(last.refreshed_at)
  return age >= 3 * 3600e3 || (last.live > 0 && age >= 20 * 60e3)
}
