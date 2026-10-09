import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Modal accesible: hoja inferior en móvil, diálogo centrado en escritorio. */
export function Sheet({ open, onClose, title, children, footer, className, dismissible = true }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  className?: string
  dismissible?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog ref={ref} aria-label={title}
      onCancel={(e) => { e.preventDefault(); if (dismissible) onClose() }}
      onClick={(e) => { if (dismissible && e.target === ref.current) onClose() }}
      className={cn(
        'm-0 mt-auto w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-black/70 backdrop:backdrop-blur-sm',
        'sm:m-auto sm:max-w-lg',
      )}>
      {open && (
        <div className={cn('card flex max-h-[92dvh] flex-col rounded-b-none border-b-0 animate-fade-up sm:rounded-b-[var(--radius-card)] sm:border-b', className)}>
          <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
            <h2 className="display text-xl font-semibold uppercase">{title}</h2>
            {dismissible && (
              <button type="button" onClick={onClose} aria-label="Cerrar" className="grid size-9 place-items-center rounded-full bg-surface-2 text-muted hover:text-ink">
                <X className="size-4" />
              </button>
            )}
          </div>
          <div className="overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="border-t border-line px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">{footer}</div>}
        </div>
      )}
    </dialog>
  )
}
