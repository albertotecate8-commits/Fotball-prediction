// Configuración PÚBLICA del proyecto Supabase (URL y clave publicable).
// No son secretos: la seguridad la imponen RLS y las funciones del servidor.
// Las variables VITE_SUPABASE_* tienen prioridad si están definidas.
export const SUPABASE_PUBLIC = {
  url: 'https://tmkxvhjynbhwrhvzrsfv.supabase.co',
  publishableKey: 'sb_publishable_RoG2VUMNzU9XvLwi5JA-Ew_8Z91Uc7t',
} as const
