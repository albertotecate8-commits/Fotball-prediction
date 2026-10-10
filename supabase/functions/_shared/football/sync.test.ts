import { describe, expect, it } from 'vitest'
import { runAllProviders, runSync, type SyncStore } from './sync.ts'
import { ProviderError, type FootballProvider, type NormalizedFixture } from './types.ts'

const fx = (id: string, home: number | null, away: number | null, status: NormalizedFixture['status'] = 'finished'): NormalizedFixture => ({
  external_id: id, kickoff_at: '2026-10-10T20:00:00.000Z', status, status_detail: null, elapsed: null,
  home_goals: home, away_goals: away,
  home: { external_id: 'h', name: 'Local', short_name: 'Local' }, away: { external_id: 'a', name: 'Visita', short_name: 'Visita' },
})

/** Almacén en memoria que reproduce la idempotencia de apply_provider_update. */
function memoryStore(targets: { match_id: string; provider: string; external_id: string }[]) {
  const state = new Map<string, string>()
  const runs: Record<string, unknown>[] = []
  const errors: Record<string, string> = {}
  const store: SyncStore = {
    getTargets: async () => targets,
    applyUpdate: async (id, f) => {
      const key = `${f.status}:${f.home_goals}-${f.away_goals}`
      const changed = state.get(id) !== key
      state.set(id, key)
      return { changed, result_changed: changed }
    },
    recordError: async (id, m) => { errors[id] = m },
    startRun: async () => runs.push({}) ,
    finishRun: async (id, r) => { runs[id - 1] = r },
    runMaintenance: async () => 1,
  }
  return { store, state, runs, errors }
}

const provider = (impl: (ids: string[]) => Promise<NormalizedFixture[]>): FootballProvider => ({
  id: 'api-football', isTestData: false,
  searchFixtures: async () => [], listCompetitions: async () => [], getFixturesByIds: impl,
  status: async () => ({ provider: 'api-football', is_test_data: false, ok: true }),
})

describe('runSync', () => {
  it('actualiza los partidos objetivo y registra la ejecución', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'api-football', external_id: '1' }, { match_id: 'm2', provider: 'api-football', external_id: '2' }])
    const r = await runSync(m.store, provider(async () => [fx('1', 2, 1), fx('2', 0, 0, 'live')]), 'cron')
    expect(r).toMatchObject({ status: 'success', checked: 2, updated: 2 })
    expect(m.runs[0]).toMatchObject({ status: 'success', checked: 2, updated: 2 })
  })

  it('resultado duplicado: segunda ejecución no cuenta cambios', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'api-football', external_id: '1' }])
    const p = provider(async () => [fx('1', 2, 1)])
    await runSync(m.store, p, 'cron')
    const second = await runSync(m.store, p, 'cron')
    expect(second.updated).toBe(0)
  })

  it('resultado corregido: se detecta como cambio', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'api-football', external_id: '1' }])
    await runSync(m.store, provider(async () => [fx('1', 2, 1)]), 'cron')
    const fix = await runSync(m.store, provider(async () => [fx('1', 2, 2)]), 'cron')
    expect(fix.updated).toBe(1)
    expect(m.state.get('m1')).toBe('finished:2-2')
  })

  it('proveedor no disponible: marca error, no toca los datos y ejecuta el mantenimiento', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'api-football', external_id: '1' }])
    m.state.set('m1', 'finished:2-1')
    let maintained = false
    m.store.runMaintenance = async () => { maintained = true; return 0 }
    const out = await runAllProviders(m.store, () => provider(async () => { throw new ProviderError('API caída', true) }), 'cron')
    expect(out.reports[0]!.status).toBe('error')
    expect(maintained).toBe(true)
    expect(m.runs[0]).toMatchObject({ status: 'error', error: 'UNAVAILABLE: API caída' })
    expect(m.state.get('m1')).toBe('finished:2-1')
  })

  it('cuota agotada: ejecución parcial, conserva los últimos datos válidos', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'api-football', external_id: '1' }])
    m.state.set('m1', 'live:1-0')
    const r = await runSync(m.store, provider(async () => { throw new ProviderError('sin cupo', false, undefined, 'QUOTA_EXHAUSTED') }), 'cron')
    expect(r).toMatchObject({ status: 'partial', quotaStopped: true, updated: 0 })
    expect(m.state.get('m1')).toBe('live:1-0')
  })

  it('partido no devuelto: ejecución parcial y error registrado en el partido', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'api-football', external_id: '1' }, { match_id: 'm2', provider: 'api-football', external_id: '2' }])
    const r = await runSync(m.store, provider(async () => [fx('1', 1, 0)]), 'manual')
    expect(r.status).toBe('partial')
    expect(m.errors.m2).toBe('NOT_RETURNED_BY_PROVIDER')
  })

  it('ignora partidos de otro proveedor', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'mock', external_id: 'x' }])
    let called = false
    const r = await runSync(m.store, provider(async () => { called = true; return [] }), 'cron')
    expect(called).toBe(false)
    expect(r.skippedOtherProvider).toBe(1)
  })

  it('error al aplicar un partido no detiene a los demás', async () => {
    const m = memoryStore([{ match_id: 'm1', provider: 'api-football', external_id: '1' }, { match_id: 'm2', provider: 'api-football', external_id: '2' }])
    const orig = m.store.applyUpdate
    m.store.applyUpdate = async (id, f) => { if (id === 'm1') throw new Error('db'); return orig(id, f) }
    const r = await runSync(m.store, provider(async () => [fx('1', 1, 0), fx('2', 1, 0)]), 'cron')
    expect(r).toMatchObject({ status: 'partial', updated: 1 })
  })
})

describe('runAllProviders', () => {
  it('agrupa por proveedor: una consulta por proveedor y no mezcla datos', async () => {
    const m = memoryStore([
      { match_id: 'r1', provider: 'api-football', external_id: '1' },
      { match_id: 'r2', provider: 'api-football', external_id: '2' },
      { match_id: 'd1', provider: 'mock', external_id: 'mock-1' },
    ])
    const calls: Record<string, string[][]> = { 'api-football': [], mock: [] }
    const make = (id: string): FootballProvider => ({
      ...provider(async (ids) => { calls[id]!.push(ids); return ids.map((x) => fx(x, 1, 0)) }), id, isTestData: id === 'mock',
    })
    const out = await runAllProviders(m.store, make, 'cron')
    expect(calls['api-football']).toEqual([['1', '2']])
    expect(calls.mock).toEqual([['mock-1']])
    expect(out.reports.map((r) => [r.provider, r.checked])).toEqual([['api-football', 2], ['mock', 1]])
  })

  it('proveedor sin configurar: no se consulta ni se rellena con datos ficticios', async () => {
    const m = memoryStore([{ match_id: 'r1', provider: 'api-football', external_id: '1' }])
    const out = await runAllProviders(m.store, () => null, 'cron')
    expect(out.unconfigured).toEqual({ 'api-football': 1 })
    expect(out.reports).toEqual([])
    expect(m.state.size).toBe(0)
    expect(out.maintained).toBe(1)
  })

  it('sin partidos pendientes no se llama a la API', async () => {
    const m = memoryStore([])
    let resolved = 0
    const out = await runAllProviders(m.store, () => { resolved++; return null }, 'cron')
    expect(resolved).toBe(0)
    expect(out.reports).toEqual([])
  })
})
