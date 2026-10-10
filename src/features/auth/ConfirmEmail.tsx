import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { CheckCircle2, MailWarning, RefreshCw } from 'lucide-react'
import type { EmailOtpType } from '@supabase/supabase-js'
import { authEmailClient, supabase } from '@/lib/supabase'
import { appUrl } from '@/lib/appUrl'
import { isValidEmail, normalizeEmail, toAppError } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { InlineError } from '@/components/ui/States'
import { Spinner } from '@/components/ui/Spinner'
import { AuthLayout } from './AuthLayout'

/** Ruta a la que vuelven los enlaces de confirmación (debe estar en las Redirect URLs de Supabase). */
export const CONFIRM_PATH = '/auth/confirmar'
export const confirmRedirect = () => appUrl(CONFIRM_PATH)

type State =
  | { kind: 'working' }
  | { kind: 'confirmed' }
  | { kind: 'error'; expired: boolean; detail: string }
  /** El enlace se abrió en otro navegador: no hay sesión aquí y no podemos afirmar el resultado. */
  | { kind: 'unknown' }

const EXPIRED = /otp_expired|expired|invalid|already|used/i

/**
 * Procesa el enlace del correo: código PKCE (?code=), enlace con token_hash
 * (?token_hash=&type=) o el error que devuelve Supabase (#error_code=...).
 * Solo muestra éxito si Supabase devuelve un usuario con el correo confirmado.
 */
export function ConfirmEmailPage() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ kind: 'working' })
  const once = useRef(false)

  useEffect(() => {
    if (once.current) return
    once.current = true
    const url = new URL(window.location.href)
    const q = url.searchParams
    const h = new URLSearchParams(url.hash.replace(/^#/, ''))
    const errCode = q.get('error_code') ?? h.get('error_code') ?? q.get('error') ?? h.get('error')
    const errDesc = q.get('error_description') ?? h.get('error_description') ?? ''
    const tokenHash = q.get('token_hash')
    const type = q.get('type') as EmailOtpType | null
    void (async () => {
      // Espera a que supabase-js termine de leer la URL (canje de ?code=) antes de limpiarla.
      const { data } = await supabase.auth.getSession()
      // El token o código nunca se queda en la barra de direcciones ni en el historial.
      window.history.replaceState(null, '', `${url.origin}${url.pathname}`)
      if (errCode) {
        setState({ kind: 'error', expired: EXPIRED.test(`${errCode} ${errDesc}`), detail: errDesc.replace(/\+/g, ' ') })
        return
      }
      // Enlace con la sesión en el fragmento (#access_token=…), p. ej. un reenvío hecho desde el servidor.
      const accessToken = h.get('access_token')
      const refreshToken = h.get('refresh_token')
      if (accessToken && refreshToken) {
        const { data: s, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
        if (error) return setState({ kind: 'error', expired: EXPIRED.test(error.message), detail: error.message })
        return setState(s.user?.email_confirmed_at ? { kind: 'confirmed' } : { kind: 'unknown' })
      }
      if (tokenHash && type) {
        const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
        if (error) return setState({ kind: 'error', expired: EXPIRED.test(error.message), detail: error.message })
        return setState(data.user?.email_confirmed_at ? { kind: 'confirmed' } : { kind: 'unknown' })
      }
      // ?code=: supabase-js ya lo canjeó al iniciar (detectSessionInUrl).
      if (data.session) {
        const { data: u } = await supabase.auth.getUser()
        return setState(u.user?.email_confirmed_at ? { kind: 'confirmed' } : { kind: 'unknown' })
      }
      setState({ kind: 'unknown' })
    })()
  }, [])

  if (state.kind === 'working') {
    return (
      <AuthLayout title="Confirmando" subtitle="Un momento…">
        <div className="flex justify-center py-6"><Spinner /></div>
      </AuthLayout>
    )
  }
  if (state.kind === 'confirmed') {
    return (
      <AuthLayout title="Correo confirmado" subtitle="Tu cuenta de SHABEX ya está activa.">
        <div className="card mb-4 flex items-center gap-3 p-4 text-sm" role="status"><CheckCircle2 className="size-6 shrink-0 text-success" /> Listo: ya puedes jugar tu quiniela.</div>
        <Button size="lg" block onClick={() => navigate('/', { replace: true })}>Entrar a SHABEX</Button>
      </AuthLayout>
    )
  }
  if (state.kind === 'error') {
    return (
      <AuthLayout title={state.expired ? 'Enlace caducado' : 'No se pudo confirmar'}
        subtitle={state.expired ? 'El enlace ya se usó o caducó. Pide uno nuevo: llega en unos minutos.' : 'Supabase no confirmó la cuenta con este enlace.'}
        footer={<Link to="/entrar" className="font-semibold text-aqua">Volver a entrar</Link>}>
        <div className="card mb-4 flex items-start gap-3 p-4 text-sm text-muted" role="alert"><MailWarning className="size-6 shrink-0 text-gold" /> {state.detail || 'El enlace no es válido.'}</div>
        <ResendConfirmation />
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title="Inicia sesión" subtitle="No pudimos comprobar la confirmación en este navegador."
      footer={<Link to="/entrar" className="font-semibold text-aqua">Ir a entrar</Link>}>
      <p className="mb-4 text-sm text-muted">Si el enlace era válido, tu correo ya quedó confirmado: entra con tu correo y contraseña. Si te vuelve a pedir confirmar, solicita un correo nuevo.</p>
      <ResendConfirmation />
    </AuthLayout>
  )
}

/** Reenvía el correo de confirmación con el enlace de producción. */
export function ResendConfirmation({ initialEmail = '' }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await authEmailClient.auth.resend({ type: 'signup', email: normalizeEmail(email), options: { emailRedirectTo: confirmRedirect() } })
    setLoading(false)
    if (error) return setError(toAppError(error))
    setSent(true)
  }
  if (sent) {
    return (
      <div className="card flex items-start gap-3 p-4 text-sm text-muted" role="status">
        <RefreshCw className="mt-0.5 size-5 shrink-0 text-aqua" />
        <span>Solicitud aceptada. Si la cuenta de {normalizeEmail(email)} está pendiente de confirmar, recibirás un correo nuevo en unos minutos. Usa el enlace más reciente: los anteriores dejan de servir.</span>
      </div>
    )
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3" noValidate aria-label="Reenviar confirmación">
      <Field label="Correo de la cuenta">{(id) => <Input id={id} type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
      <InlineError error={error} />
      <Button type="submit" variant="secondary" block loading={loading} disabled={loading || !isValidEmail(normalizeEmail(email))} icon={<RefreshCw className="size-4" />}>Reenviar correo de confirmación</Button>
    </form>
  )
}
