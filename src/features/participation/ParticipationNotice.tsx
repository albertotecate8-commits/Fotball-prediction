import { ShieldAlert, ShieldCheck } from 'lucide-react'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatDate } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { Participation } from '@/types/domain'

const REASON: Record<string, string> = {
  not_applicable: 'Aún no hay un pago registrado para tu cuenta.',
  pending: 'Tu pago está pendiente de confirmación por el administrador.',
  rejected: 'Tu pago no pudo confirmarse. Contacta al administrador.',
  authorized: 'Tu pago confirmado no cubre esta jornada (venció antes del cierre).',
}

/** Explica cómo activar la participación. No muestra ningún botón de pago: no hay pasarela. */
export function ParticipationNotice({ participation: p, className }: { participation: Participation; className?: string }) {
  const { timezone } = useAppConfig()
  if (!p.requires_payment) return null
  if (p.can_participate) {
    return (
      <p className={cn('flex items-center gap-2 text-xs text-success', className)}>
        <ShieldCheck className="size-4" /> Participación activa{p.valid_until ? ` hasta el ${formatDate(p.valid_until, timezone)}` : ''}.
      </p>
    )
  }
  return (
    <section role="note" className={cn('rounded-2xl border border-gold/35 bg-gold/10 p-3 text-sm', className)}>
      <p className="flex items-center gap-2 font-semibold text-gold"><ShieldAlert className="size-4" /> Modo exploración</p>
      <p className="mt-1 text-muted">
        Puedes ver partidos, resultados y clasificación, y preparar tu quiniela en este dispositivo. Para enviar pronósticos oficiales y sumar puntos,
        el administrador debe confirmar tu pago de participación. {REASON[p.payment_status] ?? ''}
      </p>
    </section>
  )
}
