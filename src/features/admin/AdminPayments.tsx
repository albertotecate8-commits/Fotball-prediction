import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { adminApi } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDate } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { PillTabs } from '@/components/ui/Tabs'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import type { PaymentStatus } from '@/types/domain'

const LABEL: Record<PaymentStatus, { l: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  authorized: { l: 'Pagado', tone: 'success' }, pending: { l: 'Pendiente', tone: 'warning' },
  rejected: { l: 'Rechazado', tone: 'danger' }, not_applicable: { l: 'Sin pago', tone: 'neutral' },
}
type Row = Awaited<ReturnType<typeof adminApi.paymentList>>[number]
type Tab = 'all' | 'paid' | 'unpaid'

/** Participantes con su estado de pago; confirmación manual auditada. */
export function AdminPayments() {
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: ['admin', 'paymentList'], queryFn: adminApi.paymentList })
  const groups = useQuery({ queryKey: qk.admin.groups, queryFn: adminApi.groups })
  const officialId = groups.data?.find((g) => g.is_default)?.id
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Row | null>(null)
  const rows = q.data ?? []
  const isPaid = (r: Row) => r.payment_status === 'authorized' && (!r.valid_until || Date.parse(r.valid_until) > Date.now())
  const list = rows
    .filter((r) => tab === 'all' || (tab === 'paid' ? isPaid(r) : !isPaid(r)))
    .filter((r) => { const s = search.trim().toLowerCase(); return !s || r.display_name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s) || r.reference.toLowerCase().includes(s) })

  return (
    <div>
      <h1 className="display mb-4 text-3xl font-semibold uppercase">Participantes y pagos</h1>
      <PillTabs label="Filtrar" value={tab} onChange={setTab} className="mb-3" options={[
        { value: 'all', label: 'Todos', count: rows.length },
        { value: 'paid', label: 'Pagados', count: rows.filter(isPaid).length },
        { value: 'unpaid', label: 'Sin pago', count: rows.filter((r) => !isPaid(r)).length },
      ]} />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input aria-label="Buscar" placeholder="Nombre, correo o referencia" className="pl-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.isLoading ? <CardSkeleton lines={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <EmptyState title="Sin resultados" description="No hay participantes en este filtro." />
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.user_id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{r.display_name}</div>
                  <div className="truncate text-xs text-muted">{r.email}</div>
                  <div className="mt-1 font-mono text-xs text-aqua">{r.reference}</div>
                </div>
                <Badge tone={LABEL[r.payment_status].tone}>{LABEL[r.payment_status].l}</Badge>
              </div>
              {r.payment_status === 'authorized' && (
                <p className="mt-2 text-xs text-muted">
                  {r.valid_until ? `Vence ${formatDate(r.valid_until, timezone)}` : 'Sin vencimiento'}
                  {r.payment_reference ? ` · Ref. ${r.payment_reference}` : ''}
                  {r.confirmed_by ? ` · confirmó ${r.confirmed_by}` : ''}{r.confirmed_at ? ` el ${formatDate(r.confirmed_at, timezone)}` : ''}
                </p>
              )}
              <Button size="sm" variant={isPaid(r) ? 'secondary' : 'primary'} className="mt-2" disabled={!officialId} onClick={() => setEditing(r)}>
                {isPaid(r) ? 'Cambiar pago' : 'Confirmar pago'}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {editing && officialId && <ConfirmSheet row={editing} groupId={officialId} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ConfirmSheet({ row, groupId, onClose }: { row: Row; groupId: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [status, setStatus] = useState<PaymentStatus>('authorized')
  const [reference, setReference] = useState(row.payment_reference ?? '')
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = reason.trim().length >= 5 && (status !== 'authorized' || reference.trim().length >= 3)
  const save = async () => {
    setBusy(true)
    try {
      await adminApi.setPayment(groupId, row.user_id, status, status === 'authorized' && until ? new Date(`${until}T23:59:59-06:00`).toISOString() : null, reference, reason)
      toast('Pago actualizado')
      await qc.invalidateQueries({ queryKey: ['admin'] })
      onClose()
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={onClose} title={`Pago de ${row.display_name}`}
      footer={<Button block size="lg" loading={busy} disabled={!valid} onClick={() => void save()}>Guardar</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Confirma solo pagos que hayas verificado en tu banco. Su referencia es <span className="font-mono text-aqua">{row.reference}</span>. El cambio queda registrado con tu nombre.</p>
        <Field label="Estado">{(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus)}>
            <option value="authorized">Pagado (puede enviar pronósticos)</option>
            <option value="pending">Pendiente</option>
            <option value="rejected">Rechazado</option>
            <option value="not_applicable">Sin pago</option>
          </Select>
        )}</Field>
        {status === 'authorized' && (
          <>
            <Field label="Referencia o folio de la transferencia">{(id) => <Input id={id} value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} />}</Field>
            <Field label="Vigente hasta (opcional)">{(id) => <Input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>
          </>
        )}
        <Field label="Motivo">{(id) => <Input id={id} value={reason} maxLength={200} placeholder="Ej. Transferencia verificada en banco" onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Sheet>
  )
}
