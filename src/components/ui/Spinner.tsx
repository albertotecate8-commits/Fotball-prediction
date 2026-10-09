import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn('size-5 animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function FullPageSpinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div className="grid min-h-[60dvh] place-items-center text-muted" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="size-7 text-lime" />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
