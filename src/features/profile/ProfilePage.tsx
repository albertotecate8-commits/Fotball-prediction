import { useState } from 'react'
import { Link } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { KeyRound, LogOut, Pencil, Shield } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthProvider'
import { useQuery } from '@tanstack/react-query'
import { playerApi } from '@/services/player'
import { profileApi } from '@/services/profile'
import { qk } from '@/services/queryKeys'
import { authEmailClient } from '@/lib/supabase'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDate } from '@/lib/time'
import { brand } from '@/config/brand'
import { appUrl } from '@/lib/appUrl'
import { PageHeader, SectionTitle } from '@/components/PageHeader'
import { InstallCard } from '@/features/install/InstallCard'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { TeamCrest } from '@/components/TeamCrest'
import { formatShortDate } from '@/lib/time'
import { PaymentCard } from './PaymentCard'

export function ProfilePage() {
  const { profile, session, isAdmin, signOut } = useAuth()
  const { timezone } = useAppConfig()
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.display_name ?? '')
  const [error, setError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const pool = useQuery({ queryKey: qk.pool, queryFn: playerApi.pool })

  if (!profile || !session) return null
  const played = (pool.data?.matches ?? []).filter((m) => m.pick).slice().reverse().slice(0, 15)

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
    const { error } = await authEmailClient.auth.resetPasswordForEmail(email, { redirectTo: appUrl('/restablecer') })
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
      <div className="mb-6"><InstallCard variant="profile" /></div>

      {played.length > 0 && (
        <>
          <SectionTitle>Mis pronósticos</SectionTitle>
          <ul className="card divide-y divide-line">
            {played.map((m) => (
              <li key={m.match_id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                <TeamCrest team={m.home} size={20} />
                <span className="min-w-0 flex-1 truncate">{m.home.short_name} vs {m.away.short_name}
                  <span className="block text-[11px] capitalize text-muted">{formatShortDate(m.kickoff_at, timezone)} · {m.pick!.status === 'submitted' ? 'enviado' : 'guardado sin enviar'}</span>
                </span>
                <span className="scoreline text-base">{m.pick!.home !== null ? `${m.pick!.home}-${m.pick!.away}` : m.pick!.outcome}</span>
                {m.score && <span className="scoreline w-10 text-right text-base text-aqua">+{m.score.points}</span>}
              </li>
            ))}
          </ul>
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
      <p className="mt-10 pb-2 text-center text-[9px] leading-snug text-faint/80">{brand.legalNotice}</p>
    </div>
  )
}
