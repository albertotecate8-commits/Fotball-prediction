import { describe, expect, it } from 'vitest'
import { countdownTo, fromLocalInput, setServerOffset, serverNow, toLocalInput } from './time'

describe('zonas horarias', () => {
  it('convierte hora local de CDMX a UTC y de vuelta', () => {
    // CDMX no tiene horario de verano desde 2022: UTC-6 todo el año.
    expect(fromLocalInput('2026-10-12T19:00', 'America/Mexico_City')).toBe('2026-10-13T01:00:00.000Z')
    expect(toLocalInput('2026-10-13T01:00:00.000Z', 'America/Mexico_City')).toBe('2026-10-12T19:00')
  })
  it('rechaza formatos inválidos', () => {
    expect(fromLocalInput('12/10/2026 19:00')).toBeNull()
  })
})

describe('reloj del servidor', () => {
  it('corrige la hora del navegador con el desfase del servidor', () => {
    const now = Date.now()
    setServerOffset(new Date(now + 60_000).toISOString(), now, now)
    expect(Math.round((serverNow().getTime() - Date.now()) / 1000)).toBe(60)
    setServerOffset(new Date(now).toISOString(), now, now)
  })
  it('cuenta regresiva', () => {
    const c = countdownTo('2026-10-12T00:00:00Z', new Date('2026-10-10T22:58:30Z'))
    expect(c).toMatchObject({ days: 1, hours: 1, minutes: 1, seconds: 30 })
    expect(countdownTo('2020-01-01T00:00:00Z').totalSeconds).toBe(0)
  })
})
