import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Plus } from 'lucide-react'
import { adminApi } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDateTime, fromLocalInput } from '@/lib/time'
import { Badge, type Tone } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState, InlineError } from '@/components/ui/States'
import type { RoundStatus } from '@/types/domain'

export const ROUND_STATUS: Record<RoundStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Borrador', tone: 'neutral' },
  open: { label: 'Abierta', tone: 'lime' },
  closed: { label: 'Cerrada', tone: 'warning' },
  finished: { label: 'Finalizada', tone: 'success' },
  under_review: { label: 'En revisión', tone: 'warning' },
}

export function AdminRounds() {
  const { timezone } = useAppConfig()
  const [params, setParams] = useSearchParams()
  const q = useQuery({ queryKey: qk.admin.rounds, queryFn: adminApi.rounds })
  const [creating, setCreating] = useState(params.get('nueva') === '1')
  useEffect(() => { if (params.get('nueva')) setParams({}, { replace: true }) }, [params, setParams])

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="display text-3xl font-semibold uppercase">Jornadas</h1>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Nueva</Button>
      </div>
      {q.isLoading ? <CardSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (q.data ?? []).length === 0 ? (
        <EmptyState title="Sin jornadas" description="Crea una jornada, selecciona los partidos y ábrela para que los jugadores participen." action={<Button onClick={() => setCreating(true)}>Crear jornada</Button>} />
      ) : (
        <ul className="space-y-3">
          {q.data!.map((r) => (
            <li key={r.id}>
              <Link to={`/admin/jornadas/${r.id}`} className="card flex items-center gap-3 p-4 transition hover:border-lime/40">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <Badge tone={ROUND_STATUS[r.status].tone}>{ROUND_STATUS[r.status].label}</Badge>
                    <span className="text-xs text-muted">{r.group?.name}</span>
                  </div>
                  <div className="display truncate text-xl font-semibold uppercase">{r.name}</div>
                  <div className="text-xs text-muted"><span className="capitalize">Cierre {formatDateTime(r.deadline_at, timezone)}</span> · {r.round_matches[0]?.count ?? 0} partidos</div>
                </div>
                <ChevronRight className="size-5 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      )}
      {creating && <CreateRoundSheet onClose={() => setCreating(false)} />}
    </div>
  )
}

function CreateRoundSheet({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { timezone } = useAppConfig()
  const groups = useQuery({ queryKey: qk.admin.groups, queryFn: adminApi.groups })
  const [groupId, setGroupId] = useState('')
  const [name, setName] = useState('')
  const [deadline, setDeadline] = useState('')
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const gid = groupId || groups.data?.[0]?.id || ''

  const create = async () => {
    const deadlineIso = fromLocalInput(deadline, timezone)
    if (!deadlineIso) return setError(new Error('DEADLINE_REQUIRED'))
    setLoading(true)
    try {
      const id = await adminApi.saveRound({ id: null, group_id: gid, name, description: '', opens_at: null, deadline_at: deadlineIso, participation: 'all_members' })
      navigate(`/admin/jornadas/${id}`)
    } catch (e) { setError(e) } finally { setLoading(false) }
  }

  return (
    <Sheet open onClose={onClose} title="Nueva jornada"
      footer={<Button block size="lg" loading={loading} disabled={!gid || name.trim().length < 2 || !deadline} onClick={() => void create()}>Crear borrador</Button>}>
      <div className="space-y-4">
        {groups.data?.length === 0 && <p className="text-sm text-danger">Primero crea un grupo.</p>}
        <Field label="Grupo">{(id) => (
          <Select id={id} value={gid} onChange={(e) => setGroupId(e.target.value)}>
            {(groups.data ?? []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        )}</Field>
        <Field label="Nombre">{(id) => <Input id={id} placeholder="Jornada 1" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Fecha límite" hint={`Hora de ${timezone}. Debe ser anterior al primer partido.`}>{(id) => (
          <Input id={id} type="datetime-local" value={deadline} onChange={(e) => setDeadline(e.target.value)} />
        )}</Field>
        <InlineError error={error} />
      </div>
    </Sheet>
  )
}
