import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronRight, Clock, EyeOff, Goal, Lock, Minus, Ticket, Trophy, X } from 'lucide-react'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { PageHeader } from '@/components/PageHeader'
import { TeamCrest } from '@/components/TeamCrest'
import { Avatar } from '@/components/ui/Avatar'
import { ButtonLink } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { formatShortDate, formatTime } from '@/lib/time'
import { cn } from '@/lib/cn'
import type { ParticipantDetail, PickResult, StandingsRow, WeekStandings } from '@/types/domain'

const MEDAL = ['text-gold', 'text-ink/80', 'text-[#c98a4b]']

/** Clasificación de la jornada en vivo: puntos confirmados, aciertos, fallos y pendientes. */
export function LeaderboardPage() {
  const { timezone } = useAppConfig()
  const [weekId, setWeekId] = useState<string | null>(null)
  const [detail, setDetail] = useState<StandingsRow | null>(null)
  const q = useQuery({ queryKey: [...qk.poolBoard, 'standings', weekId], queryFn: () => playerApi.standings(weekId), refetchInterval: 30_000 })
  const data = q.data
  const rows = data?.rows ?? []
  const me = rows.find((r) => r.is_me)
  return (
    <div>
      <PageHeader title="Clasificación" subtitle={data?.week ? `Quiniela de la ${data.week.label.toLowerCase()}` : 'Quiniela de la semana'} />
      {data && data.weeks.length > 1 && (
        <Select aria-label="Semana" className="mb-3" value={weekId ?? data.week?.id ?? ''} onChange={(e) => setWeekId(e.target.value || null)}>
          {data.weeks.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </Select>
      )}
      {q.isLoading ? <CardSkeleton lines={6} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <>
          {data?.summary && data.week && <Summary data={data} tz={timezone} />}
          {rows.length === 0 ? (
            <EmptyState icon={<Trophy className="size-6" />} title="Aún no hay quinielas enviadas"
              description="La clasificación aparece en cuanto alguien envíe su quiniela de la semana. ¡Sé el primero!"
              action={<ButtonLink to="/quinielas" icon={<Ticket className="size-5" />}>Ir a Mi quiniela</ButtonLink>} />
          ) : (
            <>
              {me && (
                <p className="mb-3 rounded-2xl border border-aqua/40 bg-aqua/10 px-4 py-2.5 text-sm">
                  Vas <span className="font-bold text-aqua">{me.rank_position}.º</span> de {rows.length} con <span className="font-bold">{me.points} {me.points === 1 ? 'punto' : 'puntos'}</span>
                  {me.pending > 0 ? ` · te quedan ${me.pending} por definirse` : ''}
                </p>
              )}
              <ol className="space-y-2" aria-label="Clasificación">
                {rows.map((r) => <Row key={r.user_id} r={r} onOpen={() => setDetail(r)} />)}
              </ol>
              <p className="mt-4 text-xs text-faint">
                Acertar quién gana (o el empate) vale 1 punto. Solo cuentan resultados confirmados; los partidos en vivo se suman al terminar.
                Si hay empate en puntos, gana quien más se acerque al total de goles de la jornada.
              </p>
            </>
          )}
        </>
      )}
      {detail && data?.week && <DetailSheet weekId={data.week.id} row={detail} tz={timezone} onClose={() => setDetail(null)} />}
    </div>
  )
}

function Summary({ data, tz }: { data: WeekStandings; tz: string }) {
  const s = data.summary!
  const done = s.finished
  const pct = (n: number) => `${s.total ? (n / s.total) * 100 : 0}%`
  return (
    <section aria-label="Resumen de la jornada" className="card mb-4 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-aqua">Jornada actual · {data.week!.label}</p>
      </div>
      <p className="mt-1 text-lg font-semibold">
        <span className="scoreline text-2xl">{done}</span> de {s.total} finalizados
      </p>
      <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
        <span className="bg-success" style={{ width: pct(done) }} />
        <span className="animate-pulse-soft bg-live" style={{ width: pct(s.live) }} />
      </div>
      <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-success" /> {done} finalizados</li>
        <li className="flex items-center gap-1.5"><span className={cn('size-2 rounded-full bg-live', s.live > 0 && 'animate-pulse-soft')} /> {s.live} en vivo</li>
        <li className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-aqua" /> {s.pending} pendientes</li>
        {s.void > 0 && <li className="flex items-center gap-1.5 text-muted"><span className="size-2 rounded-full bg-muted" /> {s.void} aplazados/cancelados</li>}
      </ul>
      <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        {data.week!.real.counted > 0 && <span className="inline-flex items-center gap-1"><Goal className="size-3.5 text-gold" /> {data.week!.real.goals} goles en la jornada</span>}
        {data.updated_at && <span className="inline-flex items-center gap-1"><Clock className="size-3.5" /> Actualizado {formatShortDate(data.updated_at, tz)} {formatTime(data.updated_at, tz)}{data.delayed ? ' · actualización en pausa (se muestran los últimos datos guardados)' : ''}</span>}
      </p>
    </section>
  )
}

function Row({ r, onOpen }: { r: StandingsRow; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`Ver pronósticos de ${r.display_name}`}
        className={cn('card flex w-full items-center gap-3 p-3 text-left transition hover:border-aqua/40', r.is_me && 'border-aqua/60 bg-aqua/[0.06]')}>
        <span className={cn('scoreline w-7 shrink-0 text-center text-2xl', MEDAL[r.rank_position - 1] ?? 'text-muted')}>{r.rank_position}</span>
        <Avatar name={r.display_name} url={r.avatar_url} size={36} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{r.display_name}{r.is_me && <span className="ml-1.5 text-[11px] font-bold text-aqua">TÚ</span>}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 text-[11px]">
            <span className="inline-flex items-center gap-0.5 text-success" title="Aciertos confirmados"><Check className="size-3.5" />{r.hits}</span>
            <span className="inline-flex items-center gap-0.5 text-danger" title="Fallos confirmados"><X className="size-3.5" />{r.misses}</span>
            <span className="inline-flex items-center gap-0.5 text-aqua" title="Por definirse"><Clock className="size-3.5" />{r.pending}</span>
            {r.live > 0 && <span className="inline-flex items-center gap-1 text-live"><span className="size-1.5 animate-pulse-soft rounded-full bg-live" />{r.live} en vivo</span>}
            {r.guess !== null && <span className="text-muted">· {r.guess} goles</span>}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="scoreline block text-2xl leading-none">{r.points}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">pts</span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-faint" />
      </button>
    </li>
  )
}

const RESULT: Record<PickResult, { label: string; cls: string; icon: React.ReactNode }> = {
  hit: { label: 'Acierto', cls: 'text-success border-success/40 bg-success/10', icon: <Check className="size-3.5" /> },
  miss: { label: 'Fallo', cls: 'text-danger border-danger/40 bg-danger/10', icon: <X className="size-3.5" /> },
  live: { label: 'En vivo', cls: 'text-live border-live/40 bg-live/10', icon: <span className="size-1.5 animate-pulse-soft rounded-full bg-live" /> },
  pending: { label: 'Pendiente', cls: 'text-aqua border-aqua/30 bg-aqua/10', icon: <Clock className="size-3.5" /> },
  unconfirmed: { label: 'Sin resultado definitivo', cls: 'text-gold border-gold/40 bg-gold/10', icon: <Clock className="size-3.5" /> },
  void: { label: 'Sin resultado', cls: 'text-muted border-line bg-white/5', icon: <Minus className="size-3.5" /> },
  none: { label: 'Sin pronóstico', cls: 'text-muted border-line bg-white/5', icon: <Minus className="size-3.5" /> },
}

function DetailSheet({ weekId, row, tz, onClose }: { weekId: string; row: StandingsRow; tz: string; onClose: () => void }) {
  const q = useQuery({ queryKey: [...qk.poolBoard, 'participant', weekId, row.user_id], queryFn: () => playerApi.participant(weekId, row.user_id), refetchInterval: 30_000 })
  const d: ParticipantDetail | undefined = q.data
  const pickLabel = (m: ParticipantDetail['matches'][number]) =>
    m.pick === '1' ? `Gana ${m.home.short_name}` : m.pick === '2' ? `Gana ${m.away.short_name}` : m.pick === 'X' ? 'Empate' : null
  return (
    <Sheet open onClose={onClose} title={row.is_me ? 'Mis pronósticos' : `Pronósticos de ${row.display_name}`}>
      <div className="space-y-3">
        <dl className="grid grid-cols-4 gap-2 text-center">
          <div className="card-flat p-2"><dt className="text-[10px] uppercase text-muted">Puntos</dt><dd className="scoreline text-xl">{row.points}</dd></div>
          <div className="card-flat p-2"><dt className="text-[10px] uppercase text-success">Aciertos</dt><dd className="scoreline text-xl text-success">{row.hits}</dd></div>
          <div className="card-flat p-2"><dt className="text-[10px] uppercase text-danger">Fallos</dt><dd className="scoreline text-xl text-danger">{row.misses}</dd></div>
          <div className="card-flat p-2"><dt className="text-[10px] uppercase text-aqua">Faltan</dt><dd className="scoreline text-xl text-aqua">{row.pending}</dd></div>
        </dl>
        {d?.guess != null && <p className="text-xs text-muted"><Goal className="mr-1 inline size-3.5 text-gold" />Total de goles de la jornada: <span className="font-semibold text-ink">{d.guess}</span></p>}
        {q.isLoading ? <CardSkeleton lines={4} /> : q.error ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
          <ul className="space-y-2">
            {(d?.matches ?? []).map((m) => {
              const r = RESULT[m.hidden ? 'pending' : m.result]
              const score = m.home_goals !== null && (m.status === 'live' || m.status === 'finished' || m.status === 'suspended')
              return (
                <li key={m.match_id} className="card-flat p-2.5">
                  <div className="flex items-center gap-2 text-sm">
                    <TeamCrest team={m.home} size={22} />
                    <span className="min-w-0 flex-1 truncate font-semibold">{m.home.short_name}</span>
                    <span className="scoreline shrink-0 text-base">{score ? `${m.home_goals}-${m.away_goals}` : formatTime(m.kickoff_at, tz)}</span>
                    <span className="min-w-0 flex-1 truncate text-right font-semibold">{m.away.short_name}</span>
                    <TeamCrest team={m.away} size={22} />
                  </div>
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                    <span className="truncate text-muted">
                      {m.hidden ? <span className="inline-flex items-center gap-1"><EyeOff className="size-3.5" /> Envía tu quiniela para verlo</span>
                        : pickLabel(m) ? <><Lock className="mr-0.5 inline size-3 text-faint" />Pronóstico: <span className="font-semibold text-ink">{pickLabel(m)}</span></> : <span className="capitalize">{formatShortDate(m.kickoff_at, tz)}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {m.points !== null && <span className="font-bold text-ink">+{m.points}</span>}
                      <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-semibold', r.cls)}>{r.icon}{m.hidden ? 'Oculto' : r.label}</span>
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-[11px] text-faint">Con tu pago confirmado y tu quiniela enviada ves lo que eligió cada participante. Los pronósticos enviados ya no se pueden cambiar. Un partido en vivo o sin resultado confirmado no cuenta como fallo.</p>
      </div>
    </Sheet>
  )
}
