import { Link, NavLink, Outlet, useNavigate } from 'react-router'
import { Eye, LogOut, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/cn'
import { setAdminPreview } from '@/lib/adminPreview'
import { useAuth } from '@/features/auth/AuthProvider'
import { BrandLogo } from '@/components/BrandLogo'

const LINKS = [
  { to: '/admin', label: 'Próxima quiniela', end: true },
  { to: '/admin/equipos', label: 'Equipos', end: false },
  { to: '/admin/resultados', label: 'Resultados', end: false },
  { to: '/admin/participantes', label: 'Participantes y pagos', end: false },
  { to: '/admin/consumo', label: 'Consumo API', end: false },
]

/** Panel exclusivo del administrador: sin la navegación de jugadores. */
export function AdminShell() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const preview = () => { setAdminPreview(true); void navigate('/') }
  return (
    <div className="min-h-dvh">
      <header className="glass sticky top-0 z-30 border-b border-line pt-[env(safe-area-inset-top)]">
        <div className="mx-auto flex max-w-4xl items-center gap-2 px-4 py-3">
          <Link to="/admin" aria-label="Panel de administración" className="min-w-0"><BrandLogo size="xs" /></Link>
          <span className="hidden shrink-0 items-center gap-1 rounded-full border border-gold-soft/40 min-[400px]:inline-flex bg-gold-soft/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gold-soft">
            <ShieldCheck className="size-3.5" /> Admin
          </span>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <button type="button" onClick={preview} aria-label="Vista participante" className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line-strong px-3 text-xs font-bold text-ink hover:bg-white/5">
              <Eye className="size-4" /> <span className="hidden min-[380px]:inline">Vista participante</span><span className="min-[380px]:hidden">Vista</span>
            </button>
            <button type="button" onClick={() => void signOut()} aria-label="Cerrar sesión" className="grid size-9 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink">
              <LogOut className="size-4" />
            </button>
          </div>
        </div>
        <nav aria-label="Secciones de administración" className="no-scrollbar mx-auto flex max-w-4xl gap-2 overflow-x-auto px-4 pb-3">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end}
              className={({ isActive }) => cn('h-9 shrink-0 rounded-full border px-4 text-sm font-semibold leading-9 transition',
                isActive ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface/60 text-ink/85 hover:bg-surface-2')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-4xl px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-5">
        <Outlet />
        <p className="mt-10 text-center text-[11px] text-faint">Sesión de administración · {profile?.display_name}</p>
      </main>
    </div>
  )
}
