import { useMemo, useState } from 'react'
import { Link } from 'react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Landmark, PencilLine, Search, Trophy } from 'lucide-react'
import { adminApi, type PaymentRow, type PaymentState } from '@/services/admin'
import { playerApi } from '@/services/player'
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
      <PrizePotCard />
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
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {r.state !== 'confirmed' && <QuickConfirm row={r} />}
                {(r.sent_open ?? 0) > 0 && <UnlockButton row={r} />}
                <Button size="sm" variant="secondary" disabled={!r.in_group} onClick={() => setEditing(r)}>
                  {r.state === 'confirmed' ? 'Cambiar pago' : 'Más opciones'}
                </Button>
              </div>
              {!r.in_group && <p className="mt-1 text-[11px] text-muted">Aún no está en la quiniela oficial.</p>}
            </li>
          ))}
        </ul>
      )}
      {editing && <ConfirmSheet row={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

/** Bolsa de esta semana: el admin puede fijar el monto (solo esta semana) o dejarlo automático. */
function PrizePotCard() {
  const qc = useQueryClient()
  const toast = useToast()
  const pot = useQuery({ queryKey: ['prizePot'], queryFn: playerApi.pot })
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const money = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: pot.data?.currency || 'MXN' }).format(n)
  const save = async (amount: number | null) => {
    if (amount !== null && !confirm(`¿Fijar la bolsa de esta semana en ${money(amount)}? La semana siguiente vuelve al cálculo automático.`)) return
    setBusy(true)
    try {
      const r = await adminApi.setPrizePot(amount)
      toast(r.manual ? `Bolsa fijada en ${money(r.pot)}` : `Bolsa automática: ${money(r.pot)}`)
      setValue('')
      await qc.invalidateQueries({ queryKey: ['prizePot'] })
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  const amt = value.trim() ? Number(value) : null
  return (
    <section className="card mb-4 border-gold/30 p-4" aria-labelledby="bolsa-admin">
      <div className="flex items-center justify-between gap-2">
        <h2 id="bolsa-admin" className="flex items-center gap-2 font-semibold"><Trophy className="size-5 text-gold" /> Bolsa de esta semana</h2>
        {pot.data && <Badge tone={pot.data.manual ? 'warning' : 'neutral'}>{pot.data.manual ? 'Fijada por ti' : 'Automática (70 %)'}</Badge>}
      </div>
      <p className="scoreline mt-1 text-3xl text-gold">{pot.data ? money(Number(pot.data.pot)) : '—'}</p>
      <div className="mt-3 flex gap-2">
        <Input aria-label="Nuevo monto de la bolsa" inputMode="decimal" placeholder="Nuevo monto" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d.]/g, ''))} />
        <Button loading={busy} disabled={amt === null || !(amt >= 0)} onClick={() => void save(amt)}>Fijar</Button>
      </div>
      {pot.data?.manual && <Button size="sm" variant="secondary" className="mt-2" disabled={busy} onClick={() => void save(null)}>Volver al cálculo automático</Button>}
      <p className="mt-2 text-[11px] text-muted">Solo cambia la bolsa de esta semana. Los participantes la ven al cierre de la quiniela.</p>
    </section>
  )
}

/** Autoriza editar la quiniela ya enviada: vuelve a borrador lo que aún no empieza. */
function UnlockButton({ row }: { row: PaymentRow }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!confirm(`¿Permitir que ${row.alias} edite su quiniela? Sus ${row.sent_open} pronósticos de partidos que aún no empiezan vuelven a borrador y tendrá que enviarla otra vez.`)) return
    setBusy(true)
    try {
      const r = await adminApi.unlockQuiniela(row.user_id)
      toast(`${row.alias} ya puede editar su quiniela (${r.picks} ${r.picks === 1 ? 'partido' : 'partidos'})`)
      await qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  return <Button size="sm" variant="secondary" loading={busy} icon={<PencilLine className="size-4" />} onClick={() => void go()}>Permitir editar quiniela</Button>
}

/** Un toque: confirma el pago (manual, por el admin, queda registrado). */
function QuickConfirm({ row }: { row: PaymentRow }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!confirm(`¿Confirmar el pago de ${row.alias}?`)) return
    setBusy(true)
    try {
      await adminApi.confirmPayment({ user: row.user_id, status: 'authorized', validUntil: null, amount: null, method: '', bankReference: '', reason: '' })
      toast(`Pago de ${row.alias} confirmado`)
      await qc.invalidateQueries({ queryKey: ['admin'] })
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  return <Button size="sm" loading={busy} disabled={!row.in_group} icon={<Check className="size-4" />} onClick={() => void go()}>Confirmar pago</Button>
}

function ConfirmSheet({ row, onClose }: { row: PaymentRow; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const info = useQuery({ queryKey: ['admin', 'paymentInfo'], queryFn: adminApi.paymentInfo })
  const [status, setStatus] = useState<PaymentStatus>('authorized')
  const [bankRef, setBankRef] = useState(row.bank_reference ?? '')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState(row.method ?? '')
  const [until, setUntil] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const amt = amount.trim() ? Number(amount) : null
  const valid = status !== 'authorized' || amt === null || amt > 0
  const save = async () => {
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
        <p className="text-sm text-muted">Referencia: <span className="font-mono font-bold text-aqua">{row.reference}</span>. Todo lo de abajo es opcional.</p>
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
            <Field label="Folio de la transferencia (opcional)">{(id) => <Input id={id} value={bankRef} maxLength={120} onChange={(e) => setBankRef(e.target.value)} />}</Field>
            <Field label="Importe recibido (MXN, opcional)" hint={info.data?.amount ? `Si lo dejas vacío se usa el importe configurado: $${info.data.amount}` : 'Configura el importe en «Datos de pago» o escríbelo aquí.'}>
              {(id) => <Input id={id} inputMode="decimal" value={amount} placeholder={info.data?.amount ? String(info.data.amount) : ''} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} />}
            </Field>
            <Field label="Método (opcional)">{(id) => <Input id={id} value={method} maxLength={40} onChange={(e) => setMethod(e.target.value)} />}</Field>
            <Field label="Vigente hasta (opcional)">{(id) => <Input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}</Field>
          </>
        )}
        <Field label="Nota (opcional)">{(id) => <Input id={id} value={reason} maxLength={200} placeholder="Ej. Transferencia verificada en el banco" onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Sheet>
  )
}
