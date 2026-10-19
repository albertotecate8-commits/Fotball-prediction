// Tras una actualización, los archivos de la versión anterior ya no existen:
// una pantalla abierta con la versión vieja falla al cargar otra sección.
// En ese caso se recarga una vez para tomar la versión nueva.
const KEY = 'shabex:stale-reload'

export function isStaleBuildError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically|Unable to preload CSS/i.test(msg)
}

/** Recarga una sola vez por minuto (evita un ciclo si el problema es otro). */
export function reloadForNewBuild(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0)
    if (Date.now() - last < 60_000) return false
    sessionStorage.setItem(KEY, String(Date.now()))
  } catch { /* sin almacenamiento: recarga igual */ }
  window.location.reload()
  return true
}
