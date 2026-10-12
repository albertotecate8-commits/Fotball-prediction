import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BadgeCheck, Clock, Sparkles, Trophy } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { ButtonLink } from '@/components/ui/Button'
import type { PoolData } from '@/types/domain'

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

/** Cierre de la quiniela: el primer partido de la semana en juego (ahí se cierra el total de goles). */
function closingAt(pool: PoolData | undefined): number | null {
  if (!pool) return null
  const now = Date.now()
  const open = pool.matches.filter((m) => m.open && Date.parse(m.kickoff_at) > now)
  if (open.length === 0) return null
  const week = (pool.weeks ?? []).filter((w) => w.goals_open && open.some((m) => m.week_id === w.id)).sort((x, y) => x.week_start.localeCompare(y.week_start))[0]
  const inWeek = week ? open.filter((m) => m.week_id === week.id) : open
  return Math.min(...inWeek.map((m) => Date.parse(m.kickoff_at)))
}

function useNow(ms: number) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t) }, [ms])
  return now
}

function Countdown({ to }: { to: number }) {
  const now = useNow(1000)
  const left = Math.max(0, to - now)
  const d = Math.floor(left / 86_400_000)
  const h = Math.floor(left / 3_600_000) % 24
  const m = Math.floor(left / 60_000) % 60
  const sec = Math.floor(left / 1000) % 60
  const parts: [number, string][] = d > 0 ? [[d, 'días'], [h, 'hrs'], [m, 'min']] : [[h, 'hrs'], [m, 'min'], [sec, 'seg']]
  return (
    <div className="flex gap-1.5" role="timer" aria-label={`Cierra en ${d} días, ${h} horas y ${m} minutos`}>
      {parts.map(([v, l]) => (
        <div key={l} className="min-w-12 rounded-lg border border-gold/25 bg-black/30 px-2 py-1 text-center">
          <div className="scoreline text-xl leading-none text-ink">{String(v).padStart(2, '0')}</div>
          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">{l}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Bolsa acumulada: el premio de esta semana (crece con cada pago confirmado).
 * Hasta el cierre: cuenta regresiva y una invitación a pagar para entrar.
 */
export function PrizePot() {
  const q = useQuery({ queryKey: ['prizePot'], queryFn: playerApi.pot, refetchInterval: 120_000 })
  const pool = useQuery({ queryKey: qk.pool, queryFn: playerApi.pool, refetchInterval: 60_000 })
  const pay = useQuery({ queryKey: qk.myPayment, queryFn: playerApi.myPayment })
  useNow(30_000)
  if (!q.data || !q.data.configured) return null
  const { pot, currency, paid_count } = q.data
  const close = closingAt(pool.data)
  const open = close !== null && close > Date.now()
  const inside = pay.data?.state === 'confirmed' || pool.data?.can_submit === true
  const entry = pay.data?.amount ? money(Number(pay.data.amount), pay.data.currency || currency) : null
  return (
    <section aria-labelledby="bolsa"
      className="relative mb-4 overflow-hidden rounded-3xl border border-gold/45 bg-[radial-gradient(120%_90%_at_0%_0%,rgba(200,164,93,0.28),transparent_55%),radial-gradient(90%_80%_at_100%_100%,rgba(46,204,113,0.14),transparent_60%)] p-4 shadow-[0_0_40px_-12px_rgba(200,164,93,0.55)]">
      <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent [animation:trophy-shine_4.5s_ease-in-out_infinite]" aria-hidden="true" />
      <div className="relative flex items-center gap-4">
        <LuckyTrophy />
        <div className="min-w-0">
          <p id="bolsa" className="text-[11px] font-bold uppercase tracking-[0.16em] text-gold">{open ? 'Bolsa de la semana' : 'Bolsa final'}</p>
          {open ? (
            <>
              {/* Hasta el cierre el monto es sorpresa: se revela cuando cierra la quiniela. */}
              <p className="scoreline bg-gradient-to-b from-[#fff6dc] to-gold bg-clip-text text-4xl leading-tight tracking-widest text-transparent [animation:pulse-soft_2.4s_ease-in-out_infinite]" aria-label="Monto sorpresa">$ ? ? ?</p>
              <p className="text-xs text-muted">Crece con cada pago · se revela al cierre</p>
            </>
          ) : (
            <>
              <p className="scoreline bg-gradient-to-b from-[#fff6dc] to-gold bg-clip-text text-4xl leading-tight text-transparent">
                {money(Number(pot), currency)} <span className="text-base text-muted [-webkit-text-fill-color:currentColor]">{currency}</span>
              </p>
              <p className="text-xs text-muted">{paid_count > 0 ? `${paid_count} ${paid_count === 1 ? 'participante' : 'participantes'} en juego` : 'Premio de esta semana'}</p>
            </>
          )}
        </div>
      </div>

      {open && (
        <div className="relative mt-4 border-t border-gold/20 pt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-gold">
            <Clock className="size-3.5" /> La quiniela cierra en
          </p>
          <Countdown to={close!} />
          {inside ? (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-success/12 px-3 py-2 text-sm font-semibold text-success">
              <BadgeCheck className="size-5 shrink-0" /> Ya estás dentro. ¡Suerte por la bolsa!
            </p>
          ) : (
            <>
              <ButtonLink to="/perfil#pago" block size="lg" icon={<Sparkles className="size-5" />}
                className="mt-3 bg-gradient-to-r from-[#e8c77a] to-gold !text-[#1a1406] shadow-[0_8px_24px_-8px_rgba(200,164,93,0.8)] hover:brightness-110">
                {entry ? `Entra por ${entry} y juega por la bolsa` : 'Paga tu quiniela y juega por la bolsa'}
              </ButtonLink>
              <p className="mt-1.5 text-center text-[11px] text-muted">Paga antes del cierre para que tu quiniela cuente.</p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
