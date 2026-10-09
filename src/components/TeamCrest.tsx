import { useState } from 'react'
import { cn } from '@/lib/cn'
import type { Team } from '@/types/domain'

// Paleta discreta para escudos de respaldo (cuando no hay imagen con permisos).
const HUES = [72, 140, 190, 220, 260, 330, 20, 45]
const hueFor = (s: string) => HUES[[...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % HUES.length]!

export function TeamCrest({ team, size = 44, className }: { team: Pick<Team, 'name' | 'short_name' | 'code' | 'logo_url'>; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  const label = (team.code ?? team.short_name.replace(/[^A-Za-zÁÉÍÓÚÑ ]/g, '').split(' ').map((w) => w[0]).join('')).slice(0, 3).toUpperCase()
  if (team.logo_url && !failed) {
    return (
      <img src={team.logo_url} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}
        className={cn('shrink-0 object-contain drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]', className)} style={{ width: size, height: size }} />
    )
  }
  const h = hueFor(team.name)
  return (
    <span aria-hidden className={cn('relative inline-grid shrink-0 place-items-center', className)} style={{ width: size, height: size }}>
      <svg viewBox="0 0 40 46" className="absolute inset-0 size-full">
        <defs>
          <linearGradient id={`g${h}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={`hsl(${h} 45% 42%)`} />
            <stop offset="1" stopColor={`hsl(${h} 50% 18%)`} />
          </linearGradient>
        </defs>
        <path d="M20 1 38 7v15c0 11-8 19-18 23C10 41 2 33 2 22V7z" fill={`url(#g${h})`} stroke="rgba(255,255,255,.35)" strokeWidth="1.5" />
      </svg>
      <span className="display relative text-[0.32em] font-bold text-white" style={{ fontSize: size * 0.28 }}>{label}</span>
    </span>
  )
}
