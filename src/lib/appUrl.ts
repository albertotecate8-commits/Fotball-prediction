// URL absoluta dentro de la app, respetando la ruta base del despliegue
// (p. ej. /Fotball-prediction/ en GitHub Pages).
// En producción los enlaces que viajan por correo (confirmación, recuperación)
// usan SIEMPRE la URL pública, nunca localhost ni el origen de una prueba local.
export const PUBLIC_SITE_URL = ((import.meta.env.VITE_PUBLIC_SITE_URL as string | undefined)
  || (import.meta.env.PROD ? 'https://albertotecate8-commits.github.io/Fotball-prediction' : '')).replace(/\/$/, '')

export const appUrl = (path: string) => {
  const p = path.startsWith('/') ? path : `/${path}`
  if (PUBLIC_SITE_URL) return `${PUBLIC_SITE_URL}${p}`
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${p}`
}
