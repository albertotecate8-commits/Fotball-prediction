// Archivo de una versión anterior de la app que ya no existe (se pidió desde
// una pantalla abierta antes de una actualización). Se recarga para tomar la
// versión nueva; como máximo una vez cada 30 s para no entrar en ciclo.
try {
  const k = 'shabex:stale-asset'
  const last = Number(sessionStorage.getItem(k) || 0)
  if (Date.now() - last > 30000) { sessionStorage.setItem(k, String(Date.now())); location.reload() }
} catch (e) { location.reload() }
