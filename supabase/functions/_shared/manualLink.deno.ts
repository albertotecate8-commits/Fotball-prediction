// Partido capturado a mano: se vincula con el proveedor por equipos, fecha y
// competición. Solo con un candidato claro; si no, devuelve candidatos para que
// el admin elija. Crear un partido SIN proveedor requiere pedirlo explícitamente.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { ProviderError, type FootballProvider, type NormalizedFixture } from './football/index.ts'
import { loadPlanFlags, savePlanFlags } from './providers.deno.ts'
import { findProviderMatch, utcDaysAround } from './football/matching.ts'

export interface ManualInput {
  home?: string
  away?: string
  kickoff_at?: string
  competitionId?: string
  competitionName?: string
  pick_external_id?: string
  create_unlinked?: boolean
}

/** Partidos de varios días (todas las ligas), en caché: 1 solicitud por día UTC. */
export async function dayFixtures(db: SupabaseClient, provider: FootballProvider, days: string[], today: string): Promise<NormalizedFixture[]> {
  const fixtures: NormalizedFixture[] = []
  let lastError: unknown = null
  for (const date of days) {
    const key = `day:${date}`
    let dayFx: NormalizedFixture[] | null = null
    if (!provider.isTestData) {
      const { data } = await db.rpc('provider_cache_get', { p_provider: provider.id, p_key: key })
      dayFx = data ?? null
    }
    if (!dayFx) {
      try {
        dayFx = (await provider.searchFixtures({ from: date })).map(({ raw: _raw, ...rest }) => rest)
      } catch (e) {
        // Un día fuera de la ventana no impide usar los demás.
        if (e instanceof ProviderError && e.code === 'PLAN_RESTRICTED') { lastError = e; continue }
        throw e
      }
      if (!provider.isTestData) {
        await db.rpc('provider_cache_put', { p_provider: provider.id, p_key: key, p_payload: dayFx, p_ttl_seconds: date <= today ? 1800 : 6 * 3600 })
      }
    }
    fixtures.push(...dayFx)
  }
  if (lastError && fixtures.length === 0) throw lastError
  return fixtures
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
  const today = new Date().toISOString().slice(0, 10)

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
    fixtures = await dayFixtures(db, provider, utcDaysAround(kickoffIso), today)
  } catch (e) {
    await savePlanFlags(db, provider)
    if (!(e instanceof ProviderError) || e.code !== 'PLAN_RESTRICTED') throw e
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

  const today = new Date().toISOString().slice(0, 10)
  const days = [...new Set(list.map((c) => new Date(c.kickoff_at).toISOString().slice(0, 10)))]
  const fixtures = await dayFixtures(db, provider, days, today)
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
