// Resultados de respaldo desde TheSportsDB (gratis, sin cuota de API-Football).
// Si API-Football falla (cuenta suspendida, cuota agotada), los marcadores en
// vivo y finales llegan por aquí. Cada partido se identifica por su id oficial
// de API-Football (idAPIfootball), nunca por nombre.
import { TSDB_LEAGUES } from './calendar.ts'

/** Partido publicado que espera estado o resultado. */
export interface FreeTarget {
  match_id: string; external_id: string; kickoff_at: string; league: string | null
  status: string; home_goals: number | null; away_goals: number | null
  home_name?: string | null; away_name?: string | null; home_tsdb?: string | null; away_tsdb?: string | null
}
export interface TsdbLiveEvent {
  idEvent?: string | null; idAPIfootball?: string | null; strStatus?: string | null; strProgress?: string | null
  intHomeScore?: string | null; intAwayScore?: string | null; strPostponed?: string | null
}
export interface FreeUpdate { status: string; status_detail: string; home_goals: number | null; away_goals: number | null }

const FINISHED = new Set(['FT', 'AET', 'PEN', 'AOT', 'MATCH FINISHED', 'FINISHED'])
const LIVE = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT'])
const score = (v: string | null | undefined) => (v != null && /^\d{1,2}$/.test(String(v).trim()) ? Number(v) : null)

/** Estado de TheSportsDB → actualización para apply_provider_update (null = nada que aplicar). */
export function toFreeUpdate(e: TsdbLiveEvent): FreeUpdate | null {
  const st = String(e.strStatus ?? '').trim().toUpperCase()
  const h = score(e.intHomeScore)
  const a = score(e.intAwayScore)
  if (FINISHED.has(st)) return h === null || a === null ? null : { status: 'finished', status_detail: st === 'MATCH FINISHED' || st === 'FINISHED' ? 'FT' : st, home_goals: h, away_goals: a }
  if (LIVE.has(st)) return { status: 'live', status_detail: st, home_goals: h ?? 0, away_goals: a ?? 0 }
  if (st === 'PST' || e.strPostponed === 'yes') return { status: 'postponed', status_detail: 'PST', home_goals: null, away_goals: null }
  if (st === 'CANC') return { status: 'cancelled', status_detail: 'CANC', home_goals: null, away_goals: null }
  if (st === 'ABD') return h === null || a === null ? null : { status: 'abandoned', status_detail: 'ABD', home_goals: h, away_goals: a }
  return null // NS u otro: sin cambios
}

/** Nunca retrocede: un partido final no vuelve a «en vivo» por un dato atrasado. */
export function shouldApply(t: FreeTarget, u: FreeUpdate): boolean {
  if (t.status === 'finished' && u.status !== 'finished') return false
  if (t.status === u.status && t.home_goals === u.home_goals && t.away_goals === u.away_goals) return false
  return true
}

/** Consultas necesarias: una por (día UTC, liga de TheSportsDB). */
export function freeRequests(targets: FreeTarget[]): { date: string; tsdb: string }[] {
  const seen = new Map<string, { date: string; tsdb: string }>()
  for (const t of targets) {
    const tsdb = t.league ? TSDB_LEAGUES[t.league]?.tsdb : undefined
    if (!tsdb) continue
    const date = new Date(t.kickoff_at).toISOString().slice(0, 10)
    seen.set(`${date}:${tsdb}`, { date, tsdb })
  }
  return [...seen.values()]
}

/** Texto de búsqueda de TheSportsDB: «Real_Betis_vs_Barcelona». */
export function searchQuery(home: string, away: string): string {
  const clean = (x: string) => x.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9 ]+/g, ' ').trim().replace(/\s+/g, '_')
  return `${clean(home)}_vs_${clean(away)}`
}

/** De una lista de eventos, el que corresponde al partido (por id oficial, nunca por nombre). */
export function pickEvent(events: TsdbLiveEvent[] | null | undefined, externalId: string): TsdbLiveEvent | null {
  return (events ?? []).find((e) => String(e.idAPIfootball ?? '') === externalId && /^\d{1,10}$/.test(String(e.idEvent ?? ''))) ?? null
}
