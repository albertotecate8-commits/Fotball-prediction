import logoUrl from '@/assets/brand/gb-quinela-logo.webp'
import markUrl from '@/assets/brand/gb-quinela-mark.webp'
import { brand } from '@/config/brand'
import { cn } from '@/lib/cn'

/**
 * Logo oficial de GB QUINELA (src/assets/brand). El original completo se usa
 * donde hay espacio; en tamaños chicos, el emblema (corona, GB y balón) recortado
 * del mismo archivo, sin redibujar nada.
 */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  return <img src={markUrl} alt="" width={size} height={size} decoding="async"
    className={cn('shrink-0 rounded-lg object-cover ring-1 ring-gold/25', className)} style={{ width: size, height: size }} />
}

/** Logo completo (con «QUINELA»): inicio de sesión y portada. Tamaño fijo para que no salte al cargar. */
export function BrandLogoFull({ size = 176, className }: { size?: number; className?: string }) {
  return <img src={logoUrl} alt={brand.fullName} width={size} height={size} loading="eager" fetchPriority="high"
    className={cn('shrink-0 rounded-3xl object-cover shadow-[0_18px_50px_-20px_rgba(212,175,55,0.55)] ring-1 ring-gold/30', className)} style={{ width: size, height: size }} />
}

/** Versión horizontal para encabezados: emblema + «GB QUINELA». */
export function BrandLogo({ size = 'md', className }: { size?: 'xs' | 'sm' | 'md' | 'lg'; className?: string }) {
  if (size === 'lg') return <BrandLogoFull className={className} />
  const s = { xs: { mark: 32, word: 'text-[19px]', sub: 'text-[7px]' }, sm: { mark: 36, word: 'text-[22px]', sub: 'text-[8px]' }, md: { mark: 44, word: 'text-[26px]', sub: 'text-[9px]' } }[size]
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} role="img" aria-label={brand.fullName}>
      <BrandMark size={s.mark} />
      <span className="flex flex-col leading-none" aria-hidden>
        <span className={cn('display whitespace-nowrap font-bold tracking-[0.05em]', s.word)}>
          <span className="gold-text">GB</span> <span className="text-silver">QUINELA</span>
        </span>
        <span className={cn('mt-1 flex items-center gap-1.5 whitespace-nowrap font-semibold uppercase tracking-[0.38em] text-gold/80', s.sub)}>
          <span className="h-px w-3 bg-gold/60" />{brand.subline}<span className="h-px w-3 bg-gold/60" />
        </span>
      </span>
    </span>
  )
}
