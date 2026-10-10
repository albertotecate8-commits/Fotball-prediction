import { describe, expect, it } from 'vitest'
import { afterLive, diffUpdates, liveInterval, liveMinutesLeftToday, planTick, type PlanInput, type TrackedMatch } from './planner'
import type { NormalizedFixture } from './types'

// Datos ficticios: solo forma de partido, ningún equipo ni resultado real.
const NOW = Date.parse('2026-10-10T17:00:00Z')
const MIN = 60e3
const m = (id: string, kickoffMin: number, status = 'scheduled', extra: Partial<TrackedMatch> = {}): TrackedMatch => ({
  match_id: `m-${id}`, external_id: id, kickoff_at: new Date(NOW + kickoffMin * MIN).toISOString(), status,
  home_goals: null, away_goals: null, result_confirmed: false, ...extra,
})
const fresh = { '2026-10-09': NOW - 10 * MIN, '2026-10-10': NOW - 10 * MIN, '2026-10-11': NOW - 10 * MIN }
const base = (over: Partial<PlanInput> = {}): PlanInput => ({
  now: NOW, effective: 60, paused: false, tracked: [], featuredLive: 0, lastLiveAt: null, dayFetchedAt: fresh, liveRestricted: false, ...over,
})
const fx = (id: string, status: string, h: number | null, a: number | null, kickoffMin = -60): NormalizedFixture => ({
  external_id: id, kickoff_at: new Date(NOW + kickoffMin * MIN).toISOString(), status: status as never, status_detail: null, elapsed: null,
  home_goals: h, away_goals: a, competition: undefined, home: { external_id: 'h', name: 'Local', short_name: 'L' }, away: { external_id: 'a', name: 'Visita', short_name: 'V' },
})

describe('planificador de consultas', () => {
  it('sin partidos en juego y caché fresca: no consulta nada', () => {
    expect(planTick(base({ tracked: [m('1', 600)] })).actions).toEqual([])
  })

  it('partido en vivo: prioridad máxima con una sola consulta para todos', () => {
    const p = planTick(base({ tracked: [m('1', -30, 'live'), m('2', -10, 'live'), m('3', 600)] }))
    expect(p.actions[0]).toMatchObject({ kind: 'live', priority: 1 })
    expect(p.actions.filter((a) => a.kind === 'live')).toHaveLength(1)
  })

  it('respeta el intervalo en vivo: no repite antes de tiempo', () => {
    const tracked = [m('1', -30, 'live')]
    const interval = planTick(base({ tracked })).liveIntervalMin!
    expect(planTick(base({ tracked, lastLiveAt: NOW - (interval - 2) * MIN })).actions).toEqual([])
    expect(planTick(base({ tracked, lastLiveAt: NOW - interval * MIN })).actions[0]).toMatchObject({ kind: 'live' })
  })

  it('el saldo manda: con poca cuota el intervalo en vivo se alarga (4 a 20 min)', () => {
    expect(liveInterval(80, 120)).toBe(4)
    expect(liveInterval(20, 240)).toBe(15)
    expect(liveInterval(3, 240)).toBe(20)
    expect(liveInterval(200, 10)).toBe(4)
  })

  it('cuenta los minutos de juego que quedan hoy (día UTC) sin sumar dos veces partidos simultáneos', () => {
    expect(liveMinutesLeftToday([m('1', 0), m('2', 0)], NOW)).toBe(120)
    expect(liveMinutesLeftToday([m('1', 0), m('2', 60)], NOW)).toBe(180)
    // Un partido que empieza a las 23:00 UTC solo cuenta hasta medianoche (luego reinicia la cuota).
    expect(liveMinutesLeftToday([m('1', 6 * 60)], NOW)).toBe(60)
  })

  it('pausado o sin saldo: ninguna consulta (el cron no insiste)', () => {
    const tracked = [m('1', -30, 'live')]
    expect(planTick(base({ tracked, paused: true })).actions).toEqual([])
    expect(planTick(base({ tracked, effective: 0 })).actions).toEqual([])
  })

  it('poca cuota: solo en vivo; la importación del calendario espera', () => {
    const stale = { '2026-10-10': NOW - 13 * 3600e3, '2026-10-11': null }
    const tracked = [m('1', -30, 'live'), m('2', 90)]
    const low = planTick(base({ tracked, effective: 4, dayFetchedAt: stale }))
    expect(low.actions.map((a) => a.priority)).toEqual([1])
    const ok = planTick(base({ tracked, effective: 60, dayFetchedAt: stale }))
    expect(ok.actions.map((a) => a.kind === 'day' && a.priority)).toContain(3)
  })

  it('partido finalizado y confirmado: no genera consultas', () => {
    const done = m('1', -200, 'finished', { result_confirmed: true, home_goals: 1, away_goals: 0 })
    expect(planTick(base({ tracked: [done] })).actions).toEqual([])
  })

  it('final sin marcador confirmado: se consulta su día con prioridad 2 (máximo cada 20 min)', () => {
    const pending = m('1', -130, 'finished')
    const p = planTick(base({ tracked: [pending], dayFetchedAt: { ...fresh, '2026-10-10': NOW - 25 * MIN } }))
    expect(p.actions).toEqual([{ kind: 'day', date: '2026-10-10', priority: 2, reason: 'final sin marcador confirmado' }])
  })

  it('inicio próximo: revisa horario y estado cada 45-90 min (más espaciado con poca cuota)', () => {
    const soon = [m('1', 40)]
    expect(planTick(base({ tracked: soon, dayFetchedAt: { ...fresh, '2026-10-10': NOW - 50 * MIN } })).actions[0]).toMatchObject({ kind: 'day', priority: 2 })
    expect(planTick(base({ tracked: soon, effective: 20, dayFetchedAt: { ...fresh, '2026-10-10': NOW - 50 * MIN } })).actions).toEqual([])
  })

  it('calendario de hoy y mañana: cada 6 h; varios motivos del mismo día se agrupan en una sola consulta', () => {
    const p = planTick(base({ tracked: [m('1', 60), m('2', 90)], dayFetchedAt: { '2026-10-10': null, '2026-10-11': null } }))
    const days = p.actions.filter((a) => a.kind === 'day')
    expect(days.map((d) => d.kind === 'day' && d.date)).toEqual(['2026-10-10', '2026-10-11'])
    expect(days[0]!.priority).toBe(2)
  })

  it('destacados de Inicio en juego sin partidos de la quiniela: prioridad baja, cada 20 min', () => {
    const p = planTick(base({ featuredLive: 2 }))
    expect(p.actions[0]).toMatchObject({ kind: 'live', priority: 4 })
    expect(planTick(base({ featuredLive: 2, lastLiveAt: NOW - 10 * MIN })).actions).toEqual([])
    expect(planTick(base({ featuredLive: 2, effective: 15 })).actions).toEqual([])
  })

  it('plan sin consulta en vivo: usa el día de los partidos en juego', () => {
    const p = planTick(base({ tracked: [m('1', -30, 'live')], liveRestricted: true }))
    expect(p.actions[0]).toMatchObject({ kind: 'day', date: '2026-10-10', priority: 1 })
  })

  it('tras la consulta en vivo: el que ya no aparece se consulta para obtener su final', () => {
    const tracked = [m('1', -110, 'live'), m('2', -30, 'live')]
    expect(afterLive(tracked, new Set(['2']), { '2026-10-10': NOW - 30 * MIN }, NOW)).toEqual([
      { kind: 'day', date: '2026-10-10', priority: 1, reason: 'terminó: marcador final' },
    ])
    expect(afterLive(tracked, new Set(['1', '2']), {}, NOW)).toEqual([])
  })
})

describe('aplicación de respuestas', () => {
  it('una respuesta actualiza todos los partidos guardados de ese día y omite los que no cambiaron', () => {
    const tracked = [m('1', -60, 'live', { home_goals: 0, away_goals: 0 }), m('2', -60, 'scheduled'), m('3', 300)]
    const r = diffUpdates(tracked, [fx('1', 'live', 1, 0), fx('2', 'scheduled', null, null), fx('3', 'scheduled', null, null, 300), fx('99', 'live', 0, 0)])
    expect(r.updates.map((u) => u.match_id)).toEqual(['m-1'])
  })

  it('un final confirmado no retrocede a «en vivo» si el proveedor cambia de estado', () => {
    const tracked = [m('1', -200, 'finished', { result_confirmed: true, home_goals: 2, away_goals: 1 })]
    const r = diffUpdates(tracked, [fx('1', 'live', 2, 1)])
    expect(r.updates).toEqual([])
    expect(r.anomalies[0]).toMatch(/se conserva el final/)
  })
})
