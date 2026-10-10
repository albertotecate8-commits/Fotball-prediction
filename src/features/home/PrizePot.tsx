import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { playerApi } from '@/services/player'

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n)

/** Bolsa acumulada: crece con cada pago confirmado por el admin. */
export function PrizePot() {
  const q = useQuery({ queryKey: ['prizePot'], queryFn: playerApi.pot, refetchInterval: 120_000 })
  if (!q.data || !q.data.configured) return null
  const { pot, paid_count: n, currency } = q.data
  return (
    <section className="card mb-4 flex items-center gap-4 border-gold/30 p-4" aria-labelledby="bolsa">
      <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold/12 text-gold"><Trophy className="size-6" /></div>
      <div className="min-w-0">
        <p id="bolsa" className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">Bolsa acumulada</p>
        <p className="scoreline text-3xl leading-tight">{money(Number(pot), currency)} <span className="text-base text-muted">{currency}</span></p>
        <p className="text-xs text-muted">{n ? `${n} ${n === 1 ? 'participante con pago confirmado' : 'participantes con pago confirmado'}` : 'Crece con cada pago confirmado'}</p>
      </div>
    </section>
  )
}
