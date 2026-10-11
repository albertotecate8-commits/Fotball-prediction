import { useState } from 'react'
import { Search } from 'lucide-react'
import { adminApi, type CatalogTeam, type ProviderTeamResult } from '@/services/admin'
import { errorMessage, toAppError } from '@/lib/errors'
import { TeamCrest } from '@/components/TeamCrest'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

type Step =
  | { kind: 'search' }
  | { kind: 'results'; teams: ProviderTeamResult[]; cached: boolean }
  | { kind: 'manual'; why: string }

/**
 * «Añadir equipo» solo con el nombre: se busca en API-Football (desde el
 * servidor, con caché y dentro de la cuota) y se guarda con su id y escudo
 * oficiales. Si no existe, se registra como equipo manual, claramente marcado.
 */
export function AddTeamFlow({ initialName = '', onDone, onCancel }: { initialName?: string; onDone: (t: CatalogTeam) => void; onCancel?: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [short, setShort] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'search' })
  const [busy, setBusy] = useState(false)
  const q = name.trim()

  const finish = async (id: string, fallback: CatalogTeam, msg: string) => {
    toast(msg)
    const found = await adminApi.searchTeams(fallback.name).catch(() => [])
    onDone(found.find((x) => x.id === id) ?? fallback)
  }
  const search = async () => {
    setBusy(true)
    try {
      const r = await adminApi.searchProviderTeams(q)
      setStep(r.teams.length ? { kind: 'results', teams: r.teams, cached: r.cached } : { kind: 'manual', why: `API-Football no encontró «${q}».` })
    } catch (e) {
      const code = toAppError(e).code
      if (code === 'QUERY_TOO_SHORT') toast(errorMessage(e), 'error')
      else setStep({ kind: 'manual', why: `No se pudo consultar API-Football (${errorMessage(e)})` })
    } finally { setBusy(false) }
  }
  const pick = async (t: ProviderTeamResult) => {
    setBusy(true)
    try {
      const r = await adminApi.createTeam(t.name, t.code ?? '', t.logo_url ?? '', t.external_id)
      const msg = r.created ? `Equipo añadido: ${t.name}` : r.match === 'name_upgraded' ? `${t.name} ahora está vinculado a API-Football` : r.retired ? `${t.name} ya existe pero está retirado: restáuralo desde el catálogo` : `${t.name} ya estaba en el catálogo`
      await finish(r.id, { id: r.id, name: t.name, short_name: t.code ?? t.name, logo_url: t.logo_url, provider: 'api-football', external_id: t.external_id }, msg)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  const saveManual = async () => {
    if (!confirm(`¿Registrar «${q}» como equipo MANUAL (sin id ni escudo oficial)?`)) return
    setBusy(true)
    try {
      const r = await adminApi.createTeam(q, short.trim(), '', '')
      await finish(r.id, { id: r.id, name: q, short_name: short.trim() || q, logo_url: null, provider: 'manual', external_id: null },
        r.created ? 'Equipo manual registrado' : 'Ese equipo ya existía: se usará el del catálogo')
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }

  return (
    <div className="card-flat space-y-3 p-3">
      <Field label="Nombre del equipo">{(id) => (
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input id={id} className="pl-11" value={name} maxLength={40} placeholder="Ej. Real Madrid" autoComplete="off"
            onChange={(e) => { setName(e.target.value); setStep({ kind: 'search' }) }}
            onKeyDown={(e) => { if (e.key === 'Enter' && q.length >= 3) void search() }} />
        </div>
      )}</Field>

      {step.kind === 'search' && (
        <div className="flex gap-2">
          <Button size="sm" loading={busy} disabled={q.length < 3} onClick={() => void search()}>Buscar en API-Football</Button>
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>}
        </div>
      )}

      {step.kind === 'results' && (
        <div className="space-y-2">
          <p className="text-xs text-muted">{step.teams.length === 1 ? 'Coincidencia única. Confírmala para añadirla:' : `${step.teams.length} resultados. Elige el equipo correcto:`}{step.cached ? ' (búsqueda en caché, sin gastar consultas)' : ''}</p>
          <ul className="max-h-72 space-y-1.5 overflow-y-auto">
            {step.teams.map((t) => (
              <li key={t.external_id}>
                <button type="button" disabled={busy} onClick={() => void pick(t)}
                  className="card-flat flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:border-aqua/40 disabled:opacity-50">
                  <TeamCrest team={{ name: t.name, short_name: t.code ?? t.name, code: t.code, logo_url: t.logo_url }} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{t.name}</span>
                    <span className="block text-[11px] text-muted">{t.country ?? '—'}{t.national ? ' · Selección' : ''} · API-Football #{t.external_id}</span>
                  </span>
                  {t.catalog_id && <Badge tone={t.catalog_retired ? 'danger' : 'success'} className="normal-case tracking-normal">{t.catalog_retired ? 'Retirado' : 'Ya en catálogo'}</Badge>}
                </button>
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={() => setStep({ kind: 'manual', why: 'Ninguno de los resultados es el equipo buscado.' })}>No es ninguno: registrar manual</Button>
        </div>
      )}

      {step.kind === 'manual' && (
        <div className="space-y-3 rounded-xl border border-gold/40 bg-gold/5 p-3">
          <p className="text-xs text-gold">{step.why} Puedes registrarlo como <strong>equipo manual</strong>: sin id oficial ni escudo (se muestra un escudo genérico). Si después aparece en API-Football, se vinculará al mismo registro.</p>
          <Field label="Nombre corto (opcional)">{(id) => <Input id={id} value={short} maxLength={20} onChange={(e) => setShort(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={q.length < 2} onClick={() => void saveManual()}>Registrar como manual</Button>
            <Button size="sm" variant="ghost" onClick={() => setStep({ kind: 'search' })}>Volver</Button>
          </div>
        </div>
      )}
    </div>
  )
}
