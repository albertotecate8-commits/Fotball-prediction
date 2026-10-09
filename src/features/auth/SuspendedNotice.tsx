import { ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from './AuthProvider'

export function SuspendedNotice() {
  const { signOut } = useAuth()
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card max-w-sm p-6 text-center">
        <ShieldOff className="mx-auto mb-3 size-8 text-danger" />
        <h1 className="display text-2xl font-semibold uppercase">Cuenta suspendida</h1>
        <p className="mt-2 text-sm text-muted">Un administrador suspendió tu acceso. Contacta al organizador de tu grupo.</p>
        <Button variant="secondary" className="mt-5" onClick={() => void signOut()}>Cerrar sesión</Button>
      </div>
    </div>
  )
}
