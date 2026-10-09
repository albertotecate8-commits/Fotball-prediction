import { ApiFootballProvider } from './apiFootball.ts'
import { MockProvider } from './mock.ts'
import { ProviderError, type FootballProvider } from './types.ts'

export * from './types.ts'
export { ApiFootballProvider, MockProvider }

/** Selecciona el proveedor según variables de entorno del servidor. */
export function createProvider(env: { FOOTBALL_PROVIDER?: string; API_FOOTBALL_KEY?: string }): FootballProvider {
  const id = (env.FOOTBALL_PROVIDER ?? 'mock').toLowerCase()
  if (id === 'api-football') return new ApiFootballProvider({ apiKey: env.API_FOOTBALL_KEY ?? '' })
  if (id === 'mock') return new MockProvider()
  throw new ProviderError(`Proveedor desconocido: ${id}`, false)
}
