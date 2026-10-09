import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ChevronLeft } from 'lucide-react'
import { IconButton } from '@/components/ui/Button'

/** Encabezado con botones circulares, como en la referencia. */
export function PageHeader({ title, subtitle, back, actions }: { title: string; subtitle?: ReactNode; back?: boolean | string; actions?: ReactNode }) {
  const navigate = useNavigate()
  return (
    <header className="mb-5 flex items-center gap-3">
      {back && (
        <IconButton label="Volver" onClick={() => (typeof back === 'string' ? navigate(back) : navigate(-1))}>
          <ChevronLeft className="size-5" />
        </IconButton>
      )}
      <div className={back ? 'min-w-0 flex-1 text-center' : 'min-w-0 flex-1'}>
        <h1 className="display truncate text-2xl font-semibold uppercase sm:text-3xl">{title}</h1>
        {subtitle && <div className="truncate text-sm text-muted">{subtitle}</div>}
      </div>
      {actions ?? (back ? <span className="size-11" aria-hidden /> : null)}
    </header>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 mt-7 flex items-center justify-between">
      <h2 className="display text-lg font-semibold uppercase tracking-wide">{children}</h2>
      {action}
    </div>
  )
}
