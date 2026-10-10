// URL absoluta dentro de la app, respetando la ruta base del despliegue
// (p. ej. /Fotball-prediction/ en GitHub Pages, / en Vercel).
// Los enlaces que viajan por correo (confirmación, recuperación) usan SIEMPRE una
// dirección pública: la configurada, o el dominio público desde el que se usa la
// app (GitHub Pages o Vercel). Nunca localhost en producción.
const GITHUB_PAGES = 'https://albertotecate8-commits.github.io/Fotball-prediction'
const isLocal = (host: string) => /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(host)

export function publicSiteUrl(): string {
  const configured = (import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)?.replace(/\/$/, '')
  if (configured) return configured
  if (!import.meta.env.PROD) return ''
  return isLocal(window.location.hostname) ? GITHUB_PAGES : `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}`
}

export const appUrl = (path: string) => {
  const p = path.startsWith('/') ? path : `/${path}`
  const site = publicSiteUrl()
  if (site) return `${site}${p}`
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${p}`
}
