import type { ReactNode } from 'react'
import { TeamCrest } from './TeamCrest'
import { MatchStatusBadge } from './StatusBadge'
import { TestDataBadge } from '@/components/ui/Badge'
import { formatShortDate, formatTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { MatchStatus, Team } from '@/types/domain'

export interface MatchCardData {
  kickoff_at: string
  status: MatchStatus
  elapsed?: number | null
  home_goals: number | null
  away_goals: number | null
  result_confirmed?: boolean
  is_test_data?: boolean
  home: Team
  away: Team
}

const showsScore = (s: MatchStatus) => s === 'live' || s === 'finished' || s === 'suspended' || s === 'abandoned'

function TeamSide({ team, align }: { team: Team; align: 'left' | 'right' }) {
  return (
    <div className={cn('flex min-w-0 flex-1 flex-col items-center gap-2 text-center')}>
      <TeamCrest team={team} size={52} />
      <span className={cn('line-clamp-2 text-sm font-semibold leading-tight', align === 'left' ? '' : '')} title={team.name}>{team.short_name}</span>
    </div>
  )
}

/** Tarjeta de partido estilo «Live Game» de la referencia. */
export function MatchCard({ match, tz, footer, className }: { match: MatchCardData; tz?: string; footer?: ReactNode; className?: string }) {
  const hasScore = showsScore(match.status) && match.home_goals !== null
  return (
    <article className={cn('card p-4', match.status === 'live' && 'border-live/30', className)}>
      <div className="flex items-center gap-2">
        <TeamSide team={match.home} align="left" />
        <div className="flex w-28 shrink-0 flex-col items-center gap-1.5">
          <MatchStatusBadge status={match.status} elapsed={match.elapsed} confirmed={match.result_confirmed} />
          {hasScore ? (
            <span className="scoreline text-4xl" aria-label={`${match.home_goals} a ${match.away_goals}`}>
              {match.home_goals}<span className="mx-1 text-muted">:</span>{match.away_goals}
            </span>
          ) : (
            <>
              <span className="scoreline text-3xl">{formatTime(match.kickoff_at, tz)}</span>
              <span className="text-xs capitalize text-muted">{formatShortDate(match.kickoff_at, tz)}</span>
            </>
          )}
        </div>
        <TeamSide team={match.away} align="right" />
      </div>
      {(match.is_test_data || footer) && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 border-t border-line pt-3 text-xs text-muted">
          {match.is_test_data && <TestDataBadge />}
          {footer}
        </div>
      )}
    </article>
  )
}

/** Versión compacta en una fila (listas de próximos partidos). */
export function MatchRow({ match, tz, meta }: { match: MatchCardData; tz?: string; meta?: ReactNode }) {
  const hasScore = showsScore(match.status) && match.home_goals !== null
  return (
    <div className="card-flat flex items-center gap-3 px-3 py-3">
      <div className="flex min-w-0 flex-1 items-center justify-end gap-2 text-right">
        <span className="truncate text-sm font-semibold">{match.home.short_name}</span>
        <TeamCrest team={match.home} size={30} />
      </div>
      <div className="flex w-20 shrink-0 flex-col items-center">
        {hasScore ? (
          <span className="scoreline text-xl">{match.home_goals}:{match.away_goals}</span>
        ) : (
          <span className="scoreline text-lg">{formatTime(match.kickoff_at, tz)}</span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          {match.status === 'live' ? <span className="text-live">En vivo</span> : formatShortDate(match.kickoff_at, tz)}
        </span>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <TeamCrest team={match.away} size={30} />
        <span className="truncate text-sm font-semibold">{match.away.short_name}</span>
      </div>
      {meta}
    </div>
  )
}
