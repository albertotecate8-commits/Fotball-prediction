import { describe, expect, it } from 'vitest'
import { collectCalendar, toKickoff, utcDaysForWeek, type TsdbEvent } from './calendar'

// Eventos FICTICIOS con la forma de TheSportsDB.
const ev = (af: string, ts: string, h: string, a: string, extra: Partial<TsdbEvent> = {}): TsdbEvent => ({
  idAPIfootball: af, strTimestamp: ts, idHomeTeam: `t${h}`, idAwayTeam: `t${a}`, strHomeTeam: `Local ${h}`, strAwayTeam: `Visita ${a}`,
  strStatus: 'NS', intRound: '12', strSeason: '2026-2027', ...extra,
})
const week = { id: 'w', week_start: '2026-10-12', league_ids: ['262'], team_ids: ['529'], weekend_only: true, teams: [{ af: '529', tsdb: '133739', tsdb_league: '4335' }] }

describe('calendario adelantado', () => {
  it('consulta viernes a lunes UTC y normaliza horarios UTC', () => {
    expect(utcDaysForWeek(week)).toEqual(['2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19'])
    expect(utcDaysForWeek({ ...week, weekend_only: false })).toHaveLength(8)
    expect(toKickoff('2026-10-17T01:00:00')).toBe('2026-10-17T01:00:00.000Z')
    expect(toKickoff('nada')).toBeNull()
  })

  it('une días y jornada, sin duplicados, solo con ids oficiales; equipos seguidos por su próximo partido', async () => {
    const calls: string[] = []
    const byPath: Record<string, TsdbEvent[]> = {
      // Primero el equipo seguido: su próximo partido (y el siguiente, fuera de la semana).
      'eventsnext.php?id=133739': [ev('201', '2026-10-18T19:00:00', '529', '99', { idLeague: '4335' }), ev('203', '2026-10-25T19:00:00', '98', '529', { idLeague: '4335' })],
      'eventsday.php?d=2026-10-17&l=4350': [ev('101', '2026-10-17T01:00:00', '1', '2'), ev('102', '2026-10-17T03:00:00', '3', '4')],
      'eventsround.php?id=4350&r=12&s=2026-2027': [ev('101', '2026-10-17T01:00:00', '1', '2'), ev('103', '2026-10-18T23:00:00', '5', '6'),
        ev('104', '2026-10-18T23:00:00', '7', '8', { strPostponed: 'yes' }), ev('', '2026-10-18T23:00:00', '9', '10'),
        ev('105', '2026-10-25T23:00:00', '11', '12')],
    }
    const r = await collectCalendar([week], {
      getJson: async (p) => { calls.push(p); return { events: byPath[p] ?? null } },
      teamApiId: async (id) => (id === 't6' ? null : id.slice(1)),
    })
    expect(r.fixtures.map((f) => f.external_id).sort()).toEqual(['101', '102', '201'])
    expect(r.missingTeams).toBe(1) // 103: un equipo sin id de API-Football
    expect(r.fixtures.find((f) => f.external_id === '201')).toMatchObject({ competition: { external_id: '140' }, home: { external_id: '529' } })
    // El equipo seguido se busca primero y ya no hace falta recorrer toda La Liga.
    expect(calls[0]).toBe('eventsnext.php?id=133739')
    expect(calls.some((c) => c.includes('l=4335') || c.includes('id=4335'))).toBe(false)
  })

  it('el equipo seguido entra aunque la liga agote el tope de solicitudes', async () => {
    let n = 0
    const r = await collectCalendar([{ ...week, teams: [{ af: '529', tsdb: '133739', tsdb_league: '4335' }, { af: '541', tsdb: '133738', tsdb_league: '4335' }] , team_ids: ['529', '541'] }], {
      getJson: async (p) => {
        if (++n > 3) return null
        if (p === 'eventsnext.php?id=133739') return { events: [ev('301', '2026-10-18T19:00:00', '529', '90', { idLeague: '4335' })] }
        if (p === 'eventsnext.php?id=133738') return { events: [ev('302', '2026-10-17T19:00:00', '91', '541', { idLeague: '4335' })] }
        return { events: [] }
      },
      teamApiId: async (id) => id.slice(1),
    })
    expect(r.fixtures.map((f) => f.external_id).sort()).toEqual(['301', '302'])
    expect(r.stopped).toBe(true)
  })

  it('se detiene sin error cuando se acaba el presupuesto de solicitudes', async () => {
    let n = 0
    const r = await collectCalendar([week], { getJson: async () => (++n > 2 ? null : { events: [] }), teamApiId: async () => null })
    expect(r.stopped).toBe(true)
    expect(r.fixtures).toEqual([])
  })
})
