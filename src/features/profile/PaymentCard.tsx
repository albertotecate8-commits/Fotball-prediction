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

const STATUS: Record<MyPayment['payment_status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  authorized: { label: 'Pagado', tone: 'success' },
  pending: { label: 'Pendiente de confirmar', tone: 'warning' },
  rejected: { label: 'Rechazado', tone: 'danger' },
  not_applicable: { label: 'Sin pago', tone: 'neutral' },
}

function CopyRow({ label, value, copyLabel }: { label: string; value: string; copyLabel: string }) {
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
        <div className="select-all break-all font-mono text-base text-ink">{value}</div>
      </div>
      <Button size="sm" variant="secondary" icon={done ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>{copyLabel}</Button>
    </div>
  )
}

/** Estado del pago e instrucciones para pagar. La confirmación la hace el administrador. */
export function PaymentCard() {
  const { timezone } = useAppConfig()
  const q = useQuery({ queryKey: qk.myPayment, queryFn: playerApi.myPayment })
  const [open, setOpen] = useState(false)
  if (q.isLoading) return <CardSkeleton lines={3} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  const p = q.data!
  const st = STATUS[p.payment_status]
  const paid = p.payment_status === 'authorized'
  const money = p.amount ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: p.currency || 'MXN' }).format(p.amount) : null

  return (
    <section id="pago" className="card scroll-mt-24 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><CreditCard className="size-5 text-aqua" /> Mi pago</h2>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      {paid ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-success"><ShieldCheck className="size-4" /> Puedes enviar tus pronósticos{p.valid_until ? ` hasta el ${formatDate(p.valid_until, timezone)}` : ''}.</p>
      ) : !p.configured ? (
        <p className="mt-2 text-sm text-muted">Los datos para pagar aún no están configurados. El administrador los publicará aquí.</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-muted">Paga {money ? <strong className="text-ink">{money}</strong> : 'tu participación'} por transferencia. Usa tu referencia para que podamos identificar tu pago.</p>
          <div className="mt-2 divide-y divide-line">
            {p.clabe && <CopyRow label="CLABE" value={p.clabe} copyLabel="Copiar CLABE" />}
            {!p.clabe && p.account && <CopyRow label="Cuenta" value={p.account} copyLabel="Copiar cuenta" />}
            <CopyRow label="Referencia" value={p.reference} copyLabel="Copiar referencia" />
          </div>
          <Button block className="mt-3" variant="secondary" icon={<Info className="size-4" />} onClick={() => setOpen(true)}>Ver instrucciones de pago</Button>
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
