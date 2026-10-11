// Calendario adelantado: trae de TheSportsDB la jornada de las semanas
// planificadas (con ids oficiales de API-Football) y la guarda con
// calendar_import. No usa la cuota de API-Football. Como mucho cada 6 h desde
// el cron (o cada 10 min si el admin lo pide); si la búsqueda queda a medias,
// se reanuda en 15 min.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { collectCalendar, type CalendarWeek } from './football/calendar.ts'

const P = 'thesportsdb'
const BASE = 'https://www.thesportsdb.com/api/v1/json'
const MAX_REQUESTS = 24
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function refreshCalendar(db: SupabaseClient, opts: { force?: boolean } = {}) {
  const get = async <T>(key: string) => ((await db.rpc('provider_cache_get', { p_provider: P, p_key: key })).data ?? null) as T | null
  const put = (key: string, payload: unknown, ttl: number) => db.rpc('provider_cache_put', { p_provider: P, p_key: key, p_payload: payload, p_ttl_seconds: ttl })

  if (await get(opts.force ? 'calendar:force' : 'calendar:gate')) return { skipped: true }
  await put(opts.force ? 'calendar:force' : 'calendar:gate', { at: new Date().toISOString() }, opts.force ? 600 : 6 * 3600)

  const { data: weeks, error } = await db.rpc('calendar_weeks')
  if (error) throw new Error(`calendar_weeks: ${error.message}`)
  if (!(weeks as CalendarWeek[]).length) {
    const summary = { weeks: 0, found: 0, at: new Date().toISOString() }
    await put('calendar:last', summary, 30 * 86400)
    return summary
  }

  // La clave pública de prueba («3») no es secreta; si se configura una propia, nunca se registra.
  const key = Deno.env.get('THESPORTSDB_KEY') || '3'
  let requests = 0
  let limited = false
  const fetchJson = async (path: string) => {
    if (requests >= MAX_REQUESTS || limited) return null
    if (requests) await sleep(350)
    requests++
    const res = await fetch(`${BASE}/${key}/${path}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
    if (res.status === 429) { limited = true; return null }
    if (!res.ok) throw new Error(`TheSportsDB HTTP ${res.status}`)
    const text = await res.text()
    try { return JSON.parse(text) } catch { return {} }
  }
  const teamApiId = async (tsdb: string) => {
    if (!/^\d{1,10}$/.test(tsdb)) return null
    const cached = await get<{ af: string | null }>(`team:${tsdb}`)
    if (cached) return cached.af
    const r = await fetchJson(`lookupteam.php?id=${tsdb}`)
    if (!r) return null
    const af = (r.teams?.[0]?.idAPIfootball ?? null) as string | null
    const ok = af && /^\d{1,10}$/.test(af) ? af : null
    await put(`team:${tsdb}`, { af: ok }, ok ? 30 * 86400 : 86400)
    return ok
  }

  const r = await collectCalendar(weeks as CalendarWeek[], { getJson: fetchJson, teamApiId })
  let imported: Record<string, unknown> = {}
  if (r.fixtures.length) {
    const res = await db.rpc('calendar_import', { p_fixtures: r.fixtures })
    if (res.error) throw new Error(`calendar_import: ${res.error.message}`)
    imported = res.data as Record<string, unknown>
  }
  const incomplete = r.stopped || limited || r.missingTeams > 0
  const summary = {
    at: new Date().toISOString(), weeks: (weeks as CalendarWeek[]).length, found: r.fixtures.length, by_league: r.byLeague,
    new_matches: imported.new_matches ?? 0, week_selected: imported.week_selected ?? 0, requests,
    missing_teams: r.missingTeams, incomplete,
  }
  await put('calendar:last', summary, 30 * 86400)
  // A medias (tope de solicitudes o equipos por identificar): se reanuda pronto.
  if (incomplete && !opts.force) await put('calendar:gate', { at: summary.at, resume: true }, 15 * 60)
  return summary
}
