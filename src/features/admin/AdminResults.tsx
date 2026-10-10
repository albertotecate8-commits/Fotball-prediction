import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Clock, Pencil } from 'lucide-react'
import { adminApi, type AdminMatch } from '@/services/admin'
import { qk } from '@/services/queryKeys'
import { useAppConfig } from '@/hooks/useAppConfig'
import { formatShortDate, formatTime } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { TeamCrest } from '@/components/TeamCrest'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/Field'
import { CardSkeleton } from '@/components/ui/Skeleton'
import { EmptyState, ErrorState } from '@/components/ui/States'
import { useToast } from '@/components/ui/Toast'
import { ROUND_STATUS } from './AdminRounds'

const done = (m: AdminMatch) => (m.status === 'finished' && m.result_confirmed) || ['cancelled', 'abandoned', 'postponed'].includes(m.status)

/** Captura directa de marcadores oficiales de la jornada. */
export function AdminResults() {
  const { timezone } = useAppConfig()
  const rounds = useQuery({ queryKey: qk.admin.rounds, queryFn: adminApi.rounds })
  const list = useMemo(() => (rounds.data ?? []).filter((r) => r.status !== 'draft'), [rounds.data])
  const [roundId, setRoundId] = useState('')
  useEffect(() => { if (!roundId && list[0]) setRoundId(list[0].id) }, [list, roundId])
  const round = useQuery({ queryKey: qk.admin.round(roundId), queryFn: () => adminApi.round(roundId), enabled: !!roundId })
  const matches = (round.data?.round_matches ?? []).map((rm) => rm.match)
  const pending = matches.filter((m) => !done(m)).length

  return (
    <div>
      <h1 className="display mb-4 text-3xl font-semibold uppercase">Capturar resultados</h1>
      {rounds.isLoading ? <CardSkeleton /> : rounds.error ? <ErrorState error={rounds.error} onRetry={() => void rounds.refetch()} /> : list.length === 0 ? (
        <EmptyState title="No hay jornadas publicadas" description="Publica una jornada desde «Jornada» para capturar sus resultados." />
      ) : (
        <>
          <label className="mb-3 block">
            <span className="sr-only">Jornada</span>
            <Select value={roundId} onChange={(e) => setRoundId(e.target.value)}>
              {list.map((r) => <option key={r.id} value={r.id}>{r.name} · {ROUND_STATUS[r.status].label}</option>)}
            </Select>
          </label>
          {round.isLoading ? <CardSkeleton lines={5} /> : round.error ? <ErrorState error={round.error} onRetry={() => void round.refetch()} /> : (
            <>
              <p className={cn('mb-3 flex items-center gap-2 text-sm font-semibold', pending ? 'text-gold' : 'text-success')}>
                {pending ? <><Clock className="size-4" /> {pending} {pending === 1 ? 'partido pendiente' : 'partidos pendientes'}</> : <><CheckCircle2 className="size-4" /> Todos los resultados capturados</>}
              </p>
              <ul className="space-y-3">{matches.map((m) => <ResultRow key={m.id} m={m} tz={timezone} roundId={roundId} />)}</ul>
              <p className="mt-4 text-xs text-muted">Al guardar se recalculan los puntos y la clasificación. La sincronización automática sigue activa; un resultado capturado aquí tiene prioridad sobre ella.</p>
            </>
          )}
        </>
      )}
    </div>
  )
}

function ResultRow({ m, tz, roundId }: { m: AdminMatch; tz: string; roundId: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const confirmed = m.status === 'finished' && m.result_confirmed
  const [editing, setEditing] = useState(!confirmed)
  const [home, setHome] = useState(m.home_goals?.toString() ?? '')
  const [away, setAway] = useState(m.away_goals?.toString() ?? '')
  const [status, setStatus] = useState<'finished' | 'postponed' | 'cancelled'>('finished')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const started = Date.parse(m.kickoff_at) <= Date.now()
  const valid = status !== 'finished' || (/^\d{1,2}$/.test(home) && /^\d{1,2}$/.test(away))
  const needsReason = confirmed || status !== 'finished'

  const save = async () => {
    if (status === 'finished' && !started && !confirm('Este partido aún no ha empezado según su horario. ¿Seguro que ya terminó?')) return
    setBusy(true)
    try {
      await adminApi.recordResult(m.id, status === 'finished' ? Number(home) : null, status === 'finished' ? Number(away) : null, status,
        needsReason ? reason.trim() : 'Resultado oficial capturado por el administrador')
      toast(status === 'finished' ? `Guardado: ${m.home.short_name} ${home}-${away} ${m.away.short_name}` : 'Estado guardado')
      setEditing(false)
      setReason('')
      await qc.invalidateQueries({ queryKey: qk.admin.round(roundId) })
      await qc.invalidateQueries({ queryKey: ['leaderboard'] })
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={cn('card p-3', confirmed && !editing && 'border-success/25')}>
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
        <span className="truncate">{m.competition?.name}</span>
        <span className="capitalize">{formatShortDate(m.kickoff_at, tz)} · {formatTime(m.kickoff_at, tz)}</span>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2"><TeamCrest team={m.home} size={26} /><span className="truncate text-sm font-semibold">{m.home.short_name}</span></div>
        {editing ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <Input aria-label={`Goles de ${m.home.name}`} inputMode="numeric" maxLength={2} className="scoreline h-12 w-14 px-0 text-center text-2xl" disabled={status !== 'finished'}
              value={home} onChange={(e) => setHome(e.target.value.replace(/\D/g, ''))} />
            <span className="scoreline text-xl text-muted">:</span>
            <Input aria-label={`Goles de ${m.away.name}`} inputMode="numeric" maxLength={2} className="scoreline h-12 w-14 px-0 text-center text-2xl" disabled={status !== 'finished'}
              value={away} onChange={(e) => setAway(e.target.value.replace(/\D/g, ''))} />
          </div>
        ) : (
          <span className="scoreline shrink-0 text-2xl">{m.status === 'finished' ? `${m.home_goals}:${m.away_goals}` : '—'}</span>
        )}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2"><span className="truncate text-right text-sm font-semibold">{m.away.short_name}</span><TeamCrest team={m.away} size={26} /></div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {confirmed && !editing ? (
          <>
            <Badge tone="success">Final confirmado{m.result_source === 'admin' ? ' · capturado' : ' · automático'}</Badge>
            <Button size="sm" variant="ghost" className="ml-auto" icon={<Pencil className="size-4" />} onClick={() => setEditing(true)}>Corregir</Button>
          </>
        ) : ['cancelled', 'postponed', 'abandoned'].includes(m.status) && !editing ? (
          <>
            <Badge tone="warning">{m.status === 'postponed' ? 'Aplazado' : 'Cancelado'}</Badge>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditing(true)}>Cambiar</Button>
          </>
        ) : (
          <>
            <Select aria-label="Estado del partido" className="h-10 w-auto rounded-full px-3 text-xs" value={status} onChange={(e) => setStatus(e.target.value as 'finished')}>
              <option value="finished">Terminado</option><option value="postponed">Aplazado</option><option value="cancelled">Cancelado</option>
            </Select>
            {needsReason && <Input aria-label="Motivo" placeholder={confirmed ? 'Motivo de la corrección' : 'Motivo'} className="h-10 min-w-0 flex-1 text-sm" value={reason} onChange={(e) => setReason(e.target.value)} />}
            <Button size="sm" className="ml-auto" loading={busy} disabled={!valid || (needsReason && reason.trim().length < 5)} onClick={() => void save()}>Guardar</Button>
            {confirmed && <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setHome(m.home_goals?.toString() ?? ''); setAway(m.away_goals?.toString() ?? '') }}>Cancelar</Button>}
          </>
        )}
      </div>
    </li>
  )
}
