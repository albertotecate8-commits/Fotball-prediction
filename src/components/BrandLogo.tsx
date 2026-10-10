import markUrl from '@/assets/brand/shabex-mark.svg'
import { brand } from '@/config/brand'
import { cn } from '@/lib/cn'

/** Símbolo compacto de SHABEX (recurso SVG del proyecto). */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return <img src={markUrl} alt="" width={size} height={size} className={cn('shrink-0', className)} style={{ width: size, height: size }} />
}

/** Versión horizontal: símbolo + «SHABEX» + «LA QUINIELA». */
export function BrandLogo({ size = 'md', className }: { size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const s = { sm: { mark: 30, word: 'text-xl', sub: 'text-[8px]' }, md: { mark: 38, word: 'text-[26px]', sub: 'text-[9px]' }, lg: { mark: 64, word: 'text-5xl', sub: 'text-xs' } }[size]
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} role="img" aria-label={brand.fullName}>
      <BrandMark size={s.mark} />
      <span className="flex flex-col leading-none" aria-hidden>
        <span className={cn('display font-bold tracking-[0.04em] text-silver', s.word)}>
          SHABE<span className="brand-x">X</span>
        </span>
        <span className={cn('mt-1 flex items-center gap-1.5 font-semibold uppercase tracking-[0.42em] text-muted', s.sub)}>
          <span className="h-px w-3 bg-aqua/70" />{brand.subline}<span className="h-px w-3 bg-red/70" />
        </span>
      </span>
    </span>
  )
}
