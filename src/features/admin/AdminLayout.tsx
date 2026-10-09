import { NavLink, Outlet } from 'react-router'
import { cn } from '@/lib/cn'

const LINKS = [
  { to: '/admin', label: 'Resumen', end: true },
  { to: '/admin/jornadas', label: 'Jornadas' },
  { to: '/admin/resultados', label: 'Resultados' },
  { to: '/admin/participantes', label: 'Participantes' },
  { to: '/admin/grupos', label: 'Grupos' },
  { to: '/admin/auditoria', label: 'Auditoría' },
]

export function AdminLayout() {
  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-lime">Administración</div>
      <nav aria-label="Secciones de administración" className="no-scrollbar -mx-4 mb-6 flex gap-2 overflow-x-auto px-4 pb-1">
        {LINKS.map((l) => (
          <NavLink key={l.to} to={l.to} end={l.end}
            className={({ isActive }) => cn('h-10 shrink-0 rounded-full border px-4 text-sm font-semibold leading-10 transition',
              isActive ? 'border-lime bg-lime text-bg' : 'border-line-strong bg-surface/60 text-ink/85 hover:bg-surface-2')}>
            {l.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  )
}
