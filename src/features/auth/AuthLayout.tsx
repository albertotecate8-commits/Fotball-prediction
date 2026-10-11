import type { ReactNode } from 'react'
import { brand } from '@/config/brand'
import { BrandLogo } from '@/components/BrandLogo'

export function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] pt-[calc(env(safe-area-inset-top)+2rem)] lg:max-w-5xl lg:flex-row lg:items-center lg:gap-16">
      <section className="mb-8 flex flex-col items-center text-center lg:mb-0 lg:flex-1 lg:items-start lg:text-left">
        <BrandLogo size="lg" />
        <p className="mt-5 max-w-sm text-sm text-muted">{brand.description}</p>
      </section>
      <section className="card p-5 sm:p-6 lg:w-[26rem]">
        <h1 className="display text-2xl font-semibold uppercase">{title}</h1>
        <p className="mb-5 mt-1 text-sm text-muted">{subtitle}</p>
        {children}
        {footer && <div className="mt-6 text-center text-sm text-muted">{footer}</div>}
      </section>
    </div>
  )
}
