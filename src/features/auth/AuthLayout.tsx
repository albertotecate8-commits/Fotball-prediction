import type { ReactNode } from 'react'
import { Crown, Goal, Radio, ShieldCheck, Target, Timer, Trophy } from 'lucide-react'
import { BrandLogoFull } from '@/components/BrandLogo'
import { cn } from '@/lib/cn'

/** Balón de futbol (dibujo propio, simple). */
function Ball({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <circle cx="16" cy="16" r="14.5" fill="#fafafa" stroke="#111" strokeWidth="1.2" />
      <path d="M16 9.2l5 3.6-1.9 5.9h-6.2L11 12.8z" fill="#111" />
      <path d="M16 9.2V4.1M21 12.8l4.6-1.6M19.1 18.7l2.9 4.1M12.9 18.7L10 22.8M11 12.8l-4.6-1.6" stroke="#111" strokeWidth="1.2" fill="none" />
      <path d="M10 22.8l-3.2.4M22 22.8l3.2.4M16 4.1l-3.4-1M16 4.1l3.4-1" stroke="#111" strokeWidth="1" fill="none" />
    </svg>
  )
}

/** Mosaico brillante en 3D, como los íconos de app de la referencia. */
function Tile3D({ children, className, tone, delay = '0s' }: { children: ReactNode; className?: string; tone: string; delay?: string }) {
  return (
    <div aria-hidden="true" style={{ animationDelay: delay }}
      className={cn('absolute grid size-16 place-items-center rounded-[1.35rem] [animation:trophy-float_4.5s_ease-in-out_infinite] sm:size-20', tone,
        'shadow-[0_18px_30px_-12px_rgba(0,0,0,0.75),inset_0_2px_0_rgba(255,255,255,0.45),inset_0_-6px_12px_rgba(0,0,0,0.25)]', className)}>
      <span className="pointer-events-none absolute inset-x-2 top-1.5 h-1/3 rounded-t-[1rem] bg-gradient-to-b from-white/45 to-transparent" />
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
 * Entrar, crear cuenta y recuperar acceso (misma composición que la referencia):
 * portada negra con curva y mosaicos de futbol en 3D; abajo, zona clara con la
 * tarjeta del formulario y lo que ofrece la app. Negro, dorado y blanco.
 */
export function AuthLayout({ title, accent, subtitle, children, footer }: { title: string; accent?: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="relative min-h-dvh overflow-hidden bg-[#f5f1e6] pb-[calc(env(safe-area-inset-bottom)+1.5rem)]">
      {/* Ondas doradas en la zona clara */}
      <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-[30rem] h-80 w-96 rotate-[-20deg] rounded-[50%] bg-[radial-gradient(closest-side,rgba(212,175,55,0.55),rgba(212,175,55,0)_100%)] blur-sm" />
      <div aria-hidden="true" className="pointer-events-none absolute -right-40 bottom-24 h-96 w-[28rem] rotate-[25deg] rounded-[50%] bg-[radial-gradient(closest-side,rgba(212,175,55,0.5),rgba(212,175,55,0)_100%)] blur-sm" />

      {/* Portada */}
      <header className="relative bg-[#070707] pb-36 pt-[calc(env(safe-area-inset-top)+0.9rem)] text-ink">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(55%_50%_at_50%_42%,rgba(212,175,55,0.3),transparent_70%)]" />

        {/* Etiquetas de arriba */}
        <div className="relative mx-auto flex max-w-xl items-start justify-between gap-2 px-3">
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-1.5">
            <Crown className="size-4 shrink-0 text-gold" aria-hidden="true" />
            <div className="leading-tight">
              <p className="text-[12px] font-semibold">Quinela oficial</p>
              <p className="text-[10px] text-muted">Good Barber</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-1.5">
            <span className="size-2.5 shrink-0 rounded-full bg-success shadow-[0_0_10px_rgba(47,209,139,0.9)]" aria-hidden="true" />
            <div className="leading-tight">
              <p className="text-[12px] font-semibold">En vivo</p>
              <p className="text-[10px] text-muted">Resultados al momento</p>
            </div>
          </div>
        </div>

        {/* Mosaicos de futbol en 3D */}
        <Tile3D tone="bg-[linear-gradient(145deg,#ffffff,#d9d9de)]" className="-left-2 top-[calc(env(safe-area-inset-top)+7.5rem)] -rotate-12 sm:left-[8%]"><Ball className="size-10 sm:size-12" /></Tile3D>
        <Tile3D tone="bg-[linear-gradient(145deg,#2fbf71,#127a43)]" className="-left-1 top-[calc(env(safe-area-inset-top)+14.5rem)] rotate-12 max-[400px]:hidden sm:left-[11%]" delay="1.1s"><Goal className="size-8 text-white sm:size-10" /></Tile3D>
        <Tile3D tone="bg-[linear-gradient(145deg,#2b2b2f,#09090a)] ring-1 ring-gold/40" className="-right-2 top-[calc(env(safe-area-inset-top)+6.5rem)] rotate-12 sm:right-[8%]" delay="0.5s"><Trophy className="size-8 text-gold sm:size-10" /></Tile3D>
        <Tile3D tone="bg-[linear-gradient(145deg,#f1d27a,#b8922a)]" className="-right-1 top-[calc(env(safe-area-inset-top)+13.5rem)] -rotate-6 max-[400px]:hidden sm:right-[11%]" delay="1.7s"><Timer className="size-8 text-[#1a1406] sm:size-10" /></Tile3D>

        <div className="relative mx-auto mt-2 flex max-w-md flex-col items-center px-16 text-center">
          <BrandLogoFull size={116} className="rounded-[1.6rem]" />
          <h2 className="display mt-3 whitespace-nowrap text-[2.6rem] font-bold leading-none tracking-[0.02em] sm:text-6xl">
            <span className="text-white">GB</span> <span className="gold-text">QUINELA</span>
          </h2>
          <p className="mt-3 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.38em] text-silver/80 sm:text-xs">Pronostica · Compite · Gana</p>
          <p className="mt-4 whitespace-nowrap rounded-full border border-white/15 bg-white/[0.05] px-4 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-silver sm:text-xs">
            Liga MX <span className="text-gold">•</span> LaLiga <span className="text-gold">•</span> Champions
          </p>
        </div>

        {/* Curva que separa la portada de la zona clara */}
        <svg aria-hidden="true" viewBox="0 0 1440 220" preserveAspectRatio="none" className="absolute inset-x-0 -bottom-px h-28 w-full sm:h-36">
          <path d="M0 150C220 70 420 40 640 110S1080 230 1440 90V220H0Z" fill="#f5f1e6" />
        </svg>
      </header>

      {/* Formulario */}
      <main className="auth-light relative z-10 mx-auto -mt-20 max-w-md px-4">
        <section className="rounded-[2rem] border border-white bg-white p-6 shadow-[0_30px_60px_-28px_rgba(80,60,10,0.45)] sm:p-8">
          <h1 className="display text-center text-[1.75rem] font-bold leading-tight min-[400px]:text-[2.1rem]">
            {title}{accent && <> <span className="whitespace-nowrap text-gold-soft">{accent}</span></>}
          </h1>
          <p className="mx-auto mb-6 mt-1.5 max-w-xs text-center text-sm text-muted">{subtitle}</p>
          {children}
          {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        </section>

        {/* Lo que ofrece la app */}
        <ul className="mt-5 grid grid-cols-4 gap-2">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="flex flex-col items-center gap-2 rounded-2xl border border-white bg-white/75 px-1.5 py-3.5 text-center shadow-[0_12px_24px_-18px_rgba(80,60,10,0.5)]">
              <Icon className="size-6 text-gold" aria-hidden="true" />
              <span className="text-[11px] font-semibold leading-tight">{label}</span>
            </li>
          ))}
        </ul>
        <p className="mt-6 flex items-center justify-center gap-3 text-[10px] font-semibold uppercase tracking-[0.35em] text-muted">
          <span className="h-px w-8 bg-line-strong" /> Más que una quiniela <span className="h-px w-8 bg-line-strong" />
        </p>
        <Ball className="mx-auto mt-3 size-5" />
      </main>
    </div>
  )
}
