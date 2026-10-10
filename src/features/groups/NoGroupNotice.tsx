import { Users } from 'lucide-react'
import { ButtonLink } from '@/components/ui/Button'

/** Aviso secundario: sin grupo activo no hay quiniela ni clasificación. */
export function NoGroupNotice({ what }: { what: string }) {
  return (
    <section className="card flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-aqua/12 text-aqua"><Users className="size-6" /></span>
      <h2 className="display text-xl font-semibold uppercase">Sin grupo activo</h2>
      <p className="max-w-sm text-sm text-muted">Para ver {what} necesitas pertenecer a un grupo. Únete con el código que te comparta el organizador.</p>
      <ButtonLink to="/grupos" variant="secondary">Ir a Grupos</ButtonLink>
    </section>
  )
}
