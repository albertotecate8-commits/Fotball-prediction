import { useEffect, useState } from 'react'
import { playerApi } from '@/services/player'
import { serverNow, setServerOffset } from '@/lib/time'

/** Sincroniza el desfase con el reloj del servidor al montar y cada 5 min. */
export function useServerClockSync(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const sync = async () => {
      const t0 = Date.now()
      try {
        const iso = await playerApi.serverTime()
        if (!cancelled) setServerOffset(iso, t0, Date.now())
      } catch {
        /* sin conexión: se conserva el último desfase conocido */
      }
    }
    void sync()
    const id = setInterval(sync, 5 * 60_000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [enabled])
}

/** Hora del servidor que se actualiza cada `intervalMs`. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
