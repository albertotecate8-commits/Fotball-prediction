import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { rpc } from '@/services/rpc'
import { profileApi } from '@/services/profile'
import { qk } from '@/services/queryKeys'
import type { Profile } from '@/types/domain'

interface AuthState {
  session: Session | null
  loading: boolean
  profile: Profile | null
  profileLoading: boolean
  isAdmin: boolean
  recoveryMode: boolean
  clearRecovery: () => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [recoveryMode, setRecoveryMode] = useState(false)
  const qc = useQueryClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true)
      if (event === 'SIGNED_OUT') qc.clear()
    })
    return () => sub.subscription.unsubscribe()
  }, [qc])

  const uid = session?.user.id
  const profileQuery = useQuery({
    queryKey: qk.profile(uid ?? 'anon'),
    queryFn: () => profileApi.get(uid!),
    enabled: !!uid,
    staleTime: 60_000,
  })
  // El servidor decide quién administra (correo autorizado + rol); la UI solo lo refleja.
  const adminQuery = useQuery({
    queryKey: ['amIAdmin', uid ?? 'anon'],
    queryFn: () => rpc<boolean>('am_i_admin'),
    enabled: !!uid,
    staleTime: 60_000,
  })

  const value = useMemo<AuthState>(() => ({
    session,
    loading,
    profile: profileQuery.data ?? null,
    profileLoading: !!uid && (profileQuery.isLoading || adminQuery.isLoading),
    // Solo controla qué se MUESTRA; los permisos reales los valida el servidor.
    isAdmin: adminQuery.data === true,
    recoveryMode,
    clearRecovery: () => setRecoveryMode(false),
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }), [session, loading, profileQuery.data, profileQuery.isLoading, adminQuery.data, adminQuery.isLoading, uid, recoveryMode])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
