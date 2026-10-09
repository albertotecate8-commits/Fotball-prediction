import type { ReactNode } from 'react'
import { Trophy } from 'lucide-react'
import { brand } from '@/config/brand'
import { HeroArt } from '@/components/HeroArt'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+1rem)] lg:max-w-5xl lg:flex-row lg:items-center lg:gap-12">
      <section className="relative -mx-4 mb-6 h-64 overflow-hidden sm:mx-0 sm:rounded-[var(--radius-xl2)] lg:mb-0 lg:h-[34rem] lg:flex-1">
        <HeroArt />
        <div className="absolute inset-x-0 bottom-0 p-6">
          <span className="mb-3 inline-flex items-center gap-2 rounded-full border border-lime/30 bg-bg/60 px-3 py-1 text-xs font-bold uppercase tracking-wider text-lime backdrop-blur">
            <Trophy className="size-3.5" /> {brand.name}
          </span>
          <p className="display text-3xl font-semibold uppercase leading-[1.05] lg:text-5xl">{brand.tagline}</p>
          <p className="mt-2 max-w-sm text-sm text-muted">{brand.description}</p>
        </div>
      </section>
      <section className="lg:w-[26rem]">
        <h1 className="display text-3xl font-semibold uppercase">{title}</h1>
        <p className="mb-6 mt-1 text-sm text-muted">{subtitle}</p>
        {children}
        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
        <p className="mt-8 text-center text-[11px] text-faint">{brand.legalNotice}</p>
      </section>
    </div>
  )
}
