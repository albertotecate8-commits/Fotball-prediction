import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarRange, Sparkles } from 'lucide-react'
import { adminApi, type PoolSource, type WeekMode, type WeekPlan } from '@/services/admin'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/cn'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { NEXT_POOL_KEY } from './AddMatchSheet'

export const WEEKS_KEY = ['admin', 'week-plans'] as const

const MODES: { value: WeekMode; label: string; hint: string }[] = [
  { value: 'publish', label: 'Automática', hint: 'La app elige y publica sola los partidos del plan conforme aparecen.' },
  { value: 'select', label: 'Solo seleccionar', hint: 'La app los elige; tú revisas y publicas.' },
  { value: 'off', label: 'Apagada', hint: 'Nada automático: agregas partido por partido.' },
]

const addDays = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7))
const fmt = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Quinielas completas automáticas por semana (lunes a domingo, hora de CDMX). */
export function AutoWeekCard() {
  const q = useQuery({ queryKey: WEEKS_KEY, queryFn: adminApi.weekPlans })
  const [editing, setEditing] = useState<WeekPlan | 'new' | null>(null)
  const plans = q.data?.plans ?? []
  return (
    <section className="card mb-6 p-4" aria-labelledby="auto-h">
      <div className="mb-1 flex items-center gap-2">
        <Sparkles className="size-5 text-gold" />
        <h2 id="auto-h" className="font-semibold">Armado automático por semana</h2>
      </div>
      <p className="mb-3 text-xs text-muted">Elige ligas, equipos y cupo. La API gratuita da a conocer los partidos un día antes: se agregan conforme aparecen y cada uno cierra a su hora.</p>
      {plans.length === 0 && !q.isLoading && <p className="mb-3 text-sm text-muted">No hay semanas planificadas.</p>}
      <ul className="mb-3 space-y-2">
        {plans.map((w) => <PlanRow key={w.id} w={w} sources={q.data?.sources ?? []} onEdit={() => setEditing(w)} />)}
      </ul>
      <Button size="sm" variant="outline" icon={<CalendarRange className="size-4" />} onClick={() => setEditing('new')}>Armar una semana</Button>
      {q.data && <PlanSheet key={editing === null ? 'closed' : editing === 'new' ? 'new' : editing.id} open={editing !== null} plan={editing === 'new' ? null : editing}
        sources={q.data.sources} today={q.data.today} onClose={() => setEditing(null)} />}
    </section>
  )
}

function PlanRow({ w, sources, onEdit }: { w: WeekPlan; sources: PoolSource[]; onEdit: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const name = (kind: 'league' | 'team', id: string) => sources.find((s) => s.kind === kind && s.external_id === id)?.label ?? `#${id}`
  const setMode = async (mode: WeekMode) => {
    if (mode === w.auto_mode) return
    if (mode === 'publish' && !confirm(`¿Activar la quiniela automática de ${w.label}? Los partidos del plan se publicarán solos para los participantes conforme aparezcan.`)) return
    setBusy(true)
    try {
      const r = await adminApi.setWeekMode(w.id, mode)
      toast(`${MODES.find((m) => m.value === mode)!.label} · ${r.selected_now ? `${r.selected_now} partido(s) agregados` : 'por ahora sin partidos nuevos en la API'}`)
      await Promise.all([qc.invalidateQueries({ queryKey: WEEKS_KEY }), qc.invalidateQueries({ queryKey: NEXT_POOL_KEY }), qc.invalidateQueries({ queryKey: ['pool'] })])
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  return (
    <li className="card-flat p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="font-semibold">{w.label}</span>
        <span className="text-[11px] text-muted">{fmt(w.week_start)} – {fmt(w.week_end)}</span>
        <Badge tone="accent" className="ml-auto normal-case tracking-normal">{w.selected}/{w.max_matches} elegidos · {w.published} publicados</Badge>
      </div>
      <p className="mb-2 text-[11px] text-muted">
        {[...w.league_ids.map((id) => name('league', id)), ...w.team_ids.map((id) => `${name('team', id)}${w.team_ids.length && w.team_weekend_only ? ' (fin de semana)' : ''}${w.teams_found.includes(id) ? ' ✓' : ''}`)].join(' · ') || 'Sin ligas ni equipos'}
      </p>
      <div role="radiogroup" aria-label={`Modo de ${w.label}`} className="mb-1.5 grid grid-cols-3 gap-1 rounded-full border border-line p-1">
        {MODES.map((m) => (
          <button key={m.value} type="button" role="radio" aria-checked={w.auto_mode === m.value} disabled={busy} onClick={() => void setMode(m.value)}
            className={cn('h-8 rounded-full text-[12px] font-semibold transition', w.auto_mode === m.value ? 'bg-red text-white' : 'text-muted hover:text-ink')}>
            {m.label}
          </button>
        ))}
      </div>
      {w.selected === 0 && w.auto_mode !== 'off' && (
        <p className="mb-1.5 rounded-xl border border-gold/40 bg-gold/10 p-2 text-[11px] text-gold">
          Aún no hay partidos de estas ligas y equipos en la API para esa semana. La API gratuita los da a conocer un día antes: en cuanto aparezcan se {w.auto_mode === 'publish' ? 'agregarán y publicarán' : 'agregarán a la selección'} solos. Si quieres adelantar uno, usa «Agregar partido que no aparece».
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-faint">{MODES.find((m) => m.value === w.auto_mode)!.hint}</p>
        <Button size="sm" variant="ghost" onClick={onEdit}>Editar</Button>
      </div>
    </li>
  )
}

function PlanSheet({ open, plan, sources, today, onClose }: { open: boolean; plan: WeekPlan | null; sources: PoolSource[]; today: string; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const thisMonday = mondayOf(today)
  const weeks = [0, 7, 14, 21].map((n) => addDays(thisMonday, n))
  const usable = sources.filter((s) => s.enabled || plan?.league_ids.includes(s.external_id) || plan?.team_ids.includes(s.external_id))
  const [start, setStart] = useState(plan?.week_start ?? weeks[1]!)
  const [max, setMax] = useState(String(plan?.max_matches ?? 12))
  const [picked, setPicked] = useState<string[]>(() => plan ? [...plan.league_ids.map((x) => `league:${x}`), ...plan.team_ids.map((x) => `team:${x}`)] : usable.map((s) => `${s.kind}:${s.external_id}`))
  const [weekendOnly, setWeekendOnly] = useState(plan?.team_weekend_only ?? true)
  const [mode, setMode] = useState<WeekMode>(plan?.auto_mode ?? 'publish')
  const [busy, setBusy] = useState(false)
  const n = Number(max)
  const valid = Number.isInteger(n) && n >= 1 && n <= 30 && picked.length > 0
  const toggle = (k: string) => setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  const save = async () => {
    setBusy(true)
    try {
      const of = (kind: string) => picked.filter((k) => k.startsWith(`${kind}:`)).map((k) => k.split(':')[1]!)
      const r = await adminApi.planWeek(start, n, of('team'), of('league'), weekendOnly)
      const m = await adminApi.setWeekMode(r.id, mode)
      const added = m.selected_now + r.added_now
      toast(`Semana guardada · ${MODES.find((x) => x.value === mode)!.label} · ${added ? `${added} partido(s) agregados` : 'aún no hay partidos en la API; se agregarán solos'}`)
      await Promise.all([qc.invalidateQueries({ queryKey: WEEKS_KEY }), qc.invalidateQueries({ queryKey: NEXT_POOL_KEY }), qc.invalidateQueries({ queryKey: ['pool'] })])
      onClose()
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  return (
    <Sheet open={open} onClose={onClose} title={plan ? `Editar ${plan.label}` : 'Armar una semana'}
      footer={<Button className="w-full" loading={busy} disabled={!valid} onClick={() => void save()}>Guardar semana</Button>}>
      <div className="space-y-4">
        <Field label="Semana (lunes a domingo)">{(id) => (
          <Select id={id} value={start} disabled={!!plan} onChange={(e) => setStart(e.target.value)}>
            {weeks.map((w, i) => <option key={w} value={w}>{i === 0 ? 'Esta semana' : i === 1 ? 'Próxima semana' : `En ${i} semanas`} · {fmt(w)} – {fmt(addDays(w, 6))}</option>)}
          </Select>
        )}</Field>
        <Field label="Partidos por quiniela (cupo)">{(id) => <Input id={id} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, '').slice(0, 2))} />}</Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">Ligas y equipos</legend>
          <div className="flex flex-wrap gap-2">
            {usable.map((s) => {
              const k = `${s.kind}:${s.external_id}`
              const on = picked.includes(k)
              return (
                <button key={k} type="button" aria-pressed={on} onClick={() => toggle(k)}
                  className={cn('h-9 rounded-full border px-3 text-sm font-semibold', on ? 'border-aqua/60 bg-aqua/15 text-aqua' : 'border-line-strong text-muted')}>
                  {s.label}{s.kind === 'league' ? ' (liga)' : ''}
                </button>
              )
            })}
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-red)]" checked={weekendOnly} onChange={(e) => setWeekendOnly(e.target.checked)} />
          Equipos: solo su partido de fin de semana (viernes a domingo)
        </label>
        <Field label="Modo">{(id) => (
          <Select id={id} value={mode} onChange={(e) => setMode(e.target.value as WeekMode)}>
            {MODES.map((m) => <option key={m.value} value={m.value}>{m.label} — {m.hint}</option>)}
          </Select>
        )}</Field>
        <p className="text-xs text-muted">Primero entran los equipos elegidos y luego la liga por fecha, hasta llenar el cupo. Lo que tú quites no vuelve a entrar solo. También puedes agregar o quitar partidos sueltos en las listas de abajo.</p>
      </div>
    </Sheet>
  )
}
