import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MailPlus, Search, ShieldCheck, UserX, UserCheck } from 'lucide-react'
import { adminApi, type Participant } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAuth } from '@/features/auth/AuthProvider'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDate } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState, InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

const PAYMENT_LABEL = { not_applicable: 'No aplica', pending: 'Pendiente', authorized: 'Autorizado', rejected: 'Rechazado' } as const

export function AdminParticipants() {
  const qc = useQueryClient()
  const toast = useToast()
  const { profile } = useAuth()
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.admin.participants, queryFn: adminApi.participants })
  const groups = useQuery({ queryKey: qk.admin.groups, queryFn: adminApi.groups })
  const [search, setSearch] = useState('')
  const [inviteOpen, setInviteOpen] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] })
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { toast('Cambios guardados'); void refresh() },
    onError: (e) => toast(errorMessage(e), 'error'),
  })

  const list = useMemo(() => {
    const s = search.trim().toLowerCase()
    return (q.data ?? []).filter((p) => !s || p.display_name.toLowerCase().includes(s) || p.email.toLowerCase().includes(s))
  }, [q.data, search])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h1 className="display text-3xl font-semibold uppercase">Participantes</h1>
        <Button size="sm" icon={<MailPlus className="size-4" />} onClick={() => setInviteOpen(true)}>Invitar</Button>
      </div>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input aria-label="Buscar participante" placeholder="Buscar por alias o correo" className="pl-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.isLoading ? <CardSkeleton lines={5} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <EmptyState title="Sin participantes" description="Invita a tus amigos o comparte el código de un grupo." />
      ) : (
        <ul className="space-y-3">
          {list.map((p) => (
            <ParticipantRow key={p.user_id} p={p} isSelf={p.user_id === profile?.id} tz={timezone}
              groups={groups.data ?? []} busy={run.isPending}
              onRun={(fn) => run.mutate(fn)} />
          ))}
        </ul>
      )}
      <InviteSheet open={inviteOpen} onClose={() => setInviteOpen(false)} groups={groups.data ?? []} onDone={() => void refresh()} />
    </div>
  )
}

function ParticipantRow({ p, isSelf, tz, groups, busy, onRun }: {
  p: Participant; isSelf: boolean; tz: string; groups: { id: string; name: string }[]; busy: boolean; onRun: (fn: () => Promise<unknown>) => void
}) {
  const [addGroup, setAddGroup] = useState('')
  const missing = groups.filter((g) => !p.memberships.some((m) => m.group_id === g.id))
  return (
    <li className="card p-4">
      <div className="flex items-start gap-3">
        <Avatar name={p.display_name} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{p.display_name}</span>
            {p.role === 'admin' && <Badge tone="lime">Admin</Badge>}
            {p.status === 'suspended' && <Badge tone="danger">Suspendido</Badge>}
          </div>
          <p className="truncate text-xs text-muted">{p.email} · alta {formatDate(p.created_at, tz)}</p>
          <p className="text-xs text-muted">{p.rounds_submitted} quinielas enviadas · {p.total_points} pts</p>
        </div>
      </div>
      {p.memberships.length > 0 && (
        <ul className="mt-3 space-y-2">
          {p.memberships.map((m) => (
            <li key={m.group_id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-2/50 px-3 py-2 text-sm">
              <span className="flex-1 font-semibold">{m.group_name}</span>
              <Select aria-label={`Acceso a ${m.group_name}`} className="h-9 w-auto rounded-full px-3 text-xs" value={m.status} disabled={busy}
                onChange={(e) => onRun(() => adminApi.setMember(m.group_id, p.user_id, e.target.value as 'active'))}>
                <option value="pending">Pendiente</option><option value="active">Activo</option><option value="suspended">Suspendido</option>
              </Select>
              <Select aria-label={`Autorización en ${m.group_name}`} className="h-9 w-auto rounded-full px-3 text-xs" value={m.payment_status} disabled={busy}
                onChange={(e) => onRun(() => adminApi.setMember(m.group_id, p.user_id, m.status, e.target.value as 'pending'))}>
                {Object.entries(PAYMENT_LABEL).map(([v, l]) => <option key={v} value={v}>Autorización: {l}</option>)}
              </Select>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {missing.length > 0 && (
          <div className="flex items-center gap-2">
            <Select aria-label="Agregar a grupo" className="h-9 w-auto rounded-full px-3 text-xs" value={addGroup} onChange={(e) => setAddGroup(e.target.value)}>
              <option value="">Agregar a grupo…</option>
              {missing.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </Select>
            <Button size="sm" variant="secondary" disabled={!addGroup || busy} onClick={() => { onRun(() => adminApi.setMember(addGroup, p.user_id, 'active')); setAddGroup('') }}>Agregar</Button>
          </div>
        )}
        {!isSelf && (
          <>
            <Button size="sm" variant={p.status === 'active' ? 'danger' : 'secondary'} disabled={busy}
              icon={p.status === 'active' ? <UserX className="size-4" /> : <UserCheck className="size-4" />}
              onClick={() => onRun(() => adminApi.setUserStatus(p.user_id, p.status === 'active' ? 'suspended' : 'active'))}>
              {p.status === 'active' ? 'Suspender' : 'Reactivar'}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} icon={<ShieldCheck className="size-4" />}
              onClick={() => { if (confirm(p.role === 'admin' ? `¿Quitar permisos de admin a ${p.display_name}?` : `¿Dar permisos de admin a ${p.display_name}?`)) onRun(() => adminApi.setUserRole(p.user_id, p.role === 'admin' ? 'player' : 'admin')) }}>
              {p.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}
            </Button>
          </>
        )}
      </div>
    </li>
  )
}

function InviteSheet({ open, onClose, groups, onDone }: { open: boolean; onClose: () => void; groups: { id: string; name: string }[]; onDone: () => void }) {
  const toast = useToast()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [groupId, setGroupId] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const submit = async () => {
    setLoading(true)
    setError(null)
    try {
      await adminApi.invite(email, name, groupId || null)
      toast(`Invitación enviada a ${email}`)
      setEmail(''); setName('')
      onDone()
      onClose()
    } catch (e) {
      // Si ya tiene cuenta, basta con agregarlo al grupo.
      if ((e as { code?: string }).code === 'USER_ALREADY_EXISTS' && groupId) {
        try {
          await adminApi.addMemberByEmail(groupId, email)
          toast('Ya tenía cuenta: lo agregamos al grupo')
          onDone(); onClose()
          return
        } catch (e2) { setError(e2) }
      } else setError(e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Invitar participante"
      footer={<Button block size="lg" loading={loading} disabled={!email} onClick={() => void submit()}>Enviar invitación</Button>}>
      <div className="space-y-4">
        <Field label="Correo">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Alias (opcional)">{(id) => <Input id={id} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Grupo" hint="Quedará como miembro activo del grupo.">{(id) => (
          <Select id={id} value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">Sin grupo</option>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        )}</Field>
        <p className="text-xs text-muted">Las contraseñas nunca son visibles: el participante crea la suya desde el correo.</p>
        <InlineError error={error} />
      </div>
    </Sheet>
  )
}
