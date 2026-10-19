/* SHABEX — service worker.
 * Solo guarda en caché lo ESTÁTICO (código con hash, iconos, manifest) para que
 * la app abra rápido y funcione como aplicación instalada. Nunca toca los datos
 * deportivos ni de la cuenta: Supabase y las funciones van siempre a la red
 * (son de otro dominio y no se interceptan). Las páginas se piden primero a la
 * red; sin conexión se muestra la última versión de la app, y la propia app
 * indica cuándo se actualizaron los datos. */
const VERSION = 'shabex-v2'
const STATIC = `${VERSION}-static`
const SHELL = `${VERSION}-shell`
const scope = new URL(self.registration.scope)

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add(new Request(scope.href, { cache: 'reload' }))).catch(() => undefined).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const upgraded = (await caches.keys()).some((key) => !key.startsWith(VERSION))
    for (const key of await caches.keys()) if (!key.startsWith(VERSION)) await caches.delete(key)
    await self.clients.claim()
    // Versión nueva del service worker: las pantallas abiertas con la versión
    // anterior se recargan para no pedir archivos que ya no existen.
    if (upgraded) {
      for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => undefined)
    }
  })())
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // Otro dominio (Supabase, API, escudos): siempre directo a la red.
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res.ok) (await caches.open(SHELL)).put(scope.href, res.clone())
        return res
      } catch {
        return (await caches.match(scope.href)) || Response.error()
      }
    })())
    return
  }

  const path = url.pathname.slice(scope.pathname.length)
  // Archivos con hash: nunca cambian, se sirven de caché.
  if (path.startsWith('assets/')) {
    event.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      // Sin la caché HTTP: un 404 viejo guardado no debe repetirse.
      const res = await fetch(req, { cache: 'reload' })
      if (res.ok) (await caches.open(STATIC)).put(req, res.clone())
      return res
    })())
    return
  }
  // Iconos y manifest: de la red y, sin conexión, de caché.
  if (path.startsWith('icons/') || path === 'manifest.webmanifest' || path === 'favicon.svg') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req)
        if (res.ok) (await caches.open(STATIC)).put(req, res.clone())
        return res
      } catch {
        return (await caches.match(req)) || Response.error()
      }
    })())
  }
})
