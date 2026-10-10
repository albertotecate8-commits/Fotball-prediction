import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, CheckCircle2 } from 'lucide-react'
import { adminApi } from '@/services/admin'
import { errorMessage } from '@/lib/errors'
import { formatShortDate } from '@/lib/time'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'

const TEAM: Record<string, string> = { '529': 'Barcelona', '541': 'Real Madrid' }
const LEAGUE: Record<string, string> = { '262': 'Liga MX' }

/** «Armar quiniela de la próxima semana»: la app reserva el cupo y lo llena sola con partidos reales. */
export function WeekPlanCard({ tz }: { tz: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const plans = useQuery({ queryKey: ['admin', 'weekPlans'], queryFn: adminApi.weekPlans })
  const plan = (plans.data ?? []).slice().sort((a, b) => a.week_start.localeCompare(b.week_start)).at(-1)
  const plan_ = async () => {
    if (!confirm('¿Armar la quiniela de la próxima semana con 12 partidos: Barcelona y Real Madrid (fin de semana) y Liga MX?')) return
    try {
      const r = await adminApi.planNextWeek()
      toast(r.added_now ? `Quiniela creada: ${r.added_now} partidos ya agregados` : 'Quiniela creada: los partidos se agregarán solos')
      await qc.invalidateQueries({ queryKey: ['admin'] })
      await qc.invalidateQueries({ queryKey: ['pool'] })
    } catch (e) { toast(errorMessage(e), 'error') }
  }
  const noon = (d: string) => `${d}T12:00:00Z`
  return (
    <section className="card mb-5 p-4">
      <h2 className="mb-1 font-semibold">Quiniela de la semana</h2>
      {plan ? (
        <>
          <p className="text-sm text-muted">
            <span className="capitalize">{formatShortDate(noon(plan.week_start), tz)}</span> a <span className="capitalize">{formatShortDate(noon(plan.week_end), tz)}</span> ·{' '}
            {plan.team_ids.map((t) => TEAM[t] ?? `#${t}`).join(', ')}{plan.team_weekend_only ? ' (fin de semana)' : ''} y {plan.league_ids.map((l) => LEAGUE[l] ?? `#${l}`).join(', ')}
          </p>
          <div className="mt-3 flex items-end justify-between">
            <div className="scoreline text-3xl">{plan.filled}<span className="text-lg text-muted">/{plan.max_matches}</span></div>
            <div className="text-right text-xs text-muted">
              {plan.team_ids.map((t) => (
                <div key={t} className={plan.teams_found.includes(t) ? 'text-success' : ''}>
                  {plan.teams_found.includes(t) ? <CheckCircle2 className="mr-1 inline size-3" /> : '· '}{TEAM[t] ?? `#${t}`}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full rounded-full bg-aqua" style={{ width: `${Math.round((plan.filled / plan.max_matches) * 100)}%` }} /></div>
          {plan.filled < plan.max_matches && (
            <p className="mt-3 text-xs text-muted">Los partidos se agregan solos cuando API-Football los publica (el plan gratuito lo hace un día antes). Si quieres verlos antes, añádelos con «Añadir partido»: cuentan para esta semana.</p>
          )}
        </>
      ) : (
        <p className="mb-3 text-sm text-muted">La app arma la quiniela de la próxima semana con 12 partidos reales: Barcelona y Real Madrid (fin de semana) y Liga MX.</p>
      )}
      <Button variant={plan ? 'ghost' : 'primary'} size={plan ? 'sm' : 'md'} block={!plan} className={plan ? 'mt-3' : ''} icon={<CalendarPlus className="size-4" />} onClick={() => void plan_()}>
        {plan ? 'Volver a armar / actualizar' : 'Armar quiniela de la próxima semana'}
      </Button>
    </section>
  )
}
