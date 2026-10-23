import { useQuery } from '@tanstack/react-query'
import { CreditCard } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { ButtonLink } from '@/components/ui/Button'
import { CopyRow } from '@/features/profile/PaymentCard'

/**
 * Antes de llenar la quiniela: cómo pagar para poder enviarla. Cuenta y
 * referencia listas para copiar y pegar en la app del banco.
 * `amount` y `label` sirven para una quiniela con entrada aparte.
 */
export function PayToSend({ amount, label, tone = 'gold' }: { amount?: number | null; label?: string; tone?: 'gold' | 'aqua' }) {
  const q = useQuery({ queryKey: qk.myPayment, queryFn: playerApi.myPayment })
  const p = q.data
  const value = amount ?? p?.amount ?? null
  const money = value ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: p?.currency || 'MXN', maximumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2 }).format(Number(value)) : null
  const pending = !label && p?.state === 'pending'
  const accent = tone === 'aqua' ? 'border-aqua/40 bg-aqua/[0.07] text-aqua' : 'border-gold/40 bg-gold/10 text-gold'
  return (
    <section aria-label={label ? `Pago ${label}` : 'Pago para enviar tu quiniela'} className={`mb-4 rounded-2xl border p-3 text-sm ${accent}`}>
      <p className="flex items-center gap-2 font-semibold">
        <CreditCard className="size-5 shrink-0" />
        {pending ? 'Tu pago está por confirmarse' : `Transfiere ${money ?? 'tu entrada'} para mandar tu quiniela${label ? ` de ${label}` : ''}`}
      </p>
      <p className="mt-1 text-xs text-muted">
        {pending
          ? 'En cuanto el admin confirme tu pago podrás enviarla. Mientras, elige tus resultados: se guardan solos.'
          : 'Copia la cuenta y tu referencia, y pégalas en la app de tu banco (la referencia va en el concepto). Mientras, elige tus resultados: se guardan solos.'}
      </p>
      {p?.configured && !pending && (
        <div className="mt-2 divide-y divide-line rounded-xl bg-surface/60 px-3 text-ink">
          {p.clabe && <CopyRow label="CLABE" value={p.clabe} copyLabel="Copiar CLABE" iconOnly />}
          {!p.clabe && p.account && <CopyRow label="Cuenta" value={p.account} copyLabel="Copiar cuenta" iconOnly />}
          <CopyRow label="Referencia" value={p.reference} copyLabel="Copiar referencia" big iconOnly />
        </div>
      )}
      {p?.configured && !pending && (p.bank || p.holder) && (
        <p className="mt-1.5 text-[11px] text-muted">{[p.bank, p.holder].filter(Boolean).join(' · ')}</p>
      )}
      <ButtonLink to="/perfil#pago" size="sm" variant="secondary" className="mt-2">Ver todos los datos de pago</ButtonLink>
    </section>
  )
}
