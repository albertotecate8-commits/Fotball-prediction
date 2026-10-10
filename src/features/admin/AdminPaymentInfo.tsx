import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/services/admin'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDateTime } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'

/** Datos reales para recibir pagos. Los participantes los ven en «Mi perfil». */
export function AdminPaymentInfo() {
  const { timezone } = useAppConfig()
  const qc = useQueryClient()
  const toast = useToast()
  const q = useQuery({ queryKey: ['admin', 'paymentInfo'], queryFn: adminApi.paymentInfo })
  const [f, setF] = useState({ bank: '', holder: '', clabe: '', account: '', amount: '', concept: '', instructions: '', contact: '' })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (q.data) setF({ bank: q.data.bank ?? '', holder: q.data.holder ?? '', clabe: q.data.clabe ?? '', account: q.data.account ?? '',
      amount: q.data.amount?.toString() ?? '', concept: q.data.concept ?? '', instructions: q.data.instructions ?? '', contact: q.data.contact ?? '' })
  }, [q.data])
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((p) => ({ ...p, [k]: e.target.value }))
  const clabe = f.clabe.replace(/\s/g, '')
  const clabeError = clabe && !/^\d{18}$/.test(clabe) ? 'La CLABE debe tener 18 dígitos.' : null
  const amount = f.amount ? Number(f.amount.replace(',', '.')) : null
  const valid = !clabeError && (amount === null || amount > 0)

  const save = async () => {
    setBusy(true)
    try {
      await adminApi.savePaymentInfo({ ...f, clabe, amount })
      toast('Datos de pago guardados')
      await qc.invalidateQueries({ queryKey: ['admin', 'paymentInfo'] })
      await qc.invalidateQueries({ queryKey: ['myPayment'] })
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  if (q.isLoading) return <CardSkeleton lines={6} />
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />
  return (
    <div>
      <h1 className="display mb-1 text-3xl font-semibold uppercase">Datos de pago</h1>
      <p className="mb-4 text-sm text-muted">
        {q.data ? `Última actualización: ${formatDateTime(q.data.updated_at, timezone)}.` : 'Aún no hay datos: los participantes ven «pendiente de configuración».'} Se muestran a los participantes en «Mi perfil».
      </p>
      <div className="card space-y-4 p-4">
        <Field label="Banco">{(id) => <Input id={id} value={f.bank} maxLength={80} onChange={set('bank')} />}</Field>
        <Field label="Titular de la cuenta">{(id) => <Input id={id} value={f.holder} maxLength={120} onChange={set('holder')} />}</Field>
        <Field label="CLABE (18 dígitos)" error={clabeError}>{(id) => <Input id={id} inputMode="numeric" value={f.clabe} maxLength={22} onChange={set('clabe')} />}</Field>
        <Field label="Número de cuenta o tarjeta (opcional)">{(id) => <Input id={id} value={f.account} maxLength={40} onChange={set('account')} />}</Field>
        <Field label="Monto (MXN)">{(id) => <Input id={id} inputMode="decimal" value={f.amount} onChange={set('amount')} />}</Field>
        <Field label="Concepto" hint="Se añade la referencia personal de cada participante (SHX-…).">{(id) => <Input id={id} value={f.concept} maxLength={120} onChange={set('concept')} />}</Field>
        <Field label="Instrucciones adicionales">{(id) => <Textarea id={id} value={f.instructions} maxLength={1000} onChange={set('instructions')} />}</Field>
        <Field label="Contacto para enviar comprobante (opcional)">{(id) => <Input id={id} value={f.contact} maxLength={120} onChange={set('contact')} />}</Field>
        <Button block size="lg" loading={busy} disabled={!valid} onClick={() => void save()}>Guardar datos de pago</Button>
      </div>
    </div>
  )
}
