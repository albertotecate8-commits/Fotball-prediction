import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { MailCheck } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { InlineError } from '@/components/ui/States'
import { toAppError } from '@/lib/errors'
import { appUrl } from '@/lib/appUrl'
import { AuthLayout } from './AuthLayout'
import { confirmRedirect, ResendConfirmation } from './ConfirmEmail'


export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setLoading(false)
    if (error) return setError(toAppError(error))
    navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true })
  }

  return (
    <AuthLayout title="Entrar" subtitle="Accede para hacer tu quiniela y ver cómo vas."
      footer={<>¿No tienes cuenta? <Link to="/registro" className="font-semibold text-aqua">Regístrate</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Correo">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Contraseña">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <div className="text-right"><Link to="/recuperar" className="text-sm text-muted hover:text-aqua">¿Olvidaste tu contraseña?</Link></div>
        <InlineError error={error} />
        <Button type="submit" size="lg" block loading={loading} disabled={!email || !password}>Entrar</Button>
      </form>
      {toAppError(error ?? '').code === 'Email not confirmed' && (
        <div className="mt-5 border-t border-line pt-4">
          <p className="mb-3 text-sm text-muted">¿No te llegó el correo o el enlace caducó? Pide uno nuevo. El enlace dura 1 hora.</p>
          <ResendConfirmation initialEmail={email.trim()} />
        </div>
      )}
    </AuthLayout>
  )
}

export function SignupPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const nameError = name && (name.trim().length < 2 || name.trim().length > 40) ? 'Entre 2 y 40 caracteres.' : null
  const pwError = password && password.length < 8 ? 'Mínimo 8 caracteres.' : null

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (nameError || pwError) return
    setLoading(true)
    setError(null)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(), password,
      options: { data: { display_name: name.trim() }, emailRedirectTo: confirmRedirect() },
    })
    setLoading(false)
    if (error) return setError(toAppError(error))
    if (!data.session) setSent(true)
  }

  if (sent) {
    return (
      <AuthLayout title="Revisa tu correo" subtitle={`Enviamos un enlace de confirmación a ${email}.`}
        footer={<Link to="/entrar" className="font-semibold text-aqua">Volver a entrar</Link>}>
        <div className="card mb-5 flex items-center gap-3 p-4 text-sm text-muted"><MailCheck className="size-6 shrink-0 text-aqua" /> Abre el enlace para activar tu cuenta. Caduca en 1 hora.</div>
        <ResendConfirmation initialEmail={email.trim()} />
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title="Crear cuenta" subtitle="Tu alias es lo que verán tus amigos en la clasificación."
      footer={<>¿Ya tienes cuenta? <Link to="/entrar" className="font-semibold text-aqua">Entrar</Link></>}>
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Alias" error={nameError}>{(id) => <Input id={id} autoComplete="nickname" maxLength={40} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Correo">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Contraseña" error={pwError} hint="Mínimo 8 caracteres.">{(id) => <Input id={id} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <InlineError error={error} />
        <Button type="submit" size="lg" block loading={loading} disabled={!name || !email || !password || !!nameError || !!pwError}>Crear cuenta</Button>
      </form>
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl('/restablecer') })
    setLoading(false)
    if (error) return setError(toAppError(error))
    setSent(true)
  }

  return (
    <AuthLayout title="Recuperar acceso" subtitle="Te enviaremos un enlace para crear una nueva contraseña."
      footer={<Link to="/entrar" className="font-semibold text-aqua">Volver a entrar</Link>}>
      {sent ? (
        <div className="card flex items-center gap-3 p-4 text-sm text-muted" role="status">
          <MailCheck className="size-6 shrink-0 text-aqua" /> Si existe una cuenta con {email}, recibirás el enlace en unos minutos.
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="Correo">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <InlineError error={error} />
          <Button type="submit" size="lg" block loading={loading} disabled={!email}>Enviar enlace</Button>
        </form>
      )}
    </AuthLayout>
  )
}
