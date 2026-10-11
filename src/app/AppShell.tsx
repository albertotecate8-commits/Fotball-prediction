import { Link, Navigate, NavLink, Outlet, useNavigate } from 'react-router'
import { Home, Ticket, Trophy, UserRound, ShieldCheck, LogOut } from 'lucide-react'
import { cn } from '@/lib/cn'
import { isAdminPreview, setAdminPreview } from '@/lib/adminPreview'
import { useAuth } from '@/features/auth/AuthProvider'
import { useGroup } from '@/features/groups/GroupProvider'
import { Avatar } from '@/components/ui/Avatar'
import { BrandLogo } from '@/components/BrandLogo'

export const NAV = [
  { to: '/', label: 'Inicio', icon: Home, end: true },
  { to: '/quinielas', label: 'Mi quiniela', icon: Ticket, end: false },
  { to: '/clasificacion', label: 'Clasificación', icon: Trophy, end: false },
  { to: '/perfil', label: 'Mi perfil', icon: UserRound, end: false },
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
      <Link to="/perfil" aria-label="Mi perfil" className="rounded-full"><Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={36} /></Link>
    </header>
  )
}

/** El admin mirando la app como jugador: siempre a un toque de volver a su panel. */
function PreviewBanner() {
  const navigate = useNavigate()
  return (
    <div className="sticky top-0 z-40 -mx-4 flex items-center gap-2 border-b border-aqua/40 bg-aqua/15 px-4 py-2 text-xs font-semibold text-aqua backdrop-blur lg:mx-0 lg:mb-4 lg:rounded-xl lg:border">
      <ShieldCheck className="size-4 shrink-0" /> <span className="min-w-0 flex-1">Vista de participante</span>
      <button type="button" className="h-8 shrink-0 rounded-full bg-aqua px-3 font-bold text-black" onClick={() => { setAdminPreview(false); void navigate('/admin') }}>Volver al panel</button>
    </div>
  )
}

function Sidebar() {
  const { profile, signOut } = useAuth()
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
      </nav>
      <div className="mt-auto flex items-center gap-3 rounded-2xl border border-line p-3">
        <Avatar name={profile?.display_name ?? '?'} url={profile?.avatar_url} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{profile?.display_name}</div>
          <div className="truncate text-xs text-muted">{group?.name ?? 'Quiniela oficial'}</div>
        </div>
        <button type="button" onClick={() => void signOut()} aria-label="Cerrar sesión" className="grid size-9 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink">
          <LogOut className="size-4" />
        </button>
      </div>
    </aside>
  )
}

export function AppShell() {
  const { isAdmin } = useAuth()
  const preview = isAdmin && isAdminPreview()
  // El administrador entra directo a su panel; la app de jugador solo en «Vista participante».
  if (isAdmin && !preview) return <Navigate to="/admin" replace />
  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <main className="safe-bottom mx-auto w-full max-w-3xl px-4 lg:px-8 lg:pt-8 xl:max-w-4xl">
        {preview && <PreviewBanner />}
        <TopBar />
        <Outlet />
      </main>
      <BottomNav />
    </div>
  )
}
