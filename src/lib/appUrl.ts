// URL absoluta dentro de la app, respetando la ruta base del despliegue
// (p. ej. /Fotball-prediction/ en GitHub Pages, / en Vercel).
export const appUrl = (path: string) =>
  `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
