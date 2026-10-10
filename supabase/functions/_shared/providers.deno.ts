// Conecta los proveedores con la base de datos: control de cuota compartido
// (provider_take_quota / provider_report_quota). La clave nunca sale de aquí.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { createProvider, defaultProviderId, realProviderConfigured, type FootballProvider, type ProviderEnv, type RequestGate } from './football/index.ts'

/** Presupuesto propio por debajo del límite del plan gratuito (100/día). */
export const QUOTA = {
  'api-football': { daily: Number(Deno.env.get('API_FOOTBALL_DAILY_BUDGET') ?? 90), minute: 8, reserve: 5 },
} as Record<string, { daily: number; minute: number; reserve: number }>

export const providerEnv = (): ProviderEnv => ({
  FOOTBALL_PROVIDER: Deno.env.get('FOOTBALL_PROVIDER'),
  API_FOOTBALL_KEY: Deno.env.get('API_FOOTBALL_KEY'),
})

export function dbGate(db: SupabaseClient, provider: string): RequestGate {
  const q = QUOTA[provider] ?? { daily: 90, minute: 8, reserve: 5 }
  return {
    async take() {
      const { data, error } = await db.rpc('provider_take_quota', { p_provider: provider, p_daily_budget: q.daily, p_minute_budget: q.minute, p_reserve: q.reserve })
      // Si no se puede comprobar la cuota, no se consulta (falla de forma segura).
      if (error) return { allowed: false, reason: 'QUOTA_CHECK_FAILED' }
      return { allowed: data?.allowed === true, reason: data?.reason }
    },
    async report(info) {
      await db.rpc('provider_report_quota', { p_provider: provider, p_remaining: info.remainingDaily, p_limit: info.limitDaily, p_error: info.error ?? null })
    },
  }
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
