import { useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut, Pencil, Shield } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from '@/features/groups/GroupProvider'
import { useRounds } from '@/features/rounds/useRounds'
import { profileApi } from '@/services/profile'
import { qk } from '@/services/queryKeys'
import { supabase } from '@/lib/supabase'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDate } from '@/lib/time'
import { brand } from '@/config/brand'
import { appUrl } from '@/lib/appUrl'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { RoundCard } from '@/components/RoundCard'
import { PaymentCard } from './PaymentCard'

export function ProfilePage() {
  const { profile, session, isAdmin, signOut } = useAuth()
  const { group } = useGroup()
  const { timezone } = useAppConfig()
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.display_name ?? '')
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const rounds = useRounds(group?.group_id)

  if (!profile || !session) return null
  const played = (rounds.data ?? []).filter((r) => r.my_status === 'submitted')

  const saveName = async () => {
    setSaving(true)
    setError(null)
    try {
      await profileApi.updateName(profile.id, name)
      await qc.invalidateQueries({ queryKey: qk.profile(profile.id) })
      setEditing(false)
      toast('Alias actualizado')
    } catch (e) {
      setError(e)
    } finally {
      setSaving(false)
    }
  }

  const resetPassword = async () => {
    const email = session.user.email
    if (!email) return
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: appUrl('/restablecer') })
    toast(error ? 'No se pudo enviar el correo' : `Enviamos un enlace a ${email}`, error ? 'error' : 'success')
  }

  return (
    <div>
      <PageHeader title="Mi perfil" />
      <section className="card mb-6 flex flex-col items-center gap-3 p-6 text-center">
        <Avatar name={profile.display_name} url={profile.avatar_url} size={84} className="border-2 border-aqua/60" />
        {editing ? (
          <div className="w-full max-w-xs space-y-2">
            <Input aria-label="Alias" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
            <InlineError error={error} />
            <div className="flex gap-2">
              <Button variant="secondary" className="flex-1" onClick={() => { setEditing(false); setName(profile.display_name) }}>Cancelar</Button>
              <Button className="flex-1" loading={saving} disabled={name.trim().length < 2} onClick={() => void saveName()}>Guardar</Button>
            </div>
          </div>
        ) : (
          <div>
            <h2 className="display flex items-center justify-center gap-2 text-2xl font-semibold uppercase">
              {profile.display_name}
              <button type="button" onClick={() => setEditing(true)} aria-label="Editar alias" className="grid size-8 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-aqua"><Pencil className="size-4" /></button>
            </h2>
            <p className="text-sm text-muted">Miembro desde {formatDate(profile.created_at, timezone)}</p>
            {isAdmin && <Badge tone="accent" className="mt-2">Administrador</Badge>}
          </div>
        )}
      </section>

      <PaymentCard />

      {played.length > 0 && (
        <>
          <SectionTitle>Mis pronósticos</SectionTitle>
          <div className="space-y-3">{played.map((r) => <RoundCard key={r.round_id} round={r} tz={timezone} hrefOverride={`/quinielas/${r.round_id}`} />)}</div>
        </>
      )}

      <SectionTitle>Cuenta</SectionTitle>
      <div className="card divide-y divide-line">
        <div className="px-4 py-3 text-sm"><span className="text-muted">Correo:</span> {session.user.email}</div>
        {isAdmin && (
          <Link to="/admin" className="flex items-center gap-3 px-4 py-3 text-sm font-semibold hover:bg-white/5"><Shield className="size-4 text-aqua" /> Panel de administración</Link>
        )}
        <button type="button" onClick={() => void resetPassword()} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold hover:bg-white/5">
          <KeyRound className="size-4 text-muted" /> Cambiar contraseña por correo
        </button>
        <button type="button" onClick={() => void signOut()} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm font-semibold text-danger hover:bg-danger/10">
          <LogOut className="size-4" /> Cerrar sesión
        </button>
      </div>
      <p className="mt-6 text-center text-[11px] text-faint">{brand.name} · {brand.legalNotice}</p>
    </div>
  )
}
