import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '@/features/auth/AuthProvider'
import { GroupProvider } from '@/features/groups/GroupProvider'
import { FullPageSpinner } from '@/components/ui/Spinner'
import { useServerClockSync } from '@/hooks/useServerClock'
import { SuspendedNotice } from '@/features/auth/SuspendedNotice'

export function RequireAuth() {
  const { session, loading, profile, profileLoading, recoveryMode } = useAuth()
  const location = useLocation()
  useServerClockSync(!!session)
  if (loading || profileLoading) return <FullPageSpinner />
  if (!session) return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  if (recoveryMode) return <Navigate to="/restablecer" replace />
  if (profile?.status === 'suspended') return <SuspendedNotice />
  return (
    <GroupProvider>
      <Outlet />
    </GroupProvider>
  )
}

/** Solo oculta la interfaz; el servidor rechaza cualquier acción no autorizada. */
export function RequireAdmin() {
  const { isAdmin, profileLoading } = useAuth()
  if (profileLoading) return <FullPageSpinner />
  if (!isAdmin) return <Navigate to="/" replace />
  return <Outlet />
}

export function PublicOnly() {
  const { session, loading, recoveryMode } = useAuth()
  if (loading) return <FullPageSpinner />
  if (session && !recoveryMode) return <Navigate to="/" replace />
  return <Outlet />
}
