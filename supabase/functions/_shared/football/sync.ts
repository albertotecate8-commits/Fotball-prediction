// Orquestación de la sincronización, independiente de Deno/Supabase para
// poder probarla con dobles. La Edge Function solo conecta las piezas.
import { ProviderError, type FootballProvider, type NormalizedFixture } from './types.ts'

export interface SyncTarget {
  match_id: string
  provider: string
  external_id: string
  kickoff_at?: string
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
  provider: string
  status: SyncStatus
  checked: number
  updated: number
  errors: string[]
  skippedOtherProvider: number
  quotaStopped?: boolean
}

/** Errores que afectan a todo el proveedor (no a un partido concreto). */
const isProviderWide = (e: unknown) =>
  e instanceof ProviderError && ['INVALID_KEY', 'PLAN_RESTRICTED', 'QUOTA_EXHAUSTED', 'BUDGET_BLOCKED', 'NOT_CONFIGURED', 'RATE_LIMITED', 'UNAVAILABLE'].includes(e.code)

/**
 * Sincroniza los partidos de UN proveedor. Si la cuota se agota o el
 * proveedor falla, los últimos datos válidos se conservan intactos: no se
 * inventa ni se marca nada como finalizado.
 */
export async function runSync(store: SyncStore, provider: FootballProvider, trigger: 'cron' | 'manual' | 'test', targetsIn?: SyncTarget[]): Promise<SyncReport> {
  const runId = await store.startRun(provider.id, trigger)
  const errors: string[] = []
  let checked = 0
  let updated = 0
  let skipped = 0
  let fatal: string | null = null
  let quotaStopped = false

  try {
    const all = targetsIn ?? (await store.getTargets())
    const targets = all.filter((t) => t.provider === provider.id)
    skipped = all.length - targets.length

    if (targets.length > 0) {
      const dates = [...new Set(targets.flatMap((t) => (t.kickoff_at ? [new Date(t.kickoff_at).toISOString().slice(0, 10)] : [])))]
      const fixtures = await provider.getFixturesByIds([...new Set(targets.map((t) => t.external_id))], { dates })
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
    if (e instanceof ProviderError && (e.code === 'QUOTA_EXHAUSTED' || e.code === 'BUDGET_BLOCKED' || e.code === 'RATE_LIMITED')) quotaStopped = true
    fatal = e instanceof ProviderError ? `${e.code}: ${e.message}` : `Error inesperado: ${(e as Error).message}`
    if (!isProviderWide(e)) fatal = `Error inesperado: ${(e as Error).message}`
  }

  const status: SyncStatus = fatal ? (quotaStopped ? 'partial' : 'error') : errors.length ? 'partial' : 'success'
  await store.finishRun(runId, {
    status, checked, updated,
    error: fatal ?? (errors.length ? errors.slice(0, 5).join(' | ') : null),
    details: { errors: errors.slice(0, 50), skipped_other_provider: skipped, quota_stopped: quotaStopped },
  })
  return { runId, provider: provider.id, status, checked, updated, errors: fatal ? [fatal, ...errors] : errors, skippedOtherProvider: skipped, quotaStopped }
}

/**
 * Una pasada completa: obtiene los partidos que toca consultar, los agrupa
 * por proveedor y sincroniza cada grupo con su proveedor. Los de un
 * proveedor no configurado se reportan pero no se tocan.
 */
export async function runAllProviders(
  store: SyncStore,
  resolve: (providerId: string) => FootballProvider | null,
  trigger: 'cron' | 'manual' | 'test',
): Promise<{ reports: SyncReport[]; unconfigured: Record<string, number>; maintained: number; errors: string[] }> {
  const targets = await store.getTargets()
  const byProvider = new Map<string, SyncTarget[]>()
  for (const t of targets) byProvider.set(t.provider, [...(byProvider.get(t.provider) ?? []), t])

  const reports: SyncReport[] = []
  const unconfigured: Record<string, number> = {}
  for (const [id, list] of byProvider) {
    const provider = resolve(id)
    if (!provider) {
      unconfigured[id] = list.length
      continue
    }
    reports.push(await runSync(store, provider, trigger, list))
  }

  // El cierre por fecha límite y la finalización ocurren aunque el proveedor falle.
  const errors: string[] = []
  let maintained = 0
  try {
    maintained = await store.runMaintenance()
  } catch (e) {
    errors.push(`mantenimiento: ${(e as Error).message}`)
  }
  return { reports, unconfigured, maintained, errors }
}
