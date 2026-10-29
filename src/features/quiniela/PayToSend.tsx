import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CreditCard, Wallet } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { Button, ButtonLink } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { CopyRow } from '@/features/profile/PaymentCard'

function usePay(amount?: number | null) {
  const q = useQuery({ queryKey: qk.myPayment, queryFn: playerApi.myPayment })
  const p = q.data
  const value = amount ?? p?.amount ?? null
  const money = value ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: p?.currency || 'MXN', maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2 }).format(Number(value)) : null
  return { p, money }
}

/** Pasos, cuenta y referencia listos para copiar y pegar en la app del banco. */
function PayDetails({ amount }: { amount?: number | null }) {
  const { p, money } = usePay(amount)
  if (!p?.configured) return <p className="text-sm text-muted">Los datos para pagar aún no están configurados. El administrador los publicará pronto.</p>
  return (
    <div className="space-y-3">
      <ol className="space-y-1.5 text-sm">
        <li className="flex gap-2"><Step n={1} /><span>Transfiere <strong className="text-gold-soft">{money ?? 'tu entrada'}</strong>{p.bank ? <> a <strong>{p.bank}</strong></> : null}.</span></li>
        <li className="flex gap-2"><Step n={2} /><span>Pon tu <strong>referencia</strong> en el concepto.</span></li>
        <li className="flex gap-2"><Step n={3} /><span>Cuando el admin confirme tu pago, manda tu quiniela.</span></li>
      </ol>
      <div className="divide-y divide-line rounded-xl border border-gold/30 bg-black/40 px-3 text-ink">
        {p.clabe && <CopyRow label="CLABE" value={p.clabe} copyLabel="Copiar CLABE" iconOnly />}
        {!p.clabe && p.account && <CopyRow label="Cuenta" value={p.account} copyLabel="Copiar cuenta" iconOnly />}
        <CopyRow label="Referencia" value={p.reference} copyLabel="Copiar referencia" big iconOnly />
      </div>
      {(p.bank || p.holder) && <p className="text-[11px] text-muted">{[p.bank, p.holder].filter(Boolean).join(' · ')}</p>}
    </div>
  )
}

const Step = ({ n }: { n: number }) => (
  <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-bold text-on-brand">{n}</span>
)

/**
 * Antes de llenar la quiniela: «Envía tu pago» bien visible, con cuenta y
 * referencia para copiar. `amount` y `label` sirven para una quiniela con entrada aparte.
 */
export function PayToSend({ amount, label, tone = 'gold' }: { amount?: number | null; label?: string; tone?: 'gold' | 'soft' }) {
  const { p, money } = usePay(amount)
  const pending = !label && p?.state === 'pending'
  return (
    <section aria-label={label ? `Pago ${label}` : 'Pago para enviar tu quiniela'}
      className={`relative mb-4 overflow-hidden rounded-3xl border p-4 ${tone === 'soft' ? 'border-gold-soft/40' : 'border-gold/50'} bg-[radial-gradient(120%_90%_at_0%_0%,rgba(212,175,55,0.22),transparent_60%)] shadow-[0_0_36px_-14px_rgba(212,175,55,0.6)]`}>
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand text-on-brand"><Wallet className="size-6" /></span>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">{pending ? 'Pago por confirmar' : `Envía tu pago${label ? ` · ${label}` : ''}`}</p>
          <p className="display text-2xl font-bold leading-tight">
            {pending ? 'Tu pago está por confirmarse' : <><span className="gold-text">{money ?? 'Tu entrada'}</span> para mandar tu quiniela</>}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {pending ? 'En cuanto el admin confirme tu pago podrás enviarla. Mientras, elige tus resultados: se guardan solos.'
              : 'Sin pago no se puede enviar. Mientras, elige tus resultados: se guardan solos.'}
          </p>
        </div>
      </div>
      {!pending && <div className="mt-3"><PayDetails amount={amount} /></div>}
      <ButtonLink to="/perfil#pago" size="sm" variant="secondary" className="mt-3">Ver todos los datos de pago</ButtonLink>
    </section>
  )
}

/** Botón dorado de la barra de envío: abre la cuenta y la referencia para pagar. */
export function PayButton({ className }: { className?: string }) {
  const { p, money } = usePay()
  const [open, setOpen] = useState(false)
  const pending = p?.state === 'pending'
  return (
    <>
      <Button size="lg" block className={className} icon={<CreditCard className="size-5" />} onClick={() => setOpen(true)}>
        {pending ? 'Pago por confirmar' : `Enviar pago de ${money ?? 'tu entrada'}`}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title={pending ? 'Tu pago está por confirmarse' : `Envía tu pago de ${money ?? 'tu entrada'}`}>
        {pending
          ? <p className="text-sm text-muted">Ya lo registramos. En cuanto el admin lo confirme, aquí mismo aparecerá «Enviar quiniela».</p>
          : <PayDetails />}
      </Sheet>
    </>
  )
}
