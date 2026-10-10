import type { ReactNode } from 'react'
import { AlertTriangle, RotateCw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { Button } from './Button'

export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn('card-flat pitch-lines flex flex-col items-center gap-3 px-6 py-10 text-center animate-fade-up', className)}>
      {icon && <div className="grid size-14 place-items-center rounded-full border border-line bg-surface-2 text-aqua">{icon}</div>}
      <h3 className="display text-xl font-semibold uppercase">{title}</h3>
      {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      {action}
    </div>
  )
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('card-flat flex flex-col items-center gap-3 border-danger/30 px-6 py-8 text-center', className)}>
      <AlertTriangle className="size-7 text-danger" aria-hidden />
      <p className="text-sm text-ink">{errorMessage(error)}</p>
      {onRetry && <Button variant="secondary" size="sm" icon={<RotateCw className="size-4" />} onClick={onRetry}>Reintentar</Button>}
    </div>
  )
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null
  return <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{errorMessage(error)}</p>
}
