import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Users, Hourglass, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from './GroupProvider'

export function JoinGroupCard() {
  const qc = useQueryClient()
  const toast = useToast()
  const { groups } = useGroup()
  const { session, isAdmin } = useAuth()
  const [code, setCode] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const pending = groups.filter((g) => g.member_status === 'pending')

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const r = await playerApi.joinGroup(code)
      toast(r.status === 'active' ? `Te uniste a ${r.name}` : `Solicitud enviada a ${r.name}`)
      setCode('')
      await qc.invalidateQueries({ queryKey: qk.groups })
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }

  const claimAdmin = async () => {
    try {
      const ok = await playerApi.claimFirstAdmin()
      if (ok) {
        toast('Ahora eres administrador')
        await qc.invalidateQueries({ queryKey: qk.profile(session!.user.id) })
      } else {
        toast('Ya existe un administrador. Pídele que te agregue a un grupo.', 'error')
      }
    } catch (err) {
      setError(err)
    }
  }

  return (
    <div className="space-y-4">
      {pending.map((g) => (
        <div key={g.group_id} className="card flex items-center gap-3 p-4">
          <Hourglass className="size-6 shrink-0 text-lime" />
          <div className="text-sm"><span className="font-semibold">{g.name}</span><p className="text-muted">Tu solicitud está pendiente de aprobación por el administrador.</p></div>
        </div>
      ))}
      <form onSubmit={onSubmit} className="card space-y-4 p-5">
        <div className="flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-full bg-lime/15 text-lime"><Users className="size-5" /></span>
          <div>
            <h2 className="display text-xl font-semibold uppercase">Únete a un grupo</h2>
            <p className="text-sm text-muted">Pide el código de invitación al organizador.</p>
          </div>
        </div>
        <Input aria-label="Código de invitación" placeholder="Ej. K7P2QX9M" value={code} maxLength={12}
          onChange={(e) => setCode(e.target.value.toUpperCase())} className="text-center font-mono text-lg tracking-[0.3em]" />
        <InlineError error={error} />
        <Button type="submit" block loading={loading} disabled={code.trim().length < 6}>Unirme</Button>
      </form>
      {!isAdmin && (
        <button type="button" onClick={() => void claimAdmin()} className="mx-auto flex items-center gap-2 text-xs text-muted hover:text-lime">
          <ShieldCheck className="size-3.5" /> ¿Eres el organizador y es la primera vez? Activar administración
        </button>
      )}
    </div>
  )
}
