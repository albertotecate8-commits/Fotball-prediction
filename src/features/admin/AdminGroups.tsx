import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus, RefreshCw } from 'lucide-react'
import { adminApi, type AdminGroup } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { errorMessage } from '@/lib/errors'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState, InlineError } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

export function AdminGroups() {
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: qk.admin.groups, queryFn: adminApi.groups })
  const [editing, setEditing] = useState<AdminGroup | 'new' | null>(null)

  const regenerate = async (g: AdminGroup) => {
    if (!confirm('El código anterior dejará de funcionar. ¿Continuar?')) return
    try {
      await adminApi.regenerateCode(g.id)
      await qc.invalidateQueries({ queryKey: qk.admin.groups })
      toast('Código regenerado')
    } catch (e) { toast(errorMessage(e), 'error') }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="display text-3xl font-semibold uppercase">Grupos</h1>
        <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEditing('new')}>Nuevo grupo</Button>
      </div>
      {q.isLoading ? <CardSkeleton /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (q.data ?? []).length === 0 ? (
        <EmptyState title="Crea tu primer grupo" description="Los jugadores se unen con el código de invitación del grupo." action={<Button onClick={() => setEditing('new')}>Crear grupo</Button>} />
      ) : (
        <ul className="space-y-3">
          {q.data!.map((g) => (
            <li key={g.id} className="card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="display text-xl font-semibold uppercase">{g.name}</span>
                    {!g.is_active && <Badge tone="danger">Inactivo</Badge>}
                  </div>
                  {g.description && <p className="text-sm text-muted">{g.description}</p>}
                  <p className="mt-1 text-xs text-muted">{g.join_requires_approval ? 'Requiere aprobación del admin' : 'Acceso directo con código'}</p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditing(g)}>Editar</Button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-2/50 p-3">
                <span className="text-xs text-muted">Código</span>
                <code className="flex-1 font-mono text-lg tracking-[0.25em] text-lime">{g.invite_code}</code>
                <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => { void navigator.clipboard?.writeText(g.invite_code); toast('Código copiado') }}>Copiar</Button>
                <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void regenerate(g)}>Regenerar</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {editing && <GroupSheet group={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function GroupSheet({ group, onClose }: { group: AdminGroup | null; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [name, setName] = useState(group?.name ?? '')
  const [description, setDescription] = useState(group?.description ?? '')
  const [approval, setApproval] = useState(group?.join_requires_approval ?? true)
  const [active, setActive] = useState(group?.is_active ?? true)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)

  const save = async () => {
    setLoading(true)
    try {
      await adminApi.saveGroup({ id: group?.id ?? null, name, description, join_requires_approval: approval, is_active: active })
      await qc.invalidateQueries()
      toast(group ? 'Grupo actualizado' : 'Grupo creado')
      onClose()
    } catch (e) { setError(e) } finally { setLoading(false) }
  }

  return (
    <Sheet open onClose={onClose} title={group ? 'Editar grupo' : 'Nuevo grupo'}
      footer={<Button block size="lg" loading={loading} disabled={name.trim().length < 2} onClick={() => void save()}>Guardar</Button>}>
      <div className="space-y-4">
        <Field label="Nombre">{(id) => <Input id={id} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Descripción">{(id) => <Textarea id={id} maxLength={280} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-[var(--color-lime)]" checked={approval} onChange={(e) => setApproval(e.target.checked)} /> Aprobar manualmente a quien se une con el código</label>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" className="size-5 accent-[var(--color-lime)]" checked={active} onChange={(e) => setActive(e.target.checked)} /> Grupo activo</label>
        <InlineError error={error} />
      </div>
    </Sheet>
  )
}
