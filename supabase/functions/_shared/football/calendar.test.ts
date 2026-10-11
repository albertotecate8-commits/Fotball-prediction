import { describe, expect, it } from 'vitest'
import { collectCalendar, toKickoff, utcDaysForWeek, type TsdbEvent } from './calendar'

// Eventos FICTICIOS con la forma de TheSportsDB.
const ev = (af: string, ts: string, h: string, a: string, extra: Partial<TsdbEvent> = {}): TsdbEvent => ({
  idAPIfootball: af, strTimestamp: ts, idHomeTeam: `t${h}`, idAwayTeam: `t${a}`, strHomeTeam: `Local ${h}`, strAwayTeam: `Visita ${a}`,
  strStatus: 'NS', intRound: '12', strSeason: '2026-2027', ...extra,
})
const week = { id: 'w', week_start: '2026-10-12', league_ids: ['262'], team_ids: ['529'], weekend_only: true }

describe('calendario adelantado', () => {
  it('consulta viernes a lunes UTC y normaliza horarios UTC', () => {
    expect(utcDaysForWeek(week)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'])
    expect(utcDaysForWeek({ ...week, weekend_only: false })).toHaveLength(8)
    expect(toKickoff('2026-10-17T01:00:00')).toBe('2026-10-17T01:00:00.000Z')
    expect(toKickoff('nada')).toBeNull()
  })

  it('une días y jornada, sin duplicados, solo con ids oficiales; equipos de La Liga solo si es el equipo seguido', async () => {
    const calls: string[] = []
    const byPath: Record<string, TsdbEvent[]> = {
      'eventsday.php?d=2026-10-17&l=4350': [ev('101', '2026-10-17T01:00:00', '1', '2'), ev('102', '2026-10-17T03:00:00', '3', '4')],
      'eventsround.php?id=4350&r=12&s=2026-2027': [ev('101', '2026-10-17T01:00:00', '1', '2'), ev('103', '2026-10-18T23:00:00', '5', '6'),
        ev('104', '2026-10-18T23:00:00', '7', '8', { strPostponed: 'yes' }), ev('', '2026-10-18T23:00:00', '9', '10'),
        ev('105', '2026-10-25T23:00:00', '11', '12')],
      'eventsday.php?d=2026-10-18&l=4335': [ev('201', '2026-10-18T19:00:00', '529', '99'), ev('202', '2026-10-18T19:00:00', '50', '51')],
    }
    const r = await collectCalendar([week], {
      getJson: async (p) => { calls.push(p); return { events: byPath[p] ?? null } },
      teamApiId: async (id) => (id === 't6' ? null : id.slice(1)),
    })
    expect(r.fixtures.map((f) => f.external_id).sort()).toEqual(['101', '102', '201'])
    expect(r.missingTeams).toBe(1) // 103: un equipo sin id de API-Football
    expect(r.fixtures.find((f) => f.external_id === '201')).toMatchObject({ competition: { external_id: '140' }, home: { external_id: '529' } })
    expect(calls.filter((c) => c.startsWith('eventsround'))).toEqual(['eventsround.php?id=4350&r=12&s=2026-2027'])
  })

  it('se detiene sin error cuando se acaba el presupuesto de solicitudes', async () => {
    let n = 0
    const r = await collectCalendar([week], { getJson: async () => (++n > 2 ? null : { events: [] }), teamApiId: async () => null })
    expect(r.stopped).toBe(true)
    expect(r.fixtures).toEqual([])
  })
})
