// Orquestación de la sincronización, independiente de Deno/Supabase para
// poder probarla con dobles. La Edge Function solo conecta las piezas.
import { ProviderError, type FootballProvider, type NormalizedFixture } from './types.ts'

export interface SyncTarget {
  match_id: string
  provider: string
  external_id: string
}

export interface SyncStore {
  getTargets(): Promise<SyncTarget[]>
  applyUpdate(matchId: string, fixture: NormalizedFixture): Promise<{ changed: boolean; result_changed?: boolean }>
  recordError(matchId: string, message: string): Promise<void>
  startRun(provider: string, trigger: 'cron' | 'manual' | 'test'): Promise<number>
  finishRun(runId: number, r: { status: SyncStatus; checked: number; updated: number; error: string | null; details: Record<string, unknown> }): Promise<void>
  runMaintenance(): Promise<number>
}

export type SyncStatus = 'success' | 'partial' | 'error'

export interface SyncReport {
  runId: number
  status: SyncStatus
  checked: number
  updated: number
  errors: string[]
  skippedOtherProvider: number
}

export async function runSync(store: SyncStore, provider: FootballProvider, trigger: 'cron' | 'manual' | 'test'): Promise<SyncReport> {
  const runId = await store.startRun(provider.id, trigger)
  const errors: string[] = []
  let checked = 0
  let updated = 0
  let skipped = 0
  let fatal: string | null = null

  try {
    const all = await store.getTargets()
    const targets = all.filter((t) => t.provider === provider.id)
    skipped = all.length - targets.length

    if (targets.length > 0) {
      const fixtures = await provider.getFixturesByIds([...new Set(targets.map((t) => t.external_id))])
      const byId = new Map(fixtures.map((f) => [f.external_id, f]))
      for (const t of targets) {
        checked++
        const fx = byId.get(t.external_id)
        if (!fx) {
          errors.push(`${t.external_id}: no devuelto por el proveedor`)
          await store.recordError(t.match_id, 'NOT_RETURNED_BY_PROVIDER')
          continue
        }
        try {
          const r = await store.applyUpdate(t.match_id, fx)
          if (r.changed) updated++
        } catch (e) {
          errors.push(`${t.external_id}: ${(e as Error).message}`)
          await store.recordError(t.match_id, (e as Error).message)
        }
      }
    }
  } catch (e) {
    fatal = e instanceof ProviderError ? e.message : `Error inesperado: ${(e as Error).message}`
  }

  // El cierre por fecha límite debe ocurrir aunque el proveedor falle.
  let maintained = 0
  try {
    maintained = await store.runMaintenance()
  } catch (e) {
    errors.push(`mantenimiento: ${(e as Error).message}`)
  }

  const status: SyncStatus = fatal ? 'error' : errors.length ? 'partial' : 'success'
  await store.finishRun(runId, {
    status, checked, updated,
    error: fatal ?? (errors.length ? errors.slice(0, 5).join(' | ') : null),
    details: { errors: errors.slice(0, 50), skipped_other_provider: skipped, rounds_maintained: maintained },
  })
  return { runId, status, checked, updated, errors: fatal ? [fatal, ...errors] : errors, skippedOtherProvider: skipped }
}
