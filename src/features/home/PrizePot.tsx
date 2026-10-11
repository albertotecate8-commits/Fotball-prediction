import { useQuery } from '@tanstack/react-query'
import { Trophy } from 'lucide-react'
import { playerApi } from '@/services/player'

const money = (n: number, currency: string) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n)

/** Trébol de cuatro hojas: cuatro hojas en forma de corazón y su tallo. */
function Clover({ className }: { className?: string }) {
  const leaf = 'M12 12C10.2 10.6 7.3 8.6 7.6 6.2 7.9 4.4 10.2 3.9 12 5.8 13.8 3.9 16.1 4.4 16.4 6.2 16.7 8.6 13.8 10.6 12 12Z'
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12.6 13.2c.4 3.2 1.7 6.1 4 8.3" stroke="#1e9e57" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {[0, 90, 180, 270].map((r) => <path key={r} d={leaf} transform={`rotate(${r} 12 12)`} fill="#2ecc71" stroke="#1e9e57" strokeWidth="0.6" />)}
      <circle cx="12" cy="12" r="1.1" fill="#a7f3c4" />
    </svg>
  )
}

/** Trofeo animado con trébol de la suerte y destellos (respeta «reducir movimiento»). */
function LuckyTrophy() {
  return (
    <div className="relative grid size-16 shrink-0 place-items-center" aria-hidden="true">
      <div className="absolute inset-0 rounded-2xl bg-gold/12" />
      <div className="relative overflow-hidden rounded-xl p-1 [animation:trophy-float_3s_ease-in-out_infinite]">
        <Trophy className="size-9 text-gold drop-shadow-[0_2px_6px_rgba(200,164,93,0.45)]" strokeWidth={1.9} />
        <span className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/45 to-transparent [animation:trophy-shine_3.2s_ease-in-out_infinite]" />
      </div>
      <Clover className="absolute -bottom-2 -right-2 size-8 drop-shadow-[0_2px_4px_rgba(0,0,0,0.55)] [animation:clover-spin_6s_ease-in-out_infinite]" />
      <span className="absolute left-1 top-1 size-1.5 rounded-full bg-gold [animation:sparkle_2.2s_ease-in-out_infinite]" />
      <span className="absolute right-2 top-0 size-1 rounded-full bg-white [animation:sparkle_2.2s_ease-in-out_0.7s_infinite]" />
      <span className="absolute bottom-2 left-0 size-1 rounded-full bg-gold [animation:sparkle_2.2s_ease-in-out_1.4s_infinite]" />
    </div>
  )
}

/** Bolsa acumulada: el premio de esta semana (crece con cada pago confirmado). */
export function PrizePot() {
  const q = useQuery({ queryKey: ['prizePot'], queryFn: playerApi.pot, refetchInterval: 120_000 })
  if (!q.data || !q.data.configured) return null
  const { pot, currency } = q.data
  return (
    <section className="card mb-4 flex items-center gap-4 border-gold/30 p-4" aria-labelledby="bolsa">
      <LuckyTrophy />
      <div className="min-w-0">
        <p id="bolsa" className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">Bolsa acumulada</p>
        <p className="scoreline text-3xl leading-tight">{money(Number(pot), currency)} <span className="text-base text-muted">{currency}</span></p>
        <p className="text-xs text-muted">Premio de esta semana</p>
      </div>
    </section>
  )
}
