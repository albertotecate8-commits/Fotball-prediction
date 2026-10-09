import { Link } from 'react-router'
import { CalendarClock, ChevronRight, ListChecks } from 'lucide-react'
import { MyPredictionBadge, RoundPhaseBadge } from './StatusBadge'
import { formatDateTime } from '@/lib/time'
import type { RoundListItem } from '@/types/domain'

export function roundHref(r: Pick<RoundListItem, 'round_id' | 'phase' | 'my_status'>) {
  if (r.phase === 'open' && r.my_status !== 'submitted') return `/quinielas/${r.round_id}/jugar`
  return `/quinielas/${r.round_id}`
}

export function RoundCard({ round, tz }: { round: RoundListItem; tz?: string }) {
  const scored = round.my_points !== null && ['in_progress', 'closed', 'finished', 'under_review'].includes(round.phase)
  return (
    <Link to={roundHref(round)} className="card group block p-4 transition hover:border-lime/30 animate-fade-up">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap gap-1.5">
            <RoundPhaseBadge phase={round.phase} />
            <MyPredictionBadge status={round.my_status} phase={round.phase} />
          </div>
          <h3 className="display truncate text-xl font-semibold uppercase">{round.name}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1"><CalendarClock className="size-3.5" /> Cierre: <span className="capitalize">{formatDateTime(round.deadline_at, tz)}</span></span>
            <span className="inline-flex items-center gap-1"><ListChecks className="size-3.5" /> {round.match_count} partidos</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {scored && (
            <div className="text-right">
              <div className="scoreline text-3xl text-lime">{round.my_points}</div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-muted">
                pts{round.my_position ? ` · #${round.my_position}` : ''}
              </div>
            </div>
          )}
          <ChevronRight className="size-5 text-muted transition group-hover:translate-x-0.5 group-hover:text-lime" />
        </div>
      </div>
    </Link>
  )
}
