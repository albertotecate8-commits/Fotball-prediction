// Proveedor de DEMOSTRACIÓN. Todos sus datos son ficticios y se guardan con
// is_test_data = true; la interfaz los marca como «Datos de prueba».
import type { FixtureSearch, FootballProvider, NormalizedCompetition, NormalizedFixture, NormalizedTeam, ProviderStatus } from './types.ts'

const TEAMS: NormalizedTeam[] = [
  ['Atlético Prueba', 'Atl. Prueba', 'ATP'],
  ['Deportivo Demo', 'Dep. Demo', 'DEM'],
  ['Real Ficticio', 'R. Ficticio', 'RFI'],
  ['Unión Ensayo', 'U. Ensayo', 'UEN'],
  ['Club Simulado', 'Simulado', 'SIM'],
  ['Racing Muestra', 'R. Muestra', 'RMU'],
  ['Sporting Test', 'Sp. Test', 'SPT'],
  ['Inter Ejemplo', 'Inter Ej.', 'INE'],
  ['Juventud Piloto', 'J. Piloto', 'JPI'],
  ['Estrella Beta', 'E. Beta', 'EBE'],
  ['Halcones Alfa', 'H. Alfa', 'HAL'],
  ['Toros Gamma', 'T. Gamma', 'TGA'],
].map(([name, short_name, code], i) => ({ external_id: `mock-team-${i + 1}`, name: name!, short_name: short_name!, code: code! }))

const COMPETITION: NormalizedCompetition = {
  external_id: 'mock-league', name: 'Liga de Prueba (datos ficticios)', country: 'Demo', season: '2026',
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)

export class MockProvider implements FootballProvider {
  readonly id = 'mock'
  readonly isTestData = true
  constructor(private readonly now: () => Date = () => new Date()) {}

  /** Seis partidos por día durante los próximos 14 días (y 7 hacia atrás). */
  private fixtureFor(dayOffset: number, slot: number): NormalizedFixture {
    const base = this.now()
    const day = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + dayOffset))
    const kickoff = new Date(day.getTime() + (18 + slot) * 3600e3) // 18:00–23:00 UTC
    const rot = (dayOffset + 30) % TEAMS.length
    const home = TEAMS[(rot + slot * 2) % TEAMS.length]!
    const away = TEAMS[(rot + slot * 2 + 1) % TEAMS.length]!
    const id = `mock-${day.toISOString().slice(0, 10)}-${slot}`
    return this.withState({ external_id: id, kickoff_at: kickoff.toISOString(), status: 'scheduled', status_detail: 'NS', elapsed: null, home_goals: null, away_goals: null, competition: COMPETITION, home, away })
  }

  /** Estado simulado según el reloj: en juego 0–110 min, final después. */
  private withState(f: NormalizedFixture): NormalizedFixture {
    const minutes = (this.now().getTime() - new Date(f.kickoff_at).getTime()) / 60000
    const h = hash(f.external_id)
    const finalHome = h % 4
    const finalAway = Math.floor(h / 7) % 3
    if (minutes < 0) return { ...f, status: 'scheduled', status_detail: 'NS', elapsed: null, home_goals: null, away_goals: null }
    if (minutes < 110) {
      const progress = Math.min(1, minutes / 95)
      return { ...f, status: 'live', status_detail: minutes < 47 ? '1H' : minutes < 62 ? 'HT' : '2H', elapsed: Math.min(90, Math.round(minutes > 62 ? minutes - 17 : minutes)), home_goals: Math.floor(finalHome * progress), away_goals: Math.floor(finalAway * progress) }
    }
    return { ...f, status: 'finished', status_detail: 'FT', elapsed: 90, home_goals: finalHome, away_goals: finalAway }
  }

  private all(): NormalizedFixture[] {
    const out: NormalizedFixture[] = []
    for (let d = -7; d <= 14; d++) for (let s = 0; s < 6; s++) out.push(this.fixtureFor(d, s))
    return out
  }

  async searchFixtures(q: FixtureSearch) {
    const team = q.team?.trim().toLowerCase()
    return this.all().filter((f) => {
      const day = f.kickoff_at.slice(0, 10)
      if (q.from && day < q.from) return false
      if (q.to && day > q.to) return false
      if (q.status && f.status !== q.status) return false
      if (team && !f.home.name.toLowerCase().includes(team) && !f.away.name.toLowerCase().includes(team)) return false
      return true
    })
  }

  async getFixturesByIds(ids: string[]) {
    const wanted = new Set(ids)
    return this.all().filter((f) => wanted.has(f.external_id))
  }

  async listCompetitions() {
    return [COMPETITION]
  }

  async status(): Promise<ProviderStatus> {
    return { provider: this.id, is_test_data: true, ok: true, plan: 'demostración', active: true, requests_today: null, requests_limit: null }
  }
}
