import { brand } from '@/config/brand'
import { cn } from '@/lib/cn'

/** Fondo deportivo: foto local con licencia si existe, si no ilustración propia. */
export function HeroArt({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]', className)}>
      {brand.heroImage ? (
        <img src={brand.heroImage} alt="" className="size-full object-cover opacity-60" />
      ) : (
        <svg viewBox="0 0 400 220" preserveAspectRatio="xMidYMid slice" className="size-full">
          <defs>
            <radialGradient id="flood1" cx="0.15" cy="-0.1" r="0.7">
              <stop offset="0" stopColor="#d4af37" stopOpacity="0.35" />
              <stop offset="1" stopColor="#d4af37" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="flood2" cx="0.9" cy="-0.15" r="0.6">
              <stop offset="0" stopColor="#dce2ea" stopOpacity="0.18" />
              <stop offset="1" stopColor="#dce2ea" stopOpacity="0" />
            </radialGradient>
            <linearGradient id="turf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#121720" stopOpacity="0" />
              <stop offset="1" stopColor="#121720" stopOpacity="0.45" />
            </linearGradient>
          </defs>
          <rect width="400" height="220" fill="url(#flood1)" />
          <rect width="400" height="220" fill="url(#flood2)" />
          <g transform="translate(0 110)" opacity="0.9">
            <path d="M-40 110 L120 0 H280 L440 110 Z" fill="url(#turf)" />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <path key={i} d={`M${120 + i * 32} 0 L${-40 + i * 96} 110`} stroke="#d4af37" strokeOpacity="0.06" strokeWidth="14" />
            ))}
            <path d="M120 0 H280 L440 110 H-40 Z" fill="none" stroke="#d4af37" strokeOpacity="0.28" strokeWidth="1.2" />
            <path d="M200 0 V110" stroke="#d4af37" strokeOpacity="0.22" strokeWidth="1" />
            <ellipse cx="200" cy="46" rx="62" ry="22" fill="none" stroke="#d4af37" strokeOpacity="0.22" strokeWidth="1" />
          </g>
          {[30, 70, 330, 370].map((x, i) => (
            <g key={x} opacity={0.5 - i * 0.05}>
              <rect x={x - 10} y="8" width="20" height="8" rx="2" fill="#dce2ea" opacity="0.5" />
            </g>
          ))}
        </svg>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/40 to-transparent" />
    </div>
  )
}
