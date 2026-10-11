// Ejecuta el plan de consultas de una pasada del cron para API-Football.
// Cada solicitud real pasa por la puerta de cuota (provider_reserve); las
// respuestas se guardan en la caché compartida y se aplican a TODOS los
// partidos guardados de ese día. Si el proveedor falla o la cuota se agota,
// los últimos datos válidos (resultados, pronósticos, puntos) quedan intactos.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  afterLive, diffUpdates, planTick, ProviderError, utcDate,
  type ApiFootballProvider, type NormalizedFixture, type PlanAction, type TrackedMatch,
} from './football/index.ts'
import { autoImportPool, autoLinkManual, dayFixtures, refreshFeatured } from './manualLink.deno.ts'
import { quotaState } from './providers.deno.ts'

const STOP = new Set(['BUDGET_BLOCKED', 'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'INVALID_KEY'])

export async function runPlannedSync(db: SupabaseClient, provider: ApiFootballProvider, trigger: 'cron' | 'manual') {
  const rpc = async <T>(fn: string, args: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, args)
    if (error) throw new Error(`${fn}: ${error.message}`)
    return data as T
  }
  const now = Date.now()
  const state = await quotaState(db, provider.id)
  let tracked = await rpc<TrackedMatch[]>('get_tracked_matches', { p_provider: provider.id })
  const days = [-1, 0, 1].map((o) => utcDate(now + o * 86400e3))
  const ages = await rpc<{ cache_key: string; fetched_at: string }[]>('provider_cache_ages', { p_provider: provider.id, p_keys: [...days.map((d) => `day:${d}`), 'live'] })
  const at = (k: string) => { const r = ages.find((a) => a.cache_key === k); return r ? Date.parse(r.fetched_at) : null }
  const dayFetchedAt: Record<string, number | null> = Object.fromEntries(days.map((d) => [d, at(`day:${d}`)]))
  const w = (provider as unknown as { dateWindow?: [number, number] | null }).dateWindow

  const plan = planTick({
    now, effective: state.effective_remaining, paused: state.paused, tracked,
    // Inicio solo muestra partidos de la quiniela: los destacados de otras ligas ya no gastan consultas en vivo.
    featuredLive: 0, lastLiveAt: at('live'), dayFetchedAt,
    liveRestricted: provider.liveRestricted, dateWindow: w ?? [-1, 1],
  })
  const summary = {
    quota: { used: state.used, effective_remaining: state.effective_remaining, paused: state.paused, pause_reason: state.pause_reason },
    tracked: tracked.length, live_interval_min: plan.liveIntervalMin, live_minutes_left: plan.liveMinutesLeft,
    planned: plan.actions.map((a) => (a.kind === 'live' ? `live/p${a.priority}` : `day:${a.date}/p${a.priority}`)),
  }
  if (!plan.actions.length) return { skipped: true, ...summary }

  const runId = await rpc<number>('start_sync_run', { p_provider: provider.id, p_trigger: trigger })
  const errors: string[] = []
  const anomalies: string[] = []
  const done: string[] = []
  let checked = 0
  let updated = 0
  let stopped: string | null = null
  const fetchedDays = new Set<string>()

  const apply = async (fixtures: NormalizedFixture[]) => {
    const d = diffUpdates(tracked, fixtures)
    anomalies.push(...d.anomalies)
    checked += fixtures.filter((f) => tracked.some((t) => t.external_id === f.external_id)).length
    for (const u of d.updates) {
      try {
        const r = await rpc<{ changed: boolean }>('apply_provider_update', { p_match_id: u.match_id, p_update: u.fixture })
        if (r?.changed) updated++
      } catch (e) {
        errors.push(`${u.fixture.external_id}: ${(e as Error).message}`)
        await db.rpc('record_match_sync_error', { p_match_id: u.match_id, p_error: (e as Error).message })
      }
    }
  }

  const queue: PlanAction[] = [...plan.actions]
  for (let step = 0; step < 6 && queue.length && !stopped; step++) {
    const a = queue.shift()!
    try {
      if (a.kind === 'live') {
        provider.context = { priority: a.priority, purpose: 'en vivo' }
        const live = await provider.fixturesLive()
        await rpc('provider_cache_put', { p_provider: provider.id, p_key: 'live', p_payload: live.map((f) => f.external_id), p_ttl_seconds: 3600 })
        // Los datos en vivo también refrescan los días en caché (Inicio y vinculación).
        const byDay = new Map<string, NormalizedFixture[]>()
        for (const f of live.map(({ raw: _raw, ...rest }) => rest as NormalizedFixture)) byDay.set(utcDate(Date.parse(f.kickoff_at)), [...(byDay.get(utcDate(Date.parse(f.kickoff_at))) ?? []), f])
        for (const [d, list] of byDay) await db.rpc('provider_cache_merge', { p_provider: provider.id, p_key: `day:${d}`, p_fixtures: list })
        await apply(live)
        done.push(`live:${live.length}`)
        queue.unshift(...afterLive(tracked, new Set(live.map((f) => f.external_id)), dayFetchedAt, Date.now()).filter((x) => x.kind === 'day' && !fetchedDays.has(x.date)))
      } else {
        if (fetchedDays.has(a.date)) continue
        const fx = await dayFixtures(db, provider, [a.date], { mode: 'refresh', context: { priority: a.priority, purpose: a.reason.slice(0, 40) } })
        fetchedDays.add(a.date)
        dayFetchedAt[a.date] = Date.now()
        await apply(fx)
        done.push(`day:${a.date}:${fx.length}`)
      }
      // Lo aplicado ya cuenta para las decisiones siguientes de esta pasada.
      tracked = await rpc<TrackedMatch[]>('get_tracked_matches', { p_provider: provider.id })
    } catch (e) {
      const code = e instanceof ProviderError ? e.code : 'ERROR'
      if (a.kind === 'live' && code === 'PLAN_RESTRICTED') {
        // El plan no permite «en vivo»: se usa el día de los partidos en juego.
        for (const d of new Set(tracked.filter((m) => m.status === 'live' || Date.parse(m.kickoff_at) <= Date.now()).map((m) => utcDate(Date.parse(m.kickoff_at))))) {
          queue.unshift({ kind: 'day', date: d, priority: 1, reason: 'en vivo (por día)' })
        }
        errors.push('El plan no permite la consulta en vivo: se consulta por día')
        continue
      }
      errors.push(`${a.kind === 'live' ? 'live' : a.date}: ${code}: ${(e as Error).message}`)
      if (STOP.has(code)) stopped = code
    }
  }

  // Lo que depende de los datos descargados (sin nuevas solicitudes).
  const extras: Record<string, unknown> = {}
  if (done.length) {
    try { extras.featured = await refreshFeatured(db, provider) } catch (e) { extras.featured = { error: (e as Error).message } }
  }
  const calendar = [utcDate(now), utcDate(now + 86400e3)].some((d) => fetchedDays.has(d))
  if (calendar) {
    try { extras.poolImport = await autoImportPool(db, provider) } catch (e) { extras.poolImport = { error: (e as Error).message } }
  }
  if (fetchedDays.size) {
    try { extras.autoLink = await autoLinkManual(db, provider) } catch (e) { extras.autoLink = { error: (e as Error).message } }
  }

  const status = done.length === 0 ? (stopped ? 'partial' : 'error') : errors.length ? 'partial' : 'success'
  await rpc('finish_sync_run', {
    p_run_id: runId, p_status: status, p_checked: checked, p_updated: updated,
    p_error: errors.length ? errors.slice(0, 5).join(' | ') : null,
    p_details: { ...summary, done, stopped, anomalies: anomalies.slice(0, 20), errors: errors.slice(0, 20), incomplete: provider.incomplete, ...extras },
  })
  return { skipped: false, runId, status, checked, updated, done, stopped, errors, anomalies, ...summary, ...extras }
}
