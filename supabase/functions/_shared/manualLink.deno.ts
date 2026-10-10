// Partido capturado a mano: se vincula con el proveedor por equipos, fecha y
// competición. Solo con un candidato claro; si no, devuelve candidatos para que
// el admin elija. Crear un partido SIN proveedor requiere pedirlo explícitamente.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { FootballProvider, NormalizedFixture } from './football/index.ts'
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

  if (m.create_unlinked) {
    const { data, error } = await db.rpc('create_manual_match', {
      p_home: home, p_away: away, p_kickoff: kickoffIso, p_competition: m.competitionName?.toString().slice(0, 80) ?? null, p_actor: actorId,
    })
    if (error) throw new Error(error.message)
    return { kind: 'manual' as const, match_id: data.match_id as string, created: data.created as boolean }
  }

  // Partidos del día (todas las ligas), en caché: 1 solicitud por día UTC.
  const fixtures: NormalizedFixture[] = []
  for (const date of utcDaysAround(kickoffIso)) {
    const key = `day:${date}`
    let dayFx: NormalizedFixture[] | null = null
    if (!provider.isTestData) {
      const { data } = await db.rpc('provider_cache_get', { p_provider: provider.id, p_key: key })
      dayFx = data ?? null
    }
    if (!dayFx) {
      dayFx = (await provider.searchFixtures({ from: date })).map(({ raw: _raw, ...rest }) => rest)
      if (!provider.isTestData) {
        await db.rpc('provider_cache_put', { p_provider: provider.id, p_key: key, p_payload: dayFx, p_ttl_seconds: date <= today ? 1800 : 6 * 3600 })
      }
    }
    fixtures.push(...dayFx)
  }

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
