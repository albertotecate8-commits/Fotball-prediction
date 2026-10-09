import { TZDate } from '@date-fns/tz'
import { differenceInSeconds, format } from 'date-fns'
import { es } from 'date-fns/locale'

export const DEFAULT_TZ = 'America/Mexico_City'

let serverOffsetMs = 0
/** Diferencia (servidor − navegador) medida al cargar y refrescada periódicamente. */
export function setServerOffset(serverIso: string, requestStartedAt: number, requestEndedAt: number) {
  const server = new Date(serverIso).getTime()
  const midpoint = (requestStartedAt + requestEndedAt) / 2
  serverOffsetMs = server - midpoint
}
export const serverNow = () => new Date(Date.now() + serverOffsetMs)
export const getServerOffset = () => serverOffsetMs

const inTz = (d: Date | string, tz: string) => new TZDate(new Date(d).getTime(), tz)

export const formatDateTime = (d: Date | string, tz = DEFAULT_TZ) => format(inTz(d, tz), "EEE d MMM · HH:mm", { locale: es })
export const formatDate = (d: Date | string, tz = DEFAULT_TZ) => format(inTz(d, tz), "d 'de' MMMM yyyy", { locale: es })
export const formatShortDate = (d: Date | string, tz = DEFAULT_TZ) => format(inTz(d, tz), 'EEE d MMM', { locale: es })
export const formatTime = (d: Date | string, tz = DEFAULT_TZ) => format(inTz(d, tz), 'HH:mm', { locale: es })
export const dayKey = (d: Date | string, tz = DEFAULT_TZ) => format(inTz(d, tz), 'yyyy-MM-dd')

/** Valor para <input type="datetime-local"> expresado en la zona oficial. */
export const toLocalInput = (d: Date | string | null | undefined, tz = DEFAULT_TZ) =>
  d ? format(inTz(d, tz), "yyyy-MM-dd'T'HH:mm") : ''

/** Convierte "2026-10-12T19:00" (hora en la zona oficial) a ISO UTC. */
export function fromLocalInput(value: string, tz = DEFAULT_TZ): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value)
  if (!m) return null
  const [, y, mo, d, h, mi] = m.map(Number) as number[]
  return new Date(new TZDate(y!, mo! - 1, d!, h!, mi!, 0, tz).getTime()).toISOString()
}

export interface CountdownParts { days: number; hours: number; minutes: number; seconds: number; totalSeconds: number }
export function countdownTo(target: Date | string, now: Date = serverNow()): CountdownParts {
  const total = Math.max(0, differenceInSeconds(new Date(target), now))
  return {
    totalSeconds: total,
    days: Math.floor(total / 86400),
    hours: Math.floor((total % 86400) / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  }
}
