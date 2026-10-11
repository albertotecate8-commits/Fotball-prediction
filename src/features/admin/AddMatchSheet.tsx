import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminApi, type CatalogTeam, type ManualCandidate } from '@/services/admin'
import { formatShortDate, formatTime, fromLocalInput } from '@/lib/time'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { TeamPicker } from './TeamPicker'

export const NEXT_POOL_KEY = ['admin', 'next-pool'] as const

// Alta de un partido que no llegó solo: primero se busca el oficial en la API;
// si no existe, se registra como manual. En ambos casos entra a la SELECCIÓN
// (se publica para los jugadores solo con «Publicar»).
type Step = { kind: 'form' } | { kind: 'choose'; candidates: ManualCandidate[]; message: string }

export function AddMatchSheet({ open, onClose, tz }: { open: boolean; onClose: () => void; tz: string }) {
  const qc = useQueryClient()
  const toast = useToast()
  const comps = useQuery({ queryKey: ['admin', 'competitions'], queryFn: adminApi.competitions, enabled: open })
  const [home, setHome] = useState<CatalogTeam | null>(null)
  const [away, setAway] = useState<CatalogTeam | null>(null)
  const [compId, setCompId] = useState('')
  const [compName, setCompName] = useState('')
  const [kickoff, setKickoff] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [busy, setBusy] = useState(false)
  const comp = (comps.data ?? []).find((c) => c.id === compId)
  const iso = kickoff ? fromLocalInput(kickoff, tz) : null
  const valid = !!home && !!away && home.id !== away.id && !!iso && Date.parse(iso) > Date.now()

  const reset = () => { setHome(null); setAway(null); setCompId(''); setCompName(''); setKickoff(''); setStep({ kind: 'form' }) }
  const close = () => { reset(); onClose() }
  const finish = async (msg: string) => {
    toast(msg)
    await qc.invalidateQueries({ queryKey: NEXT_POOL_KEY })
    close()
  }
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  // 1) Se busca el partido oficial en la API; 2) si no existe, se registra como manual.
  const search = (pick?: string) => guard(async () => {
    if (!home || !away || !iso) return
    const r = await adminApi.addManualMatch('api-football', {
      home: home.name, away: away.name, kickoff_at: iso,
      competitionId: comp?.provider === 'api-football' ? comp.external_id : undefined,
      competitionName: comp?.name ?? (compName.trim() || undefined),
      pick_external_id: pick, no_create: true,
    })
    if (r.kind === 'linked') {
      await adminApi.publishMatch(r.match_id)
      await finish(`Agregado a la selección · API-Football #${r.fixture.external_id}`)
    } else if (r.kind === 'manual' || r.kind === 'pending_link') {
      await adminApi.publishMatch(r.match_id)
      await finish('Agregado a la selección')
    } else {
      setStep({
        kind: 'choose', candidates: r.candidates,
        message: r.kind === 'outside_window' ? 'La API gratuita solo consulta de ayer a mañana. Regístralo como manual; se vinculará solo cuando entre en la ventana.'
          : r.kind === 'ambiguous' ? 'Hay varios partidos parecidos en la API. Elige el correcto.'
          : 'No se encontró en la API. Puedes elegir uno parecido o registrarlo como manual.',
      })
    }
  })
  const createManual = () => guard(async () => {
    if (!home || !away || !iso) return
    if (!confirm(`¿Registrar ${home.name} vs ${away.name} como partido añadido por el admin?`)) return
    const r = await adminApi.createPoolMatch(home.id, away.id, iso, comp?.id ?? null, comp ? null : (compName.trim() || null))
    await finish(r.created ? 'Partido manual agregado a la selección' : 'Ese partido ya existía: se agregó a la selección')
  })

  return (
    <Sheet open={open} onClose={close} title="Agregar partido a la selección"
      footer={step.kind === 'form' ? (
        <Button className="w-full" loading={busy} disabled={!valid} onClick={() => void search()}>Buscar y agregar a la selección</Button>
      ) : (
        <div className="flex gap-2">
          <Button className="flex-1" loading={busy} onClick={() => void createManual()}>Registrar como manual</Button>
          <Button variant="ghost" onClick={() => setStep({ kind: 'form' })}>Volver</Button>
        </div>
      )}>
      {step.kind === 'form' ? (
        <div className="space-y-4">
          <TeamPicker label="Equipo local" value={home} onChange={setHome} />
          <TeamPicker label="Equipo visitante" value={away} onChange={setAway} />
          {home && away && home.id === away.id && <p className="text-xs text-danger">Elige dos equipos distintos.</p>}
          <Field label="Competición">{(id) => (
            <Select id={id} value={compId} onChange={(e) => setCompId(e.target.value)}>
              <option value="">Otra / escribir nombre</option>
              {(comps.data ?? []).filter((c) => !c.is_test_data).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}</Field>
          {!compId && <Field label="Nombre de la competición (opcional)">{(id) => <Input id={id} maxLength={80} value={compName} onChange={(e) => setCompName(e.target.value)} />}</Field>}
          <Field label="Fecha y hora (Ciudad de México)" hint="Los pronósticos cierran a esta hora." error={iso && Date.parse(iso) <= Date.now() ? 'Debe ser una hora futura.' : null}>
            {(id) => <Input id={id} type="datetime-local" value={kickoff} onChange={(e) => setKickoff(e.target.value)} />}
          </Field>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted">{step.message}</p>
          {step.candidates.map((c) => (
            <button key={c.external_id} type="button" disabled={busy} onClick={() => void search(c.external_id)}
              className="card-flat w-full px-3 py-2.5 text-left text-sm hover:border-aqua/40">
              <div className="font-semibold">{c.home} vs {c.away}</div>
              <div className="text-[11px] text-muted">{formatShortDate(c.kickoff_at, tz)} · {formatTime(c.kickoff_at, tz)} · {c.competition ?? '—'} · API-Football #{c.external_id}</div>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
