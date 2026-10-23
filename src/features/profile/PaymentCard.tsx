import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, Copy, CreditCard, Info, ShieldCheck } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDate } from '@/lib/time'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import type { MyPayment } from '@/types/domain'

type State = NonNullable<MyPayment['state']>
const STATUS: Record<State, { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  confirmed: { label: 'Pago confirmado', tone: 'success' },
  pending: { label: 'Pendiente de confirmar', tone: 'warning' },
  expired: { label: 'Pago vencido', tone: 'danger' },
  revoked: { label: 'Pago revocado', tone: 'danger' },
  none: { label: 'Sin pago', tone: 'neutral' },
}
const legacyState = (p: MyPayment): State =>
  p.payment_status === 'authorized' ? 'confirmed' : p.payment_status === 'pending' ? 'pending' : p.payment_status === 'rejected' ? 'revoked' : 'none'

export function CopyRow({ label, value, copyLabel, big, iconOnly }: { label: string; value: string; copyLabel: string; big?: boolean; iconOnly?: boolean }) {
  const toast = useToast()
  const [done, setDone] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      toast(`${label} copiada`)
      setTimeout(() => setDone(false), 1500)
    } catch {
      toast('No se pudo copiar. Mantén presionado el texto para copiarlo.', 'error')
    }
  }
  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted">{label}</div>
        <div className={`select-all break-all font-mono text-ink ${big ? 'text-lg font-bold text-aqua' : 'text-base'}`}>{value}</div>
      </div>
      <Button size="sm" variant="secondary" aria-label={iconOnly ? copyLabel : undefined} className={iconOnly ? 'shrink-0 px-3' : undefined}
        icon={done ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>{iconOnly ? null : copyLabel}</Button>
    </div>
  )
}

/** Estado del pago e instrucciones para pagar. La confirmación la hace el administrador. */
export function PaymentCard() {
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.myPayment, queryFn: playerApi.myPayment })
  const [open, setOpen] = useState(false)
  const toast = useToast()
  if (q.isLoading) return <CardSkeleton lines={3} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const p = q.data!
  const state = p.state ?? legacyState(p)
  const st = STATUS[state]
  const paid = state === 'confirmed'
  const fmt = (n: number | null | undefined) => (n ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: p.currency || 'MXN' }).format(n) : null)
  const money = fmt(p.amount)
  const bankText = [p.bank && `Banco: ${p.bank}`, p.holder && `Titular: ${p.holder}`, p.clabe && `CLABE: ${p.clabe}`, p.account && `Cuenta: ${p.account}`,
    money && `Monto: ${money}`, `Referencia: ${p.reference}`].filter(Boolean).join('\n')
  const copyBank = async () => {
    try { await navigator.clipboard.writeText(bankText); toast('Datos bancarios copiados') } catch { toast('No se pudo copiar. Mantén presionado el texto para copiarlo.', 'error') }
  }

  return (
    <section id="pago" className="card scroll-mt-24 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><CreditCard className="size-5 text-aqua" /> Mi pago</h2>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {/* La referencia identifica tu transferencia: ponla en el concepto. */}
      <div className="mt-3 rounded-2xl border border-aqua/40 bg-aqua/[0.07] px-3">
        <CopyRow label="Tu referencia de pago" value={p.reference} copyLabel="Copiar referencia" big />
        {p.alias && <p className="-mt-1 pb-2.5 text-[11px] text-muted">Participante: <span className="font-semibold text-ink">{p.alias}</span> · escríbela en el <strong>concepto o referencia</strong> de tu transferencia.</p>}
      </div>
      {paid ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-success"><ShieldCheck className="size-4" />
          Pago confirmado{p.paid_amount ? ` (${fmt(p.paid_amount)})` : ''}{p.confirmed_at ? ` el ${formatDate(p.confirmed_at, timezone)}` : ''}. Puedes enviar tus pronósticos{p.valid_until ? ` hasta el ${formatDate(p.valid_until, timezone)}` : ''}.</p>
      ) : !p.configured ? (
        <p className="mt-3 text-sm text-muted">Los datos para pagar aún no están configurados. El administrador los publicará aquí.</p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted">
            {state === 'expired' ? 'Tu pago anterior venció. ' : state === 'revoked' ? 'Tu pago anterior fue revocado. ' : state === 'pending' ? 'Tu pago está pendiente de confirmar por el administrador. ' : ''}
            Paga {money ? <strong className="text-ink">{money}</strong> : 'tu participación'} por transferencia con tu referencia.
          </p>
          <div className="mt-1 divide-y divide-line">
            {p.clabe && <CopyRow label="CLABE" value={p.clabe} copyLabel="Copiar CLABE" />}
            {!p.clabe && p.account && <CopyRow label="Cuenta" value={p.account} copyLabel="Copiar cuenta" />}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Button block variant="secondary" icon={<Copy className="size-4" />} onClick={() => void copyBank()}>Copiar datos bancarios</Button>
            <Button block variant="secondary" icon={<Info className="size-4" />} onClick={() => setOpen(true)}>Ver instrucciones de pago</Button>
          </div>
        </>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Cómo pagar">
        <dl className="space-y-3 text-sm">
          {money && <div><dt className="text-xs text-muted">Monto</dt><dd className="font-semibold">{money}</dd></div>}
          {p.bank && <div><dt className="text-xs text-muted">Banco</dt><dd className="font-semibold">{p.bank}</dd></div>}
          {p.holder && <div><dt className="text-xs text-muted">Titular</dt><dd className="font-semibold">{p.holder}</dd></div>}
          {p.clabe && <div><dt className="text-xs text-muted">CLABE</dt><dd className="font-mono">{p.clabe}</dd></div>}
          {p.account && <div><dt className="text-xs text-muted">Cuenta</dt><dd className="font-mono">{p.account}</dd></div>}
          <div><dt className="text-xs text-muted">Concepto o referencia</dt><dd className="font-mono">{p.concept ? `${p.concept} ` : ''}{p.reference}</dd></div>
          {p.instructions && <div><dt className="text-xs text-muted">Instrucciones</dt><dd className="whitespace-pre-line">{p.instructions}</dd></div>}
          {p.contact && <div><dt className="text-xs text-muted">Contacto</dt><dd>{p.contact}</dd></div>}
          <p className="rounded-xl border border-line bg-surface-2 p-3 text-xs text-muted">Tu pago se activa cuando el administrador lo confirme. Enviar un comprobante no lo activa automáticamente.</p>
        </dl>
      </Sheet>
    </section>
  )
}
