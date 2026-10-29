import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/cn'

const control = 'w-full rounded-2xl border border-line-strong bg-surface-2/80 px-4 text-ink placeholder:text-faint transition focus:border-gold-soft focus:outline-none focus:ring-2 focus:ring-gold-soft/25 disabled:opacity-50'

type WithIcon = { icon?: ReactNode }
const iconBox = 'pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-muted [&>svg]:size-5'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & WithIcon>(function Input({ className, icon, ...rest }, ref) {
  if (!icon) return <input ref={ref} className={cn(control, 'h-12', className)} {...rest} />
  return (
    <div className="relative">
      <span className={iconBox} aria-hidden="true">{icon}</span>
      <input ref={ref} className={cn(control, 'h-12 pl-12', className)} {...rest} />
    </div>
  )
})

/** Contraseña con botón para verla y sin autocorrector ni mayúscula automática. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & WithIcon>(function PasswordInput({ className, icon, ...rest }, ref) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      {icon && <span className={iconBox} aria-hidden="true">{icon}</span>}
      <input ref={ref} type={show ? 'text' : 'password'} autoCapitalize="none" autoCorrect="off" spellCheck={false}
        className={cn(control, 'h-12 pr-12', icon && 'pl-12', className)} {...rest} />
      <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Ocultar contraseña' : 'Ver contraseña'} aria-pressed={show}
        className="absolute inset-y-0 right-1 grid w-11 place-items-center rounded-full text-muted hover:text-ink">
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  )
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(control, 'min-h-24 py-3', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return <select ref={ref} className={cn(control, 'h-12 appearance-none pr-10', className)} {...rest}>{children}</select>
})

export function Field({ label, hint, error, children, hideLabel }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; hideLabel?: boolean }) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      {/* hideLabel: la etiqueta sigue para lectores de pantalla; el texto va dentro del campo. */}
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'block text-sm font-semibold text-ink/90'}>{label}</label>
      {children(id)}
      {error ? <p className="text-xs text-danger" role="alert">{error}</p> : hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </div>
  )
}
