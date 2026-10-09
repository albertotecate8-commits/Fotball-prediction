import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { InlineError } from '@/components/ui/States'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useToast } from '@/components/ui/Toast'
import { toAppError } from '@/lib/errors'
import { useAuth } from './AuthProvider'
import { AuthLayout } from './AuthLayout'

export function ResetPasswordPage() {
  const { session, loading: authLoading, clearRecovery } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  if (authLoading) return <FullPageSpinner />
  if (!session) {
    return (
      <AuthLayout title="Enlace no válido" subtitle="El enlace expiró o ya se usó. Solicita uno nuevo.">
        <Button size="lg" block onClick={() => navigate('/recuperar')}>Solicitar otro enlace</Button>
      </AuthLayout>
    )
  }

  const mismatch = confirm.length > 0 && confirm !== password
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (password.length < 8 || mismatch) return
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (error) return setError(toAppError(error))
    clearRecovery()
    toast('Contraseña actualizada')
    navigate('/', { replace: true })
  }

  return (
    <AuthLayout title="Nueva contraseña" subtitle="Elige una contraseña segura.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Contraseña" hint="Mínimo 8 caracteres.">{(id) => <Input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <Field label="Confirmar" error={mismatch ? 'No coincide.' : null}>{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}</Field>
        <InlineError error={error} />
        <Button type="submit" size="lg" block loading={loading} disabled={password.length < 8 || mismatch || !confirm}>Guardar</Button>
      </form>
    </AuthLayout>
  )
}
