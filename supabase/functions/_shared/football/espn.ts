// Resultados gratis desde el marcador público de ESPN (sin clave). Llegan al
// momento (TheSportsDB tarda 20-30 min en marcar un partido como final). El
// partido se reconoce por sus dos equipos y su hora de inicio; si no hay un
// candidato claro, no se aplica nada (lo cubre TheSportsDB).
import type { FreeTarget, FreeUpdate } from './freeResults.ts'
import { teamSimilarity } from './matching.ts'

/** Liga de API-Football → liga de ESPN. */
export const ESPN_LEAGUES: Record<string, string> = {
  '262': 'mex.1', // Liga MX
  '263': 'mex.2', // Liga de Expansión MX
  '140': 'esp.1', // La Liga
  '2': 'uefa.champions',
}

export interface EspnEvent {
  date?: string
  status?: { type?: { name?: string; state?: string; completed?: boolean } }
  competitions?: { competitors?: { homeAway?: string; score?: string; team?: { displayName?: string; shortDisplayName?: string; name?: string } }[] }[]
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll('-', '')

/** Consultas: una por (liga, día). ESPN agrupa por día de América, así que se pide el día UTC y el de 6 h antes. */
export function espnRequests(targets: FreeTarget[]): { slug: string; date: string }[] {
  const out = new Map<string, { slug: string; date: string }>()
  for (const t of targets) {
    const slug = t.league ? ESPN_LEAGUES[t.league] : undefined
    if (!slug) continue
    const k = Date.parse(t.kickoff_at)
    for (const date of new Set([ymd(k), ymd(k - 6 * 3600e3)])) out.set(`${slug}:${date}`, { slug, date })
  }
  return [...out.values()]
}

const score = (v: string | undefined) => (v != null && /^\d{1,2}$/.test(v.trim()) ? Number(v) : null)

/** Estado de ESPN → actualización (null = nada que aplicar). */
export function toEspnUpdate(e: EspnEvent): FreeUpdate | null {
  const name = String(e.status?.type?.name ?? '').toUpperCase()
  const state = String(e.status?.type?.state ?? '')
  const cs = e.competitions?.[0]?.competitors ?? []
  const h = score(cs.find((c) => c.homeAway === 'home')?.score)
  const a = score(cs.find((c) => c.homeAway === 'away')?.score)
  if (name.includes('POSTPONED')) return { status: 'postponed', status_detail: 'PST', home_goals: null, away_goals: null }
  if (name.includes('CANCEL')) return { status: 'cancelled', status_detail: 'CANC', home_goals: null, away_goals: null }
  if (name.includes('ABANDON')) return h === null || a === null ? null : { status: 'abandoned', status_detail: 'ABD', home_goals: h, away_goals: a }
  if (state === 'post' && e.status?.type?.completed) {
    if (h === null || a === null) return null
    return { status: 'finished', status_detail: name.includes('PEN') ? 'PEN' : name.includes('AET') || name.includes('EXTRA') ? 'AET' : 'FT', home_goals: h, away_goals: a }
  }
  if (state === 'in') return { status: 'live', status_detail: name.includes('HALFTIME') ? 'HT' : 'LIVE', home_goals: h ?? 0, away_goals: a ?? 0 }
  return null
}

/** El evento de ESPN del partido: mismos equipos y hora cercana (±3 h). Solo si hay uno claro. */
export function matchEspn(t: FreeTarget, events: EspnEvent[]): EspnEvent | null {
  if (!t.home_name || !t.away_name) return null
  const k = Date.parse(t.kickoff_at)
  const team = (e: EspnEvent, side: string) => {
    const c = e.competitions?.[0]?.competitors?.find((x) => x.homeAway === side)?.team
    return [c?.displayName, c?.shortDisplayName, c?.name].filter(Boolean) as string[]
  }
  const sim = (names: string[], ours: string) => Math.max(0, ...names.map((n) => teamSimilarity(n, ours)))
  const found = events.filter((e) => {
    const d = Date.parse(e.date ?? '')
    return Number.isFinite(d) && Math.abs(d - k) <= 3 * 3600e3
      && sim(team(e, 'home'), t.home_name!) >= 0.6 && sim(team(e, 'away'), t.away_name!) >= 0.6
  })
  return found.length === 1 ? found[0]! : null
}
