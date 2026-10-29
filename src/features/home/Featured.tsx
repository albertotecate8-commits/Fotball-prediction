import { Link } from 'react-router'
import { ChevronRight, Star, Ticket } from 'lucide-react'
import { TeamCrest } from '@/components/TeamCrest'
import { LiveBadge, Badge } from '@/components/ui/Badge'
import { ButtonLink } from '@/components/ui/Button'
import { MATCH_STATUS_LABEL } from '@/components/StatusBadge'
import { formatShortDate, formatTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { FeaturedMatch, Team } from '@/types/domain'

const team = (t: FeaturedMatch['data']['home']): Team => ({ name: t.name, short_name: t.short_name || t.name, code: null, logo_url: t.logo_url })
const hasScore = (m: FeaturedMatch) => (m.status === 'live' || m.status === 'finished') && m.data.home_goals !== null

/** Acción real para un destacado: solo se pronostica si el admin lo incluyó en una jornada. */
function featuredAction(m: FeaturedMatch) {
  if (m.in_round_id) return { to: '/quinielas', label: 'Hacer pronóstico', primary: false }
  return { to: '/quinielas', label: 'Ir a Mi quiniela', primary: false }
}

function Meta({ m }: { m: FeaturedMatch }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted">
      {m.data.competition && (
        <span className="inline-flex items-center gap-1.5">
          {m.data.competition.logo_url && <img src={m.data.competition.logo_url} alt="" className="size-4 object-contain" referrerPolicy="no-referrer" loading="lazy" />}
          {m.data.competition.name}
        </span>
      )}
    </div>
  )
}

/** El gran encuentro: compacto, sin efectos que estorben la lectura. */
export function FeaturedHero({ match: m, tz }: { match: FeaturedMatch; tz: string }) {
  const action = featuredAction(m)
  return (
    <article className="card overflow-hidden" aria-label={`${m.data.home.name} contra ${m.data.away.name}`}>
      <div className="h-0.5 bg-gradient-to-r from-gold via-transparent to-gold" aria-hidden />
      <div className="p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-gold"><Star className="size-3.5" /> Partido destacado</span>
          {m.status === 'live' ? <LiveBadge minute={m.data.elapsed} /> : m.status !== 'scheduled' ? <Badge tone={m.status === 'finished' ? 'neutral' : 'danger'}>{MATCH_STATUS_LABEL[m.status]}</Badge> : null}
        </div>
        <Meta m={m} />
        <div className="mt-3 flex items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <TeamCrest team={team(m.data.home)} size={56} />
            <span className="line-clamp-2 text-sm font-semibold leading-tight">{m.data.home.name}</span>
          </div>
          <div className="flex w-24 shrink-0 flex-col items-center">
            {hasScore(m) ? (
              <span className="scoreline text-4xl" aria-label={`${m.data.home_goals} a ${m.data.away_goals}`}>{m.data.home_goals}<span className="mx-1 text-faint">:</span>{m.data.away_goals}</span>
            ) : (
              <>
                <span className="scoreline text-3xl">{formatTime(m.kickoff_at, tz)}</span>
                <span className="mt-1 text-xs capitalize text-muted">{formatShortDate(m.kickoff_at, tz)}</span>
              </>
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">
            <TeamCrest team={team(m.data.away)} size={56} />
            <span className="line-clamp-2 text-sm font-semibold leading-tight">{m.data.away.name}</span>
          </div>
        </div>
        <ButtonLink to={action.to} variant={action.primary ? 'primary' : 'secondary'} block className="mt-4" icon={<Ticket className="size-4" />}>{action.label}</ButtonLink>
        {!m.in_round_id && <p className="mt-2 text-center text-[11px] text-faint">Este partido no forma parte de la quiniela oficial.</p>}
      </div>
    </article>
  )
}

/** Fila compacta para listas (próximos, en vivo). */
export function FeaturedRow({ match: m, tz }: { match: FeaturedMatch; tz: string }) {
  const action = featuredAction(m)
  return (
    <Link to={action.to} className={cn('card-flat group flex items-center gap-3 border-l-2 px-3 py-2.5 transition hover:border-r-line-strong',
      m.status === 'live' ? 'border-l-live' : m.in_round_id ? 'border-l-gold-soft' : 'border-l-line-strong')}>
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-1.5 truncate text-[11px] text-muted">
          {m.data.competition?.name ?? m.reason}
          {m.in_round_id && <Badge tone="accent" className="px-1.5 py-0 text-[9px]">En tu quiniela</Badge>}
        </div>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TeamCrest team={team(m.data.home)} size={22} />
          <span className="truncate">{m.data.home.short_name}</span>
          <span className="text-xs font-normal text-faint">vs</span>
          <span className="truncate">{m.data.away.short_name}</span>
          <TeamCrest team={team(m.data.away)} size={22} />
        </div>
      </div>
      <div className="w-16 shrink-0 text-right">
        {hasScore(m) ? <div className="scoreline text-xl">{m.data.home_goals}:{m.data.away_goals}</div> : <div className="scoreline text-lg">{formatTime(m.kickoff_at, tz)}</div>}
        <div className={cn('text-[10px] font-semibold uppercase tracking-wider', m.status === 'live' ? 'text-live' : 'text-muted')}>
          {m.status === 'live' ? `En vivo${m.data.elapsed ? ` ${m.data.elapsed}'` : ''}` : m.status === 'finished' ? 'Final' : formatShortDate(m.kickoff_at, tz)}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-faint transition group-hover:text-gold-soft" />
    </Link>
  )
}

