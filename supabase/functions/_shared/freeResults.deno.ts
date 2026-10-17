// Respaldo de resultados con TheSportsDB (gratis): marcador en vivo y final de
// los partidos publicados, por su id oficial de API-Football. Corre en cada
// pasada del cron (cada 3 min) solo si hay partidos en juego o por cerrar.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { freeRequests, shouldApply, toFreeUpdate, type FreeTarget, type TsdbLiveEvent } from './football/freeResults.ts'

const BASE = 'https://www.thesportsdb.com/api/v1/json'

export async function refreshFreeResults(db: SupabaseClient) {
  const { data, error } = await db.rpc('free_result_targets')
  if (error) throw new Error(`free_result_targets: ${error.message}`)
  const targets = (data ?? []) as FreeTarget[]
  if (!targets.length) return { targets: 0 }
  // Clave pública de prueba de TheSportsDB («123»); si se configura una propia, nunca se registra.
  const key = Deno.env.get('THESPORTSDB_KEY') || '123'
  const byId = new Map(targets.map((t) => [t.external_id, t]))
  let requests = 0
  let applied = 0
  const errors: string[] = []
  for (const q of freeRequests(targets).slice(0, 6)) {
    requests++
    try {
      const res = await fetch(`${BASE}/${key}/eventsday.php?d=${q.date}&l=${q.tsdb}`, { signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' } })
      if (!res.ok) { errors.push(`HTTP ${res.status}`); continue }
      const body = await res.json().catch(() => ({})) as { events?: TsdbLiveEvent[] | null }
      for (const e of body.events ?? []) {
        const t = e.idAPIfootball ? byId.get(String(e.idAPIfootball)) : undefined
        const u = t ? toFreeUpdate(e) : null
        if (!t || !u || !shouldApply(t, u)) continue
        const r = await db.rpc('apply_provider_update', { p_match_id: t.match_id, p_update: u })
        if (r.error) errors.push(r.error.message)
        else applied++
      }
    } catch (e) {
      errors.push((e as Error).message)
    }
  }
  return { targets: targets.length, requests, applied, errors: errors.slice(0, 3) }
}
