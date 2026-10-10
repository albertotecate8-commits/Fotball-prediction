import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Home, Ticket, Trophy, UserRound, Users, Shield, LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from '@/features/groups/GroupProvider'
import { GroupSwitcher } from '@/features/home/GroupSwitcher'
import { Avatar } from '@/components/ui/Avatar'
import { BrandLogo } from '@/components/BrandLogo'

export const NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/quinielas', label: 'Quiniela', icon: Ticket, end: false },
  { to: '/clasificacion', label: 'Clasificación', icon: Trophy, end: false },
  { to: '/grupos', label: 'Grupos', icon: Users, end: false },
  { to: '/perfil', label: 'Perfil', icon: UserRound, end: false },
]

/** Navegación inferior: icono + texto, el activo en rojo. */
function BottomNav() {
  return (
    <nav aria-label="Navegación principal"
      className="glass fixed inset-x-0 bottom-0 z-40 border-t border-line pb-[env(safe-area-inset-bottom)] lg:hidden">
      <ul className="mx-auto flex max-w-xl items-stretch justify-between px-2">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex-1">
            <NavLink to={to} end={end}
              className={({ isActive }) => cn('relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-semibold transition-colors',
                isActive ? 'text-red' : 'text-muted hover:text-ink')}>
              {({ isActive }) => (
                <>
                  {isActive && <span className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-red" aria-hidden />}
                  <Icon className="size-[22px]" strokeWidth={isActive ? 2.3 : 1.8} aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  )
}

/** Cabecera móvil con el logo horizontal. */
function TopBar() {
  const { profile } = useAuth()
  return (
    <header className="glass sticky top-0 z-30 -mx-4 mb-4 flex items-center gap-3 border-b border-line px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:hidden">
      <Link to="/" aria-label="Inicio" className="min-w-0 flex-1"><BrandLogo size="sm" /></Link>
      <GroupSwitcher />
      <Link to="/perfil" aria-label="Mi perfil" className="rounded-full"><Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={36} /></Link>
    </header>
  )
}

function Sidebar() {
  const { profile, isAdmin, signOut } = useAuth()
  const { group } = useGroup()
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-line bg-surface/60 px-4 py-6 lg:flex">
      <Link to="/" className="mb-8 px-2" aria-label="Inicio"><BrandLogo size="md" /></Link>
      <nav aria-label="Navegación principal" className="flex flex-col gap-1">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => cn('flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition',
              isActive ? 'bg-red/12 text-ink shadow-[inset_3px_0_0_var(--color-red)]' : 'text-muted hover:bg-white/5 hover:text-ink')}>
            {({ isActive }) => <><Icon className={cn('size-5', isActive && 'text-red')} aria-hidden /> {label}</>}
          </NavLink>
        ))}
        {isAdmin && (
          <NavLink to="/admin" className={({ isActive }) => cn('mt-4 flex h-11 items-center gap-3 rounded-xl border border-line px-3 text-sm font-semibold transition',
            isActive ? 'border-aqua/50 text-aqua' : 'text-muted hover:text-ink')}>
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
      <main className={cn('mx-auto w-full max-w-3xl px-4 lg:px-8 lg:pt-8 xl:max-w-4xl', immersive ? 'pb-40 pt-[calc(env(safe-area-inset-top)+1rem)]' : 'safe-bottom')}>
        {!immersive && <TopBar />}
        <Outlet />
      </main>
      {!immersive && <BottomNav />}
    </div>
  )
}
