import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Landmark, Search } from 'lucide-react'
import { adminApi, type PaymentRow, type PaymentState } from '@/services/admin'
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

const STATE: Record<PaymentState, { l: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  confirmed: { l: 'Confirmado', tone: 'success' }, pending: { l: 'Pendiente', tone: 'warning' },
  expired: { l: 'Vencido', tone: 'danger' }, revoked: { l: 'Revocado', tone: 'danger' }, none: { l: 'Sin pago', tone: 'neutral' },
}
type Tab = 'all' | 'confirmed' | 'unpaid' | 'expired'
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '')

function CopyChip({ value, label }: { value: string; label: string }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  return (
    <button type="button" aria-label={`Copiar ${label}`} title={`Copiar ${label}`}
      onClick={() => void navigator.clipboard.writeText(value).then(() => { setDone(true); toast(`${label} copiado`); setTimeout(() => setDone(false), 1500) }).catch(() => toast('No se pudo copiar', 'error'))}
      className="inline-grid size-7 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink">
      {done ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
    </button>
  )
}

/** Participantes y pagos: la referencia SHABEX-ALIAS identifica cada transferencia; la confirmación es manual y auditada. */
export function AdminPayments() {
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: ['admin', 'paymentRows'], queryFn: adminApi.paymentRows })
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<PaymentRow | null>(null)
  const rows = useMemo(() => q.data ?? [], [q.data])
  const money = (n: number | null) => (n == null ? '—' : new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(n))
  const inTab = (r: PaymentRow, t: Tab = tab) => t === 'all' || (t === 'confirmed' ? r.state === 'confirmed' : t === 'expired' ? r.state === 'expired' || r.state === 'revoked' : r.state === 'pending' || r.state === 'none')
  const term = norm(search.trim())
  const list = rows.filter((r) => inTab(r)).filter((r) => !term || [r.alias, r.reference, r.legacy_reference ?? '', r.email, r.bank_reference ?? ''].some((x) => norm(x).includes(term)))
  const count = (t: Tab) => rows.filter((r) => inTab(r, t)).length

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <h1 className="display text-3xl font-semibold uppercase">Participantes y pagos</h1>
        <Link to="/admin/datos-pago" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-xs font-bold text-ink hover:bg-white/5">
          <Landmark className="size-4" /> Datos de pago
        </Link>
      </div>
      <PillTabs label="Filtrar" value={tab} onChange={setTab} className="mb-3" options={[
        { value: 'all', label: 'Todos', count: count('all') },
        { value: 'confirmed', label: 'Confirmados', count: count('confirmed') },
        { value: 'unpaid', label: 'Pendientes', count: count('unpaid') },
        { value: 'expired', label: 'Vencidos o revocados', count: count('expired') },
      ]} />
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input aria-label="Buscar participante" placeholder="Alias, referencia (SHABEX-…) o folio" className="pl-11" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      {q.isLoading ? <CardSkeleton lines={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : list.length === 0 ? (
        <EmptyState title="Sin resultados" description={term ? `Nadie coincide con «${search.trim()}».` : 'No hay participantes en este filtro.'} />
      ) : (
        <ul className="space-y-2">
          {list.map((r) => (
            <li key={r.user_id} className="card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1"><span className="truncate font-semibold">{r.alias}</span><CopyChip value={r.alias} label="alias" /></div>
                  <div className="flex items-center gap-1"><span className="font-mono text-sm font-bold text-aqua">{r.reference}</span><CopyChip value={r.reference} label="referencia" /></div>
                  <div className="truncate text-[11px] text-faint">{r.email}{r.legacy_reference ? ` · antes ${r.legacy_reference}` : ''}</div>
                </div>
                <Badge tone={STATE[r.state].tone}>{STATE[r.state].l}</Badge>
              </div>
              {(r.state === 'confirmed' || r.state === 'expired') && (
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] sm:grid-cols-3">
                  <div><dt className="text-muted">Importe</dt><dd className="font-semibold">{money(r.amount)}</dd></div>
                  <div><dt className="text-muted">Confirmado</dt><dd>{r.confirmed_at ? formatDate(r.confirmed_at, timezone) : '—'}</dd></div>
                  <div><dt className="text-muted">Vence</dt><dd>{r.valid_until ? formatDate(r.valid_until, timezone) : 'Sin vencimiento'}</dd></div>
                  <div><dt className="text-muted">Folio bancario</dt><dd className="break-all font-mono">{r.bank_reference ?? '—'}</dd></div>
                  <div><dt className="text-muted">Método</dt><dd>{r.method ?? '—'}</dd></div>
                  <div><dt className="text-muted">Confirmó</dt><dd>{r.confirmed_by ?? '—'}</dd></div>
                </dl>
              )}
              <Button size="sm" variant={r.state === 'confirmed' ? 'secondary' : 'primary'} className="mt-2" disabled={!r.in_group} onClick={() => setEditing(r)}>
                {r.state === 'confirmed' ? 'Cambiar pago' : 'Confirmar pago'}
              </Button>
              {!r.in_group && <p className="mt-1 text-[11px] text-muted">Aún no está en la quiniela oficial.</p>}
            </li>
          ))}
        </ul>
      )}
      {editing && <ConfirmSheet row={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function ConfirmSheet({ row, onClose }: { row: PaymentRow; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const info = useQuery({ queryKey: ['admin', 'paymentInfo'], queryFn: adminApi.paymentInfo })
  const [status, setStatus] = useState<PaymentStatus>('authorized')
  const [bankRef, setBankRef] = useState(row.bank_reference ?? '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState(row.method ?? 'Transferencia SPEI')
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const amt = amount.trim() ? Number(amount) : null
  const valid = reason.trim().length >= 5 && (status !== 'authorized' || (bankRef.trim().length >= 3 && (amt === null || amt > 0)))
  const save = async () => {
    if (status === 'authorized' && !confirm(`¿Confirmar el pago de ${row.alias} (${row.reference})? Solo confirma pagos verificados en tu banco.`)) return
    setBusy(true)
    try {
      await adminApi.confirmPayment({ user: row.user_id, status, validUntil: status === 'authorized' && until ? new Date(`${until}T23:59:59-06:00`).toISOString() : null,
        amount: status === 'authorized' ? amt : null, method, bankReference: bankRef, reason })
      toast(status === 'authorized' ? `Pago de ${row.alias} confirmado` : 'Pago actualizado')
      await qc.invalidateQueries({ queryKey: ['admin'] })
      onClose()
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet open onClose={onClose} title={`Pago de ${row.alias}`}
      footer={<Button block size="lg" loading={busy} disabled={!valid} onClick={() => void save()}>Guardar</Button>}>
      <div className="space-y-4">
        <p className="text-sm text-muted">Referencia del participante: <span className="font-mono font-bold text-aqua">{row.reference}</span>. Busca esta referencia en el concepto de la transferencia. Una captura o un aviso del participante no confirma el pago: verifícalo en tu banco. Queda registrado con tu nombre.</p>
        <Field label="Estado">{(id) => (
          <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as PaymentStatus)}>
            <option value="authorized">Confirmado (puede enviar pronósticos)</option>
            <option value="pending">Pendiente</option>
            <option value="rejected">Revocado</option>
            <option value="not_applicable">Sin pago</option>
          </Select>
        )}</Field>
        {status === 'authorized' && (
          <>
            <Field label="Folio o clave de rastreo de la transferencia">{(id) => <Input id={id} value={bankRef} maxLength={120} onChange={(e) => setBankRef(e.target.value)} />}</Field>
            <Field label="Importe recibido (MXN)" hint={info.data?.amount ? `Si lo dejas vacío se usa el importe configurado: $${info.data.amount}` : 'Configura el importe en «Datos de pago» o escríbelo aquí.'}>
              {(id) => <Input id={id} inputMode="decimal" value={amount} placeholder={info.data?.amount ? String(info.data.amount) : ''} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />}
            </Field>
            <Field label="Método">{(id) => <Input id={id} value={method} maxLength={40} onChange={(e) => setMethod(e.target.value)} />}</Field>
            <Field label="Vigente hasta (opcional)">{(id) => <Input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>
          </>
        )}
        <Field label="Motivo">{(id) => <Input id={id} value={reason} maxLength={200} placeholder="Ej. Transferencia verificada en el banco" onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Sheet>
  )
}
