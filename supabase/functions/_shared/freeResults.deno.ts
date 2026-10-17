// Respaldo de resultados con TheSportsDB (gratis): marcador en vivo y final de
// los partidos publicados, por su id oficial de API-Football. Corre en cada
// pasada del cron (cada 3 min) solo si hay partidos en juego o por cerrar.
// 1) Una consulta por día y liga (la clave gratuita trae como máximo 3).
// 2) Los que no salieron ahí se consultan directo por su id de TheSportsDB;
//    ese id se encuentra una sola vez (por nombre o por el equipo) y se guarda.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { freeRequests, pickEvent, searchQuery, shouldApply, toFreeUpdate, type FreeTarget, type TsdbLiveEvent } from './football/freeResults.ts'

const P = 'thesportsdb'
const BASE = 'https://www.thesportsdb.com/api/v1/json'
const MAX_REQUESTS = 12

export async function refreshFreeResults(db: SupabaseClient) {
  const { data, error } = await db.rpc('free_result_targets_v2')
  if (error) throw new Error(`free_result_targets_v2: ${error.message}`)
  const targets = (data ?? []) as FreeTarget[]
  if (!targets.length) return { targets: 0 }
  // Clave pública de prueba de TheSportsDB («123»); si se configura una propia, nunca se registra.
  const key = Deno.env.get('THESPORTSDB_KEY') || '123'
  const byId = new Map(targets.map((t) => [t.external_id, t]))
  const seen = new Set<string>()
  let requests = 0
  let applied = 0
  const errors: string[] = []

  const getJson = async (path: string): Promise<Record<string, unknown> | null> => {
    if (requests >= MAX_REQUESTS) return null
    requests++
    const res = await fetch(`${BASE}/${key}/${path}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
    if (!res.ok) { errors.push(`HTTP ${res.status}`); return null }
    return await res.json().catch(() => null) as Record<string, unknown> | null
  }
  const cacheGet = async (k: string) => ((await db.rpc('provider_cache_get', { p_provider: P, p_key: k })).data ?? null) as { id: string } | null
  const cachePut = (k: string, id: string) => db.rpc('provider_cache_put', { p_provider: P, p_key: k, p_payload: { id }, p_ttl_seconds: 14 * 86400 })
  const apply = async (t: FreeTarget, e: TsdbLiveEvent) => {
    seen.add(t.external_id)
    if (e.idEvent && /^\d{1,10}$/.test(String(e.idEvent))) await cachePut(`event:${t.external_id}`, String(e.idEvent))
    const u = toFreeUpdate(e)
    if (!u || !shouldApply(t, u)) return
    const r = await db.rpc('apply_provider_update', { p_match_id: t.match_id, p_update: u })
    if (r.error) errors.push(r.error.message)
    else applied++
  }

  // 1) Día y liga.
  for (const q of freeRequests(targets).slice(0, 4)) {
    try {
      const body = await getJson(`eventsday.php?d=${q.date}&l=${q.tsdb}`)
      for (const e of ((body?.events ?? []) as TsdbLiveEvent[])) {
        const t = e.idAPIfootball ? byId.get(String(e.idAPIfootball)) : undefined
        if (t) await apply(t, e)
      }
    } catch (e) { errors.push((e as Error).message) }
  }

  // 2) Los que faltaron: directo por id (buscándolo una sola vez si no se conoce).
  for (const t of targets) {
    if (seen.has(t.external_id) || requests >= MAX_REQUESTS) continue
    try {
      let tsdbId = (await cacheGet(`event:${t.external_id}`))?.id ?? null
      if (!tsdbId && t.home_name && t.away_name) {
        const found = await getJson(`searchevents.php?e=${encodeURIComponent(searchQuery(t.home_name, t.away_name))}`)
        tsdbId = pickEvent((found?.event ?? found?.events) as TsdbLiveEvent[], t.external_id)?.idEvent ?? null
      }
      for (const team of [t.home_tsdb, t.away_tsdb]) {
        if (tsdbId || !team || !/^\d{1,10}$/.test(team)) continue
        for (const path of [`eventsnext.php?id=${team}`, `eventslast.php?id=${team}`]) {
          if (tsdbId) break
          const found = await getJson(path)
          tsdbId = pickEvent((found?.events ?? found?.results) as TsdbLiveEvent[], t.external_id)?.idEvent ?? null
        }
      }
      if (!tsdbId) continue
      const body = await getJson(`lookupevent.php?id=${tsdbId}`)
      const e = pickEvent((body?.events ?? body?.event) as TsdbLiveEvent[], t.external_id)
      if (e) await apply(t, e)
    } catch (e) { errors.push((e as Error).message) }
  }
  return { targets: targets.length, requests, applied, missing: targets.filter((t) => !seen.has(t.external_id)).length, errors: errors.slice(0, 3) }
}
