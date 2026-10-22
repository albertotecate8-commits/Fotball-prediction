// Respaldo de resultados con TheSportsDB (gratis): marcador en vivo y final de
// los partidos publicados, por su id oficial de API-Football. Corre en cada
// pasada del cron (cada 3 min) solo si hay partidos en juego o por cerrar.
//
// Las listas de TheSportsDB (día, jornada) llegan con retraso: pueden seguir en
// «2H 3-0» cuando el partido ya terminó 4-1. La ficha de cada partido
// (lookupevent) es la fresca. Por eso:
// 1) Partido con id de TheSportsDB conocido → su ficha, siempre.
// 2) Sin id: se descubre en la lista del día y, si falta, en la jornada completa
//    (la del día trae como máximo 3); se guarda el id y se lee su ficha.
// 3) Si aún falta, se busca una sola vez por nombre o por equipo.
// Solo si no se pudo leer la ficha se usa el dato de la lista (nunca retrocede).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { ESPN_LEAGUES, espnRequests, matchEspn, toEspnUpdate, type EspnEvent } from './football/espn.ts'
import { freeRequests, pickEvent, roundsByLeague, searchQuery, shouldApply, toFreeUpdate, type FreeTarget, type TsdbLiveEvent } from './football/freeResults.ts'

const P = 'thesportsdb'
const BASE = 'https://www.thesportsdb.com/api/v1/json'
const MAX_REQUESTS = 18
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function refreshFreeResults(db: SupabaseClient) {
  const { data, error } = await db.rpc('free_result_targets_v2')
  if (error) throw new Error(`free_result_targets_v2: ${error.message}`)
  const all = (data ?? []) as FreeTarget[]
  if (!all.length) return { targets: 0 }
  const espn = await refreshFromEspn(db, all)
  // TheSportsDB solo para lo que ESPN no reconoció.
  const targets = all.filter((t) => !espn.matched.has(t.match_id))
  if (!targets.length) return { targets: all.length, espn: espn.summary }
  // Clave pública de prueba de TheSportsDB («123»); si se configura una propia, nunca se registra.
  const key = Deno.env.get('THESPORTSDB_KEY') || '123'
  const byId = new Map(targets.map((t) => [t.external_id, t]))
  const fresh = new Set<string>() // leído de su ficha en esta pasada
  const ids = new Map<string, string>() // id de API-Football → id de TheSportsDB
  const listData = new Map<string, TsdbLiveEvent>() // respaldo si no se pudo leer la ficha
  let requests = 0
  let applied = 0
  const errors: string[] = []

  const getJson = async (path: string): Promise<Record<string, unknown> | null> => {
    if (requests >= MAX_REQUESTS) return null
    if (requests) await sleep(250) // sin ráfagas: la clave gratuita responde 429
    requests++
    const res = await fetch(`${BASE}/${key}/${path}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
    if (!res.ok) { errors.push(`HTTP ${res.status}`); return null }
    return await res.json().catch(() => null) as Record<string, unknown> | null
  }
  const cacheGet = async (k: string) => ((await db.rpc('provider_cache_get', { p_provider: P, p_key: k })).data ?? null) as { id: string } | null
  const cachePut = (k: string, id: string) => db.rpc('provider_cache_put', { p_provider: P, p_key: k, p_payload: { id }, p_ttl_seconds: 14 * 86400 })
  const apply = async (t: FreeTarget, e: TsdbLiveEvent) => {
    const u = toFreeUpdate(e)
    if (!u || !shouldApply(t, u)) return
    const r = await db.rpc('apply_provider_update', { p_match_id: t.match_id, p_update: u })
    if (r.error) errors.push(r.error.message)
    else applied++
  }
  const learn = async (events: TsdbLiveEvent[]) => {
    for (const e of events) {
      const t = e.idAPIfootball ? byId.get(String(e.idAPIfootball)) : undefined
      if (!t || !/^\d{1,10}$/.test(String(e.idEvent ?? ''))) continue
      if (!ids.has(t.external_id)) { ids.set(t.external_id, String(e.idEvent)); await cachePut(`event:${t.external_id}`, String(e.idEvent)) }
      listData.set(t.external_id, e)
    }
  }
  const readFresh = async (t: FreeTarget) => {
    const id = ids.get(t.external_id)
    if (!id || fresh.has(t.external_id)) return
    const body = await getJson(`lookupevent.php?id=${id}`)
    const e = pickEvent((body?.events ?? body?.event) as TsdbLiveEvent[], t.external_id)
    if (!e) return
    fresh.add(t.external_id)
    await apply(t, e)
  }

  // 1) Ids ya conocidos → ficha fresca.
  for (const t of targets) {
    const c = await cacheGet(`event:${t.external_id}`)
    if (c?.id && /^\d{1,10}$/.test(c.id)) ids.set(t.external_id, c.id)
  }
  for (const t of targets) { try { await readFresh(t) } catch (e) { errors.push((e as Error).message) } }

  // 2) Descubrir ids en el día y, si faltan, en la jornada completa.
  const unknown = () => targets.filter((t) => !ids.has(t.external_id))
  if (unknown().length) {
    const rounds = new Map<string, { tsdb: string; round: string; season: string }>()
    for (const q of freeRequests(unknown()).slice(0, 4)) {
      try {
        const events = ((await getJson(`eventsday.php?d=${q.date}&l=${q.tsdb}`))?.events ?? []) as TsdbLiveEvent[]
        await learn(events)
        for (const [k, v] of roundsByLeague(events, q.tsdb)) rounds.set(k, { tsdb: k.split(':')[0]!, ...v })
      } catch (e) { errors.push((e as Error).message) }
    }
    if (unknown().length) {
      for (const r of [...rounds.values()].slice(0, 3)) {
        try {
          await learn(((await getJson(`eventsround.php?id=${r.tsdb}&r=${encodeURIComponent(r.round)}&s=${encodeURIComponent(r.season)}`))?.events ?? []) as TsdbLiveEvent[])
        } catch (e) { errors.push((e as Error).message) }
      }
    }
  }

  // 3) Aún sin id: buscar una sola vez por nombre o por equipo.
  for (const t of unknown()) {
    if (requests >= MAX_REQUESTS) break
    try {
      if (t.home_name && t.away_name) {
        const found = await getJson(`searchevents.php?e=${encodeURIComponent(searchQuery(t.home_name, t.away_name))}`)
        await learn(((found?.event ?? found?.events) ?? []) as TsdbLiveEvent[])
      }
      for (const team of [t.home_tsdb, t.away_tsdb]) {
        for (const path of [`eventsnext.php?id=${team}`, `eventslast.php?id=${team}`]) {
          if (ids.has(t.external_id) || !team || !/^\d{1,10}$/.test(team)) break
          const found = await getJson(path)
          await learn(((found?.events ?? found?.results) ?? []) as TsdbLiveEvent[])
        }
      }
    } catch (e) { errors.push((e as Error).message) }
  }

  // Ficha fresca de los recién descubiertos; si no se pudo, el dato de la lista.
  for (const t of targets) {
    try {
      await readFresh(t)
      if (!fresh.has(t.external_id) && listData.has(t.external_id)) await apply(t, listData.get(t.external_id)!)
    } catch (e) { errors.push((e as Error).message) }
  }
  return {
    targets: all.length, espn: espn.summary, tsdb_targets: targets.length, requests, applied, fresh: fresh.size,
    missing: targets.filter((t) => !fresh.has(t.external_id) && !listData.has(t.external_id)).length,
    errors: errors.slice(0, 3),
  }
}

/** ESPN: una consulta por liga y día; aplica lo que reconoce con certeza. */
async function refreshFromEspn(db: SupabaseClient, targets: FreeTarget[]) {
  const matched = new Set<string>()
  const errors: string[] = []
  let applied = 0
  const reqs = espnRequests(targets).slice(0, 8)
  const events = new Map<string, EspnEvent[]>()
  for (const r of reqs) {
    try {
      const res = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${r.slug}/scoreboard?dates=${r.date}`,
        { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
      if (!res.ok) { errors.push(`ESPN HTTP ${res.status}`); continue }
      const body = await res.json().catch(() => null) as { events?: EspnEvent[] } | null
      events.set(r.slug, [...(events.get(r.slug) ?? []), ...(body?.events ?? [])])
    } catch (e) { errors.push((e as Error).message) }
  }
  for (const t of targets) {
    const slug = t.league ? ESPN_LEAGUES[t.league] : undefined
    const e = slug ? matchEspn(t, events.get(slug) ?? []) : null
    if (!e) continue
    matched.add(t.match_id)
    const u = toEspnUpdate(e)
    if (!u || !shouldApply(t, u)) continue
    const r = await db.rpc('apply_provider_update', { p_match_id: t.match_id, p_update: u })
    if (r.error) errors.push(r.error.message)
    else applied++
  }
  return { matched, summary: { requests: reqs.length, matched: matched.size, applied, errors: errors.slice(0, 3) } }
}
