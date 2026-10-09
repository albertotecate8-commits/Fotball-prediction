import { NavLink, Outlet, useLocation } from 'react-router'
import { Home, Ticket, Trophy, UserRound, Shield, LogOut } from 'lucide-react'
import { brand } from '@/config/brand'
import { cn } from '@/lib/cn'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from '@/features/groups/GroupProvider'
import { Avatar } from '@/components/ui/Avatar'

export const NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/quinielas', label: 'Quinielas', icon: Ticket, end: false },
  { to: '/clasificacion', label: 'Clasificación', icon: Trophy, end: false },
  { to: '/perfil', label: 'Perfil', icon: UserRound, end: false },
]

/** Barra inferior flotante con botones circulares (referencia visual). */
function BottomNav() {
  return (
    <nav aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden">
      <ul className="glass flex items-center gap-2 rounded-full border border-line p-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to}>
            <NavLink to={to} end={end} aria-label={label}
              className={({ isActive }) => cn(
                'relative grid size-14 place-items-center rounded-full border transition-all duration-200',
                isActive ? 'border-lime/60 bg-lime text-bg shadow-lime' : 'border-line bg-surface-2/90 text-ink/80 hover:text-ink',
              )}>
              {({ isActive }) => (
                <>
                  <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 1.8} aria-hidden />
                  <span className="sr-only">{label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function Sidebar() {
  const { profile, isAdmin, signOut } = useAuth()
  const { group } = useGroup()
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface/40 px-4 py-6 backdrop-blur lg:flex">
      <div className="mb-8 flex items-center gap-2 px-2">
        <span className="grid size-9 place-items-center rounded-xl bg-lime text-bg"><Trophy className="size-5" /></span>
        <span className="display text-lg font-semibold uppercase leading-none">{brand.name}</span>
      </div>
      <nav aria-label="Navegación principal" className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cn('flex h-12 items-center gap-3 rounded-full px-4 text-sm font-semibold transition',
              isActive ? 'bg-lime text-bg' : 'text-ink/80 hover:bg-white/5 hover:text-ink')}>
            <Icon className="size-5" aria-hidden /> {label}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink to="/admin" className={({ isActive }) => cn('mt-4 flex h-12 items-center gap-3 rounded-full border border-line px-4 text-sm font-semibold transition',
            isActive ? 'border-lime text-lime' : 'text-muted hover:text-ink')}>
            <Shield className="size-5" aria-hidden /> Administración
          </NavLink>
        )}
      </nav>
      <div className="mt-auto flex items-center gap-3 rounded-2xl border border-line p-3">
        <Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{profile?.display_name}</div>
          <div className="truncate text-xs text-muted">{group?.name ?? 'Sin grupo'}</div>
        </div>
        <button type="button" onClick={() => void signOut()} aria-label="Cerrar sesión" className="grid size-9 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink">
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  )
}

export function AppShell() {
  const { pathname } = useLocation()
  // La pantalla de captura de quiniela usa toda la altura (barra de envío propia).
  const immersive = /\/jugar$/.test(pathname)
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className={cn('mx-auto w-full max-w-3xl px-4 xl:max-w-4xl pt-[calc(env(safe-area-inset-top)+1rem)] lg:px-8 lg:pt-8', immersive ? 'pb-40' : 'safe-bottom')}>
        <Outlet />
      </main>
      {!immersive && <BottomNav />}
    </div>
  )
}
