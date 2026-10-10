// Conecta los proveedores con la base de datos: reserva y registro de cada
// solicitud (provider_reserve / provider_finish). La clave nunca sale de aquí.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createProvider, defaultProviderId, realProviderConfigured, type FootballProvider, type ProviderEnv, type RequestGate } from './football/index.ts'

export const providerEnv = (): ProviderEnv => ({
  FOOTBALL_PROVIDER: Deno.env.get('FOOTBALL_PROVIDER'),
  API_FOOTBALL_KEY: Deno.env.get('API_FOOTBALL_KEY'),
})

/**
 * Puerta única hacia el proveedor: el presupuesto (80/día UTC, margen de 20,
 * límite por minuto y prioridades) se decide en la base de datos de forma
 * atómica, así ninguna función concurrente puede pasarse.
 */
export function dbGate(db: SupabaseClient, provider: string): RequestGate {
  return {
    async take(info) {
      const { data, error } = await db.rpc('provider_reserve', {
        p_provider: provider, p_priority: info.priority, p_purpose: info.purpose, p_endpoint: info.endpoint, p_counted: info.counted,
      })
      // Si no se puede comprobar la cuota, no se consulta (falla de forma segura).
      if (error) return { allowed: false, reason: 'QUOTA_CHECK_FAILED' }
      return { allowed: data?.allowed === true, reason: data?.reason, id: data?.request_id ?? null }
    },
    async finish(ticket, r) {
      if (!ticket.id) return
      await db.rpc('provider_finish', {
        p_request_id: ticket.id, p_outcome: r.outcome, p_http_status: r.httpStatus, p_remaining: r.remainingDaily, p_limit: r.limitDaily,
        p_duration_ms: r.durationMs, p_results: r.results, p_error: r.error ?? null,
      })
    },
  }
}

/** Estado de la cuota de hoy (sin consultar al proveedor). */
export async function quotaState(db: SupabaseClient, provider: string) {
  const { data, error } = await db.rpc('provider_quota_state', { p_provider: provider })
  if (error) throw new Error(`provider_quota_state: ${error.message}`)
  return data as { used: number; budget: number; effective_remaining: number; paused: boolean; paused_until: string | null; pause_reason: string | null }
}

/**
 * Lo que se sabe del plan (temporadas o ids no disponibles) se recuerda 24 h
 * en provider_cache para no gastar una solicitud en descubrirlo cada vez.
 */
export async function loadPlanFlags(db: SupabaseClient, p: FootballProvider | null) {
  if (!p || p.isTestData) return
  const { data } = await db.rpc('provider_cache_get', { p_provider: p.id, p_key: 'plan_flags' })
  const w = Array.isArray(data?.dateWindow) && data.dateWindow.length === 2 ? data.dateWindow.map(Number) : null
  Object.assign(p, { seasonRestricted: data?.seasonRestricted === true, idsRestricted: data?.idsRestricted === true, liveRestricted: data?.liveRestricted === true, dateWindow: w })
}
export async function savePlanFlags(db: SupabaseClient, p: FootballProvider | null) {
  if (!p || p.isTestData) return
  const f = p as unknown as { seasonRestricted?: boolean; idsRestricted?: boolean; liveRestricted?: boolean; dateWindow?: [number, number] | null }
  if (!f.seasonRestricted && !f.idsRestricted && !f.liveRestricted && !f.dateWindow) return
  await db.rpc('provider_cache_put', {
    p_provider: p.id, p_key: 'plan_flags',
    p_payload: { seasonRestricted: !!f.seasonRestricted, idsRestricted: !!f.idsRestricted, liveRestricted: !!f.liveRestricted, dateWindow: f.dateWindow ?? null }, p_ttl_seconds: 86400,
  })
}

/** Proveedor por id o null si no está configurado (los datos reales nunca caen a ficticios). */
export function resolveProvider(db: SupabaseClient, id: string): FootballProvider | null {
  const env = providerEnv()
  if (id === 'api-football' && !realProviderConfigured(env)) return null
  try {
    return createProvider(id, env, id === 'mock' ? undefined : dbGate(db, id))
  } catch {
    return null
  }
}

export { defaultProviderId, realProviderConfigured }
