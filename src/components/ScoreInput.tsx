import { useRef } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Campo de goles táctil: solo enteros 0..max. Botones ± para pulgares. */
export function ScoreInput({ value, onChange, max, label, disabled }: {
  value: number | null
  onChange: (v: number | null) => void
  max: number
  label: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const set = (v: number | null) => onChange(v === null ? null : Math.max(0, Math.min(max, v)))
  return (
    <div className="flex flex-col items-center gap-1.5">
      <button type="button" aria-label={`Sumar gol: ${label}`} disabled={disabled || (value ?? -1) >= max}
        onClick={() => set((value ?? -1) + 1)}
        className="grid h-8 w-14 place-items-center rounded-full border border-line bg-surface-2 text-muted transition hover:text-aqua active:scale-95 disabled:opacity-30">
        <Plus className="size-4" />
      </button>
      <input
        ref={ref}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={label}
        disabled={disabled}
        value={value ?? ''}
        placeholder="–"
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(-2)
          if (digits === '') return set(null)
          set(Number(digits))
        }}
        className={cn(
          'scoreline h-16 w-14 rounded-2xl border bg-bg/70 text-center text-4xl text-ink transition placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-aqua/40',
          value === null ? 'border-line-strong' : 'border-aqua/60',
        )}
      />
      <button type="button" aria-label={`Restar gol: ${label}`} disabled={disabled || value === null || value <= 0}
        onClick={() => set((value ?? 0) - 1)}
        className="grid h-8 w-14 place-items-center rounded-full border border-line bg-surface-2 text-muted transition hover:text-aqua active:scale-95 disabled:opacity-30">
        <Minus className="size-4" />
      </button>
    </div>
  )
}
