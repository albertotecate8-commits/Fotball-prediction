import { ApiFootballProvider } from './apiFootball.ts'
import { MockProvider } from './mock.ts'
import { ProviderError, type FootballProvider, type RequestGate } from './types.ts'

export * from './types.ts'
export { ApiFootballProvider, MockProvider }
export type { ProviderTeam } from './apiFootball.ts'

export interface ProviderEnv {
  FOOTBALL_PROVIDER?: string
  API_FOOTBALL_KEY?: string
}

/** Proveedor real disponible: hay clave y no se forzó el modo demostración. */
export const realProviderConfigured = (env: ProviderEnv) =>
  !!env.API_FOOTBALL_KEY && (env.FOOTBALL_PROVIDER ?? '').toLowerCase() !== 'mock'

/** Proveedor por omisión para búsquedas: el real si está configurado; si no, demostración. */
export const defaultProviderId = (env: ProviderEnv) => (realProviderConfigured(env) ? 'api-football' : 'mock')

/** Crea el proveedor pedido. Los partidos guardan su proveedor: nunca se mezclan. */
export function createProvider(id: string, env: ProviderEnv, gate?: RequestGate): FootballProvider {
  if (id === 'api-football') {
    if (!env.API_FOOTBALL_KEY) throw new ProviderError('API_FOOTBALL_KEY no configurada', false, undefined, 'NOT_CONFIGURED')
    return new ApiFootballProvider({ apiKey: env.API_FOOTBALL_KEY, gate })
  }
  if (id === 'mock') return new MockProvider()
  throw new ProviderError(`Proveedor desconocido: ${id}`, false, undefined, 'NOT_CONFIGURED')
}
export * from './planner.ts'
export * from './dayCache.ts'
