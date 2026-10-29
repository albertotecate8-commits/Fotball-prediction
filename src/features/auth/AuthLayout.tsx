import type { ReactNode } from 'react'
import { Radio, ShieldCheck, Target, Timer, Trophy } from 'lucide-react'
import { BrandLogoFull } from '@/components/BrandLogo'
import { cn } from '@/lib/cn'

/** Balón de futbol (dibujo propio, simple). */
function Ball({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill="#f4f4f5" stroke="#111" strokeWidth="1.2" />
      <path d="M16 9.2l5 3.6-1.9 5.9h-6.2L11 12.8z" fill="#111" />
      <path d="M16 9.2V4.1M21 12.8l4.6-1.6M19.1 18.7l2.9 4.1M12.9 18.7L10 22.8M11 12.8l-4.6-1.6" stroke="#111" strokeWidth="1.2" fill="none" />
      <path d="M10 22.8l-3.2.4M22 22.8l3.2.4M16 4.1l-3.4-1M16 4.1l3.4-1" stroke="#111" strokeWidth="1" fill="none" />
    </svg>
  )
}

/** Mosaico brillante que flota alrededor del logo (como los íconos de la referencia). */
function FloatTile({ children, className, delay = '0s' }: { children: ReactNode; className?: string; delay?: string }) {
  return (
    <div aria-hidden="true" style={{ animationDelay: delay }}
      className={cn('grid size-14', 'absolute place-items-center rounded-2xl border border-gold/40 bg-[linear-gradient(145deg,#2a2418,#0d0d0e)] shadow-[0_14px_30px_-12px_rgba(212,175,55,0.65),inset_0_1px_0_rgba(255,255,255,0.12)] [animation:trophy-float_4s_ease-in-out_infinite] sm:size-16', className)}>
      {children}
    </div>
  )
}

const FEATURES = [
  { icon: Radio, label: 'Resultados en vivo' },
  { icon: Target, label: '1 punto por acierto' },
  { icon: Trophy, label: 'Clasificación' },
  { icon: ShieldCheck, label: 'Partidos reales' },
]

/**
 * Entrar, crear cuenta y recuperar acceso: portada oscura con el logo, luces de
 * estadio y elementos de futbol; el formulario en una tarjeta con borde dorado.
 */
export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-dvh pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      {/* Portada */}
      <header className="relative overflow-hidden bg-[#050505] pb-20 pt-[calc(env(safe-area-inset-top)+1.75rem)]">
        {/* Luces de estadio y resplandor dorado */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_55%_at_50%_38%,rgba(212,175,55,0.28),transparent_70%)]" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-[28rem] w-72 rotate-[28deg] bg-[linear-gradient(180deg,rgba(255,236,170,0.18),transparent_75%)] blur-2xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-24 h-[28rem] w-72 -rotate-[28deg] bg-[linear-gradient(180deg,rgba(255,236,170,0.18),transparent_75%)] blur-2xl" />
        {/* Círculo central de la cancha, detrás del logo */}
        <div aria-hidden="true" className="pointer-events-none absolute left-1/2 top-[calc(env(safe-area-inset-top)+0.5rem)] size-64 -translate-x-1/2 rounded-full border border-gold/15" />
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+8.5rem)] h-px bg-gradient-to-r from-transparent via-gold/15 to-transparent" />

        {/* Elementos de futbol flotando */}
        <FloatTile className="left-4 top-[calc(env(safe-area-inset-top)+5.5rem)] -rotate-12 sm:left-[12%]"><Ball className="size-8 sm:size-9" /></FloatTile>
        <FloatTile className="left-[14%] top-[calc(env(safe-area-inset-top)+12.5rem)] hidden rotate-6 sm:grid" delay="1.2s"><Timer className="size-7 text-gold-soft" /></FloatTile>
        <FloatTile className="right-4 top-[calc(env(safe-area-inset-top)+4.5rem)] rotate-12 sm:right-[12%]" delay="0.6s"><Trophy className="size-7 text-gold" /></FloatTile>
        <FloatTile className="right-[14%] top-[calc(env(safe-area-inset-top)+12rem)] hidden -rotate-6 sm:grid" delay="1.8s"><Radio className="size-7 text-live" /></FloatTile>

        <div className="relative mx-auto flex max-w-md flex-col items-center px-4 text-center">
          <BrandLogoFull size={132} />
          <h2 className="display mt-4 text-[2.6rem] font-bold leading-none tracking-[0.04em] sm:text-5xl">
            <span className="gold-text">GB</span> <span className="text-silver">QUINELA</span>
          </h2>
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.42em] text-muted">Pronostica · Compite · Gana</p>
          <p className="mt-4 rounded-full border border-gold/30 bg-white/[0.04] px-4 py-1.5 text-[11px] font-bold uppercase tracking-[0.22em] text-gold-soft">
            Liga MX · LaLiga · Champions
          </p>
        </div>

        {/* Onda que separa la portada del formulario */}
        <svg aria-hidden="true" viewBox="0 0 1440 120" preserveAspectRatio="none" className="absolute inset-x-0 bottom-0 h-16 w-full sm:h-20">
          <path d="M0 64C240 120 480 120 720 80S1200 0 1440 40V120H0Z" fill="var(--color-bg)" />
          <path d="M0 64C240 120 480 120 720 80S1200 0 1440 40" fill="none" stroke="rgba(212,175,55,0.45)" strokeWidth="2" />
        </svg>
      </header>

      {/* Formulario */}
      <main className="relative z-10 mx-auto -mt-10 max-w-md px-4">
        <section className="rounded-[1.75rem] border border-gold/35 bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.01))] p-5 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.95),0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-sm sm:p-7">
          <h1 className="display text-center text-3xl font-bold uppercase tracking-wide">{title}</h1>
          <p className="mx-auto mb-6 mt-1.5 max-w-xs text-center text-sm text-muted">{subtitle}</p>
          {children}
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </section>

        {/* Lo que ofrece la app */}
        <ul className="mt-5 grid grid-cols-4 gap-2">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex flex-col items-center gap-1.5 rounded-2xl border border-line bg-surface/70 px-1.5 py-3 text-center">
              <Icon className="size-5 text-gold" aria-hidden="true" />
              <span className="text-[10.5px] font-semibold leading-tight text-ink/85">{label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-5 flex items-center justify-center gap-3 text-[10px] font-semibold uppercase tracking-[0.35em] text-faint">
          <span className="h-px w-8 bg-line-strong" /> Más que una quiniela <span className="h-px w-8 bg-line-strong" />
        </p>
      </main>
    </div>
  )
}
