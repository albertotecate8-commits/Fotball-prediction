import { cn } from '@/lib/cn'

/** Pestañas tipo píldora (activa en verde lima), como en la referencia. */
export function PillTabs<T extends string>({ value, onChange, options, className, label }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; count?: number }[]
  className?: string
  label: string
}) {
  return (
    <div role="tablist" aria-label={label} className={cn('no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button key={o.value} role="tab" aria-selected={active} type="button" onClick={() => onChange(o.value)}
            className={cn(
              'h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition',
              active ? 'border-red bg-red text-white shadow-red' : 'border-line-strong bg-surface/60 text-ink/85 hover:bg-surface-2',
            )}>
            {o.label}
            {o.count !== undefined && <span className={cn('ml-1.5 text-xs', active ? 'text-white/75' : 'text-muted')}>{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
