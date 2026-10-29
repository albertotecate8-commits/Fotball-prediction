import type { ReactNode } from 'react'
import { Lock } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { TeamCrest } from '@/components/TeamCrest'
import type { RoundDetail } from '@/types/domain'
import type { Picks } from './draftStore'

export function ReviewSheet({ open, onClose, detail, picks, submitting, onConfirm, error }: {
  open: boolean
  onClose: () => void
  detail: RoundDetail
  picks: Picks
  submitting: boolean
  onConfirm: () => void
  error: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Confirma tu quiniela" dismissible={!submitting}
      footer={
        <div className="space-y-3">
          {error}
          <p className="flex items-start gap-2 text-xs text-muted"><Lock className="mt-0.5 size-3.5 shrink-0 text-gold-soft" /> Al enviar, tus pronósticos quedan bloqueados definitivamente. El servidor registra la hora exacta del envío.</p>
          <div className="flex gap-3">
            <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>Editar</Button>
            <Button className="flex-[2]" size="lg" loading={submitting} onClick={onConfirm}>Enviar quiniela</Button>
          </div>
        </div>
      }>
      <p className="mb-3 text-sm text-muted">{detail.round.name} · {detail.matches.length} partidos</p>
      <ol className="space-y-2">
        {detail.matches.map((m) => {
          const p = picks[m.match_id]
          return (
            <li key={m.match_id} className="card-flat flex items-center gap-2 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
                <span className="truncate text-sm font-semibold"><span className="sm:hidden" title={m.home.name}>{m.home.code ?? m.home.short_name}</span><span className="hidden sm:inline">{m.home.short_name}</span></span>
                <TeamCrest team={m.home} size={26} />
              </div>
              <span className="scoreline w-16 shrink-0 text-center text-2xl text-gold-soft">{p?.home ?? '–'}:{p?.away ?? '–'}</span>
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <TeamCrest team={m.away} size={26} />
                <span className="truncate text-sm font-semibold"><span className="sm:hidden" title={m.away.name}>{m.away.code ?? m.away.short_name}</span><span className="hidden sm:inline">{m.away.short_name}</span></span>
              </div>
            </li>
          )
        })}
      </ol>
    </Sheet>
  )
}
