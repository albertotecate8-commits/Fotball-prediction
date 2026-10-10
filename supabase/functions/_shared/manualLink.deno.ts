// Partido capturado a mano: se vincula con el proveedor por equipos, fecha y
// competición. Solo con un candidato claro; si no, devuelve candidatos para que
// el admin elija. Crear un partido SIN proveedor requiere pedirlo explícitamente.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { getDays, ProviderError, type DayCacheStore, type DayMode, type FootballProvider, type NormalizedFixture } from './football/index.ts'
import { loadPlanFlags, savePlanFlags } from './providers.deno.ts'
import { findProviderMatch, utcDaysAround } from './football/matching.ts'
import { selectFeatured } from './football/featured.ts'

export interface ManualInput {
  home?: string
  away?: string
  kickoff_at?: string
  competitionId?: string
  competitionName?: string
  pick_external_id?: string
  create_unlinked?: boolean
  /** No crear partido manual si la fecha no se puede consultar (lo decide el admin). */
  no_create?: boolean
}

/** Almacén de la caché por día sobre provider_cache (con candado por clave). */
export function dayStore(db: SupabaseClient, providerId: string): DayCacheStore {
  return {
    async get(key) {
      const { data } = await db.from('provider_cache').select('payload, fetched_at, expires_at').eq('provider', providerId).eq('cache_key', key).maybeSingle()
      if (!data || Date.parse(data.expires_at) <= Date.now() || !Array.isArray(data.payload)) return null
      return { payload: data.payload as NormalizedFixture[], fetchedAt: Date.parse(data.fetched_at) }
    },
    async put(key, payload, ttl) {
      await db.rpc('provider_cache_put', { p_provider: providerId, p_key: key, p_payload: payload, p_ttl_seconds: ttl })
    },
    async hit(n) {
      await db.rpc('provider_cache_hit', { p_provider: providerId, p_hits: n })
    },
    async lock(key) {
      const holder = crypto.randomUUID()
      const { data } = await db.rpc('acquire_sync_lease', { p_name: `fetch:${providerId}:${key}`, p_holder: holder, p_seconds: 30 })
      if (data !== true) return null
      return async () => { await db.rpc('release_sync_lease', { p_name: `fetch:${providerId}:${key}`, p_holder: holder }) }
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  }
}

/** Partidos de varios días (todas las ligas) desde la caché compartida. */
export async function dayFixtures(db: SupabaseClient, provider: FootballProvider, days: string[], opts: DayMode): Promise<NormalizedFixture[]> {
  return (await getDays(dayStore(db, provider.id), provider, days, opts)).fixtures
}

const summary = (x: NormalizedFixture) => ({
  external_id: x.external_id, kickoff_at: x.kickoff_at, home: x.home.name, away: x.away.name, competition: x.competition?.name ?? null,
})

export async function linkManualMatch(db: SupabaseClient, provider: FootballProvider, m: ManualInput, actorId: string | null) {
  const home = (m.home ?? '').toString().trim().slice(0, 60)
  const away = (m.away ?? '').toString().trim().slice(0, 60)
  const kickoff = Date.parse(m.kickoff_at ?? '')
  if (home.length < 2 || away.length < 2 || Number.isNaN(kickoff)) return { kind: 'invalid' as const, error: 'INVALID_MATCH' }
  const kickoffIso = new Date(kickoff).toISOString()
  const competitionId = m.competitionId?.toString().slice(0, 20) || undefined
  const createManual = async () => {
    const { data, error } = await db.rpc('create_manual_match', {
      p_home: home, p_away: away, p_kickoff: kickoffIso, p_competition: m.competitionName?.toString().slice(0, 80) ?? null, p_actor: actorId,
    })
    if (error) throw new Error(error.message)
    return { match_id: data.match_id as string, created: data.created as boolean }
  }
  if (m.create_unlinked) return { kind: 'manual' as const, ...(await createManual()) }

  await loadPlanFlags(db, provider)
  let fixtures: NormalizedFixture[]
  try {
    // Acción del admin: reutiliza el día en caché si tiene menos de 30 min.
    fixtures = await dayFixtures(db, provider, utcDaysAround(kickoffIso), { mode: 'cache-first', maxAgeMin: 30, context: { priority: 3, purpose: 'admin:vincular' } })
  } catch (e) {
    await savePlanFlags(db, provider)
    if (!(e instanceof ProviderError) || e.code !== 'PLAN_RESTRICTED') throw e
    if (m.no_create) return { kind: 'outside_window' as const, provider: provider.id, message: e.message, candidates: [] }
    // Fecha aún fuera de la ventana del plan: se guarda como manual y el
    // sincronizador lo vinculará solo cuando el proveedor permita consultarla.
    return { kind: 'pending_link' as const, provider: provider.id, message: e.message, ...(await createManual()) }
  }
  await savePlanFlags(db, provider)

  const picked = m.pick_external_id ? fixtures.find((x) => x.external_id === m.pick_external_id) : undefined
  const decision = picked ? { kind: 'linked' as const, fixture: picked } : findProviderMatch({ home, away, kickoff_at: kickoffIso, competitionId }, fixtures)
  if (decision.kind !== 'linked') {
    const list = decision.kind === 'ambiguous' ? decision.candidates : decision.suggestions
    return { kind: decision.kind, provider: provider.id, candidates: list.map(summary) }
  }

  // Upsert por id externo: si ya estaba importado se reutiliza (sin duplicados).
  const { data, error } = await db.rpc('upsert_provider_fixtures', { p_provider: provider.id, p_fixtures: [decision.fixture], p_is_test_data: provider.isTestData })
  if (error) throw new Error(error.message)
  const matchId = data.match_ids[0] as string
  const alreadyImported = data.inserted === 0
  await db.from('audit_logs').insert({
    actor_id: actorId, action: 'match.manual_linked', entity_type: 'match', entity_id: matchId,
    details: { input: { home, away, kickoff_at: kickoffIso, competitionId }, provider: provider.id, external_id: decision.fixture.external_id, already_imported: alreadyImported },
  })
  return { kind: 'linked' as const, provider: provider.id, is_test_data: provider.isTestData, match_id: matchId, already_imported: alreadyImported, fixture: summary(decision.fixture) }
}

/**
 * Paso del sincronizador: vincula los partidos manuales de jornadas cuya fecha
 * ya entra en la ventana del plan. Comparte la caché por día con el panel.
 */
export async function autoLinkManual(db: SupabaseClient, provider: FootballProvider) {
  const w = (provider as unknown as { dateWindow?: [number, number] | null }).dateWindow ?? [-1, 1]
  const { data: cands, error } = await db.rpc('get_link_candidates', { p_days_back: Math.max(0, -w[0]), p_days_ahead: Math.max(0, w[1]) })
  if (error) throw new Error(`get_link_candidates: ${error.message}`)
  const list = (cands ?? []) as { match_id: string; home: string; away: string; kickoff_at: string }[]
  const out = { checked: list.length, linked: 0, pending: 0, conflicts: 0 }
  if (!list.length) return out

  const days = [...new Set(list.map((c) => new Date(c.kickoff_at).toISOString().slice(0, 10)))]
  // Solo caché: el planificador es quien decide cuándo se descargan los días.
  const fixtures = await dayFixtures(db, provider, days, { mode: 'cache-only' })
  for (const c of list) {
    const d = findProviderMatch({ home: c.home, away: c.away, kickoff_at: c.kickoff_at }, fixtures)
    if (d.kind === 'linked') {
      const { data: r, error: e } = await db.rpc('link_manual_match', { p_match_id: c.match_id, p_provider: provider.id, p_fixture: d.fixture })
      if (e) throw new Error(`link_manual_match: ${e.message}`)
      if (r?.linked) out.linked++
      else out.conflicts++
    } else {
      await db.rpc('record_link_attempt', { p_match_id: c.match_id })
      out.pending++
    }
  }
  return out
}

/**
 * Refresca los destacados de Inicio con los partidos de hoy y mañana (en
 * caché por día). No toca jornadas: solo la tabla featured_fixtures.
 */
/** Destacados de Inicio a partir de la caché de hoy y mañana (no consulta al proveedor). */
export async function refreshFeatured(db: SupabaseClient, provider: FootballProvider) {
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10)
  const fixtures = await dayFixtures(db, provider, [today, tomorrow], { mode: 'cache-only' })
  // Sin datos guardados no se tocan los destacados (se conservan los últimos).
  if (fixtures.length === 0) return { skipped: true, reason: 'NO_CACHE' }
  const items = selectFeatured(fixtures)
  const { error } = await db.rpc('upsert_featured_fixtures', { p_provider: provider.id, p_items: items })
  if (error) throw new Error(`upsert_featured_fixtures: ${error.message}`)
  return { skipped: false, candidates: fixtures.length, featured: items.length }
}

/**
 * Importación automática a la quiniela: partidos de hoy y mañana de las
 * fuentes configuradas (pool_sources). Usa la misma caché por día que los
 * destacados, así que no gasta solicitudes adicionales.
 */
export async function autoImportPool(db: SupabaseClient, provider: FootballProvider) {
  const { data: sources, error: se } = await db.from('pool_sources').select('kind, external_id').eq('provider', provider.id).eq('enabled', true)
  if (se) throw new Error(`pool_sources: ${se.message}`)
  const leagues = new Set((sources ?? []).filter((s) => s.kind === 'league').map((s) => s.external_id))
  const teams = new Set((sources ?? []).filter((s) => s.kind === 'team').map((s) => s.external_id))
  if (!leagues.size && !teams.size) return { candidates: 0, added: 0 }
  const today = new Date().toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 86400e3).toISOString().slice(0, 10)
  const fixtures = await dayFixtures(db, provider, [today, tomorrow], { mode: 'cache-only' })
  const wanted = fixtures.filter((f) => f.status === 'scheduled' && Date.parse(f.kickoff_at) > Date.now() && (
    (f.competition && leagues.has(f.competition.external_id)) || teams.has(f.home.external_id) || teams.has(f.away.external_id)))
  if (!wanted.length) return { candidates: 0, added: 0 }
  const { data, error } = await db.rpc('pool_auto_import', { p_provider: provider.id, p_fixtures: wanted })
  if (error) throw new Error(`pool_auto_import: ${error.message}`)
  return { candidates: wanted.length, ...(data as { imported: number; added: number }) }
}
