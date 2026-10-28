// Calendario adelantado desde TheSportsDB (sin cuota de API-Football).
// TheSportsDB publica cada partido con su id OFICIAL de API-Football y cada
// equipo con el suyo, así que lo que se guarda es el mismo partido que después
// actualiza la sincronización normal. Solo se usan partidos con ambos ids.

/** Ligas de API-Football → liga en TheSportsDB. */
export const TSDB_LEAGUES: Record<string, { tsdb: string; name: string }> = {
  '262': { tsdb: '4350', name: 'Liga MX' },
  '140': { tsdb: '4335', name: 'La Liga' },
  '263': { tsdb: '4654', name: 'Liga de Expansión MX' },
  '2': { tsdb: '4480', name: 'UEFA Champions League' },
}
const API_LEAGUE_OF_TSDB: Record<string, string> = Object.fromEntries(Object.entries(TSDB_LEAGUES).map(([af, v]) => [v.tsdb, af]))

/** Equipo seguido: id de API-Football y, si se conoce, su id y liga en TheSportsDB. */
export interface CalendarTeam { af: string; tsdb?: string | null; tsdb_league?: string | null }
export interface CalendarWeek { id: string; week_start: string; league_ids: string[]; team_ids: string[]; weekend_only: boolean; teams?: CalendarTeam[] }
export interface TsdbEvent {
  idAPIfootball?: string | null; strTimestamp?: string | null; idHomeTeam?: string | null; idAwayTeam?: string | null
  strHomeTeam?: string | null; strAwayTeam?: string | null; strStatus?: string | null; strPostponed?: string | null
  intRound?: string | null; strSeason?: string | null; idLeague?: string | null
}
export interface CalendarFixture {
  external_id: string; kickoff_at: string
  competition: { external_id: string; name: string }
  home: { external_id: string; name: string }; away: { external_id: string; name: string }
}
export interface CalendarDeps {
  /** GET a TheSportsDB (ruta relativa). Devuelve null si ya no hay presupuesto de solicitudes. */
  getJson: (path: string) => Promise<{ events?: TsdbEvent[] | null } | null>
  /** Id de API-Football de un equipo de TheSportsDB (con caché). */
  teamApiId: (tsdbTeamId: string) => Promise<string | null>
}

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const ID = /^\d{1,10}$/
const NOT_STARTED = new Set(['', 'NS', 'Not Started', 'TBD'])

/** Días UTC a consultar: viernes a lunes (el domingo en la noche de CDMX ya es lunes en UTC) o toda la semana. */
export function utcDaysForWeek(w: Pick<CalendarWeek, 'week_start' | 'weekend_only'>): string[] {
  const from = w.weekend_only ? 4 : 0
  return Array.from({ length: 8 - from }, (_, i) => addDays(w.week_start, from + i))
}

export function toKickoff(ts: string | null | undefined): string | null {
  if (!ts) return null
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(ts) ? ts : `${ts}Z`
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export async function collectCalendar(weeks: CalendarWeek[], deps: CalendarDeps) {
  const out = new Map<string, CalendarFixture>()
  let missingTeams = 0
  let stopped = false
  const byLeague: Record<string, number> = {}
  for (const w of weeks) {
    const lo = Date.parse(`${addDays(w.week_start, w.weekend_only ? 4 : 0)}T00:00:00-06:00`) - 6 * 3600e3
    const hi = Date.parse(`${addDays(w.week_start, 7)}T00:00:00-06:00`) + 6 * 3600e3
    /** Agrega el partido si es de la semana, no ha empezado y tiene ids oficiales. */
    const consider = async (e: TsdbEvent, lg: string, teamOnly: boolean) => {
      const meta = TSDB_LEAGUES[lg]
      const id = e.idAPIfootball ?? ''
      const ko = toKickoff(e.strTimestamp)
      if (!meta || !ID.test(id) || !ko || out.has(id) || !e.idHomeTeam || !e.idAwayTeam || !e.strHomeTeam || !e.strAwayTeam) return
      if (!NOT_STARTED.has(e.strStatus ?? '') || (e.strPostponed ?? '').toLowerCase() === 'yes') return
      const t = Date.parse(ko)
      if (t < lo || t > hi) return
      const [h, a] = [await deps.teamApiId(e.idHomeTeam), await deps.teamApiId(e.idAwayTeam)]
      if (!h || !a) { missingTeams++; return }
      if (teamOnly && !w.team_ids.includes(h) && !w.team_ids.includes(a)) return
      out.set(id, {
        external_id: id, kickoff_at: ko, competition: { external_id: lg, name: meta.name },
        home: { external_id: h, name: e.strHomeTeam }, away: { external_id: a, name: e.strAwayTeam },
      })
      byLeague[meta.name] = (byLeague[meta.name] ?? 0) + 1
    }

    // 1) Equipos seguidos (Barcelona, Real Madrid, Durango…): su próximo partido
    //    directo, una consulta por equipo y ANTES que las ligas, para que nunca
    //    se queden fuera por el tope de solicitudes.
    const viaTeam = new Set<string>()
    for (const t of w.teams ?? []) {
      if (!t.tsdb || !ID.test(t.tsdb)) continue
      const r = await deps.getJson(`eventsnext.php?id=${t.tsdb}`)
      if (!r) { stopped = true; break }
      viaTeam.add(t.af)
      const home = t.tsdb_league ? API_LEAGUE_OF_TSDB[t.tsdb_league] : undefined
      for (const e of r.events ?? []) {
        const lg = (e.idLeague && API_LEAGUE_OF_TSDB[e.idLeague]) || home
        if (lg) await consider(e, lg, !w.league_ids.includes(lg))
      }
    }
    if (stopped) break

    // 2) Ligas completas (Liga MX) y, si a un equipo no se le pudo buscar directo, su liga.
    const teamLeagues = (w.teams ?? []).filter((t) => !viaTeam.has(t.af))
      .map((t) => (t.tsdb_league ? API_LEAGUE_OF_TSDB[t.tsdb_league] : undefined)).filter((x): x is string => !!x)
    const leagues = new Set([...w.league_ids, ...teamLeagues].filter((l) => TSDB_LEAGUES[l]))
    for (const lg of leagues) {
      const meta = TSDB_LEAGUES[lg]!
      const teamOnly = !w.league_ids.includes(lg)
      const events: TsdbEvent[] = []
      for (const d of utcDaysForWeek(w)) {
        const r = await deps.getJson(`eventsday.php?d=${d}&l=${meta.tsdb}`)
        if (!r) { stopped = true; break }
        events.push(...(r.events ?? []))
      }
      // La consulta por día tiene tope en la clave gratuita: la jornada completa la cubre.
      if (!stopped) {
        const rounds = new Map<string, string>()
        for (const e of events) if (e.intRound && e.strSeason) rounds.set(e.intRound, e.strSeason)
        for (const [round, season] of rounds) {
          const r = await deps.getJson(`eventsround.php?id=${meta.tsdb}&r=${encodeURIComponent(round)}&s=${encodeURIComponent(season)}`)
          if (!r) { stopped = true; break }
          events.push(...(r.events ?? []))
        }
      }
      for (const e of events) await consider(e, lg, teamOnly)
      if (stopped) break
    }
    if (stopped) break
  }
  return { fixtures: [...out.values()], missingTeams, stopped, byLeague }
}
