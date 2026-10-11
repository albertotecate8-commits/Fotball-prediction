// «Vista participante» del administrador: solo recuerda, en esta pestaña, que el
// admin quiere ver la app como jugador. No da ni quita permisos (eso lo decide el servidor).
const KEY = 'shabex.adminPreview'

export function isAdminPreview(): boolean {
  try { return sessionStorage.getItem(KEY) === '1' } catch { return false }
}
export function setAdminPreview(on: boolean) {
  try {
    if (on) sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch { /* sin almacenamiento: el panel sigue funcionando */ }
}
