// Caché compartida de «partidos del día» (todas las ligas, 1 solicitud por día
// UTC). Todo lo que necesita partidos de un día lee de aquí: sincronización,
// destacados, importación automática y vinculación de partidos del admin.
// - Una lectura de caché NUNCA cuenta como solicitud (se suma aparte).
// - Dos funciones que piden el mismo día a la vez no generan dos solicitudes:
//   la segunda espera a que la primera guarde el resultado.
// - Si la consulta falla, lo guardado se conserva intacto.
import { ProviderError, type FootballProvider, type NormalizedFixture, type RequestContext } from './types.ts'

export interface DayCacheStore {
  get(key: string): Promise<{ payload: NormalizedFixture[]; fetchedAt: number } | null>
  put(key: string, payload: NormalizedFixture[], ttlSeconds: number): Promise<void>
  /** Respuestas servidas desde caché (para el panel). */
  hit(n: number): Promise<void>
  /** Candado por clave; null si otra función ya la está consultando. */
  lock(key: string): Promise<(() => Promise<void>) | null>
  sleep(ms: number): Promise<void>
}

export type DayMode =
  /** Solo lo guardado: jamás consulta al proveedor. */
  | { mode: 'cache-only' }
  /** Usa lo guardado si tiene menos de `maxAgeMin`; si no, consulta. */
  | { mode: 'cache-first'; maxAgeMin: number; context: RequestContext }
  /** Consulta (el planificador ya decidió que toca). */
  | { mode: 'refresh'; context: RequestContext }

/** Se guarda 36 h; la frescura la decide el planificador por la fecha de descarga. */
export const DAY_TTL_SECONDS = 36 * 3600
const WAIT_STEPS = 8

export const dayKey = (date: string) => `day:${date}`

export async function getDays(store: DayCacheStore, provider: FootballProvider, days: string[], opts: DayMode, now = () => Date.now()) {
  const fixtures: NormalizedFixture[] = []
  const fetched: string[] = []
  let hits = 0
  let lastError: unknown = null
  for (const date of days) {
    const key = dayKey(date)
    const cached = provider.isTestData ? null : await store.get(key)
    const fresh = cached && (opts.mode === 'cache-only' || (opts.mode === 'cache-first' && now() - cached.fetchedAt < opts.maxAgeMin * 60e3))
    if (opts.mode === 'cache-only' || fresh) {
      if (cached) { fixtures.push(...cached.payload); hits++ }
      continue
    }
    try {
      const got = await fetchDay(store, provider, date, opts.context, now)
      fixtures.push(...got.fixtures)
      if (got.fromCache) hits++
      else fetched.push(date)
    } catch (e) {
      // Un día fuera de la ventana del plan no impide usar los demás.
      if (e instanceof ProviderError && e.code === 'PLAN_RESTRICTED') { lastError = e; continue }
      throw e
    }
  }
  if (hits) await store.hit(hits)
  if (lastError && fixtures.length === 0) throw lastError
  return { fixtures, fetched, hits }
}

async function fetchDay(store: DayCacheStore, provider: FootballProvider, date: string, context: RequestContext, now: () => number) {
  const key = dayKey(date)
  const started = now()
  if (provider.isTestData) return { fixtures: await provider.searchFixtures({ from: date }), fromCache: false }
  const release = await store.lock(key)
  if (!release) {
    // Otra función la está consultando: esperar su resultado en vez de duplicar la solicitud.
    for (let i = 0; i < WAIT_STEPS; i++) {
      await store.sleep(1000)
      const c = await store.get(key)
      if (c && c.fetchedAt >= started - 1000) return { fixtures: c.payload, fromCache: true }
    }
    throw new ProviderError('Otra consulta del mismo día sigue en curso', true, undefined, 'UNAVAILABLE')
  }
  try {
    // Pudo terminar otra justo antes de tomar el candado.
    const c = await store.get(key)
    if (c && now() - c.fetchedAt < 60e3) return { fixtures: c.payload, fromCache: true }
    ;(provider as unknown as { context?: RequestContext }).context = context
    const fixtures = (await provider.searchFixtures({ from: date })).map(({ raw: _raw, ...rest }) => rest)
    // Una respuesta vacía no borra un día que antes tenía partidos: se conserva
    // lo anterior (y se anota la revisión para no repetirla en cada pasada).
    if (fixtures.length === 0 && c && c.payload.length > 0) {
      await store.put(key, c.payload, DAY_TTL_SECONDS)
      return { fixtures: c.payload, fromCache: false }
    }
    await store.put(key, fixtures, DAY_TTL_SECONDS)
    return { fixtures, fromCache: false }
  } finally {
    await release()
  }
}
