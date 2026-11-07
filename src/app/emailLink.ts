// Enlaces de los correos (recuperar contraseña, confirmar cuenta) que llegan a
// otra página: si la dirección de regreso no está permitida en el servidor de
// cuentas, el correo manda a la página principal con la sesión en el fragmento
// (#access_token=…&type=recovery) y ahí nadie la procesaba. Se llevan a la
// pantalla que sí la procesa, con el fragmento intacto.
const CONFIRM_TYPES = new Set(['signup', 'email', 'invite', 'magiclink', 'email_change'])

export function emailLinkTarget(pathname: string, search: string, hash: string, base = '/'): string | null {
  const h = new URLSearchParams(hash.replace(/^#/, ''))
  const type = h.get('type')
  const root = base.replace(/\/$/, '')
  const path = (root && pathname.startsWith(root) ? pathname.slice(root.length) : pathname) || '/'
  let target: string | null = null
  if (type === 'recovery') target = '/restablecer'
  else if (type && CONFIRM_TYPES.has(type) && h.get('access_token')) target = '/auth/confirmar'
  if (!target || path === target) return null
  return `${root}${target}${search}${hash}`
}

/** Se ejecuta al importar: antes de que el enrutador lea la dirección. */
export function routeEmailLinkNow() {
  if (typeof window === 'undefined') return
  const t = emailLinkTarget(window.location.pathname, window.location.search, window.location.hash, import.meta.env.BASE_URL)
  if (t) window.history.replaceState(null, '', t)
}
