import { createClient } from '@supabase/supabase-js'
import { SUPABASE_PUBLIC } from '@/config/supabase.public'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_PUBLIC.url
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || SUPABASE_PUBLIC.publishableKey

export const isSupabaseConfigured = Boolean(url && key)

// Solo la clave PUBLICABLE vive en el navegador. La seguridad la imponen RLS
// y las funciones del servidor, no este cliente.
export const supabase = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})

/**
 * Cliente solo para pedir correos (confirmación y recuperación). Usa el flujo
 * «implicit»: el enlace trae la sesión en el fragmento (#access_token=…) y
 * funciona aunque el correo se abra en otro navegador (p. ej. la app de correo
 * del iPhone). Con PKCE el enlace solo sirve en el navegador que lo pidió.
 */
export const authEmailClient = createClient(url ?? 'http://localhost:54321', key ?? 'missing-key', {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, flowType: 'implicit', storageKey: 'sb-email-links' },
})

/** Si la URL trae una sesión en el fragmento, la activa en el cliente principal. */
export async function sessionFromHash(): Promise<{ handled: boolean; error: string | null; confirmed: boolean }> {
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  const err = h.get('error_description') ?? h.get('error_code') ?? h.get('error')
  if (err) return { handled: true, error: err.replace(/\+/g, ' '), confirmed: false }
  const access = h.get('access_token')
  const refresh = h.get('refresh_token')
  if (!access || !refresh) return { handled: false, error: null, confirmed: false }
  const { data, error } = await supabase.auth.setSession({ access_token: access, refresh_token: refresh })
  return { handled: true, error: error?.message ?? null, confirmed: !!data.user?.email_confirmed_at }
}
