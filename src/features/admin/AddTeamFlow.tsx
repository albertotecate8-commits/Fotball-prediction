import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Globe, Search } from 'lucide-react'
import { adminApi, type CatalogTeam, type ProviderTeamResult } from '@/services/admin'
import { errorMessage } from '@/lib/errors'
import { TeamCrest } from '@/components/TeamCrest'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

/** Espera a que el admin deje de escribir. */
function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value)
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t) }, [value, ms])
  return v
}

/**
 * «Añadir equipo» escribiendo solo el nombre (o un apodo, como «Alacranes»).
 * Busca sola mientras escribes: primero en tu catálogo y luego en internet
 * (gratis, sin gastar consultas de API-Football). Un toque lo añade con su id
 * y escudo oficiales. Si no existe, se registra como equipo manual.
 */
export function AddTeamFlow({ initialName = '', onDone, onCancel, offerFollow = false }: {
  initialName?: string; onDone: (t: CatalogTeam) => void; onCancel?: () => void; offerFollow?: boolean
}) {
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [short, setShort] = useState('')
  const [manual, setManual] = useState(false)
  const [follow, setFollow] = useState(false)
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(false)
  const q = name.trim()
  const dq = useDebounced(q, 600)
  const ready = dq.length >= 3 && dq === q
  const catalog = useQuery({ queryKey: ['admin', 'teams', dq], queryFn: () => adminApi.searchTeams(dq), enabled: dq.length >= 2 })
  const online = useQuery({
    queryKey: ['admin', 'provider-teams', dq, more], queryFn: () => adminApi.searchProviderTeams(dq, more),
    enabled: ready, staleTime: 10 * 60_000, retry: false,
  })
  useEffect(() => { setMore(false); setManual(false) }, [dq])
  const inCatalog = catalog.data ?? []
  const results = (online.data?.teams ?? []).filter((t) => !inCatalog.some((c) => c.external_id === t.external_id))

  const finish = async (t: CatalogTeam, msg: string) => {
    if (follow && t.provider === 'api-football') {
      const f = await adminApi.followTeam(t.id, true)
      msg += ` · se incluirá cada semana${f.selected_now ? ` (${f.selected_now} partido(s) agregados)` : ''}`
    }
    toast(msg)
    onDone(t)
  }
  const chooseCatalog = (t: CatalogTeam) => guard(() => finish(t, `${t.name} ya estaba en tu catálogo`))
  const guard = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  const pick = (t: ProviderTeamResult) => guard(async () => {
    const r = await adminApi.createTeam(t.name, t.code ?? '', t.logo_url ?? '', t.external_id)
    // Apodos (lo que escribiste y los nombres alternos) para encontrarlo después.
    await adminApi.setTeamMeta(r.id, [...(t.aliases ?? []), q], t.tsdb_id ?? null, t.tsdb_league ?? null)
    const found = await adminApi.searchTeams(t.name).catch(() => [])
    const team = found.find((x) => x.id === r.id) ?? { id: r.id, name: t.name, short_name: t.code ?? t.name, logo_url: t.logo_url, provider: 'api-football', external_id: t.external_id }
    await finish(team, r.created ? `Equipo añadido: ${t.name}` : r.retired ? `${t.name} existe pero está retirado: restáuralo desde el catálogo` : `${t.name} ya estaba en el catálogo (se guardó «${q}» como apodo)`)
  })
  const saveManual = () => guard(async () => {
    if (!confirm(`¿Registrar «${q}» como equipo MANUAL (sin id ni escudo oficial)?`)) return
    const r = await adminApi.createTeam(q, short.trim(), '', '')
    await finish({ id: r.id, name: q, short_name: short.trim() || q, logo_url: null, provider: 'manual', external_id: null },
      r.created ? 'Equipo manual registrado' : 'Ese equipo ya existía: se usará el del catálogo')
  })

  const searching = q.length >= 3 && (dq !== q || online.isFetching)
  const nothing = ready && !online.isFetching && online.isFetched && results.length === 0 && inCatalog.length === 0

  return (
    <div className="card-flat space-y-3 p-3">
      <Field label="Nombre o apodo del equipo" hint="Ej.: «Alacranes», «Real Madrid», «Pumas». Se busca solo mientras escribes.">{(id) => (
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
          <Input id={id} className="pl-11" value={name} maxLength={40} placeholder="Escribe al menos 3 letras" autoComplete="off" autoFocus
            onChange={(e) => setName(e.target.value)} />
        </div>
      )}</Field>

      {offerFollow && (
        <label className="flex items-center gap-2 text-xs font-semibold">
          <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
          Incluir sus partidos cada semana en la quiniela
        </label>
      )}

      {inCatalog.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Ya en tu catálogo</p>
          <ul className="space-y-1.5">
            {inCatalog.slice(0, 5).map((t) => (
              <li key={t.id}>
                <button type="button" disabled={busy} onClick={() => void chooseCatalog(t)} className="card-flat flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:border-gold-soft/40 disabled:opacity-50">
                  <TeamCrest team={{ ...t, code: null }} size={28} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                  <span className="shrink-0 text-[10px] text-muted">{t.external_id ? `API-Football #${t.external_id}` : 'manual'}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {q.length >= 3 && (
        <div>
          <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted"><Globe className="size-3.5" /> En internet (ids y escudos oficiales)</p>
          {searching ? <p className="text-xs text-muted">Buscando «{q}»…</p>
            : online.error ? <p className="text-xs text-danger">{errorMessage(online.error)}</p>
            : results.length > 0 ? (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                {results.map((t) => (
                  <li key={t.external_id}>
                    <button type="button" disabled={busy} onClick={() => void pick(t)}
                      className="card-flat flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:border-gold-soft/40 disabled:opacity-50">
                      <TeamCrest team={{ name: t.name, short_name: t.code ?? t.name, code: t.code, logo_url: t.logo_url }} size={30} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{t.name}</span>
                        <span className="block truncate text-[11px] text-muted">{[t.league, t.country].filter(Boolean).join(' · ') || '—'} · API-Football #{t.external_id}</span>
                      </span>
                      {t.catalog_id ? <Badge tone={t.catalog_retired ? 'danger' : 'success'} className="normal-case tracking-normal">{t.catalog_retired ? 'Retirado' : 'Ya en catálogo'}</Badge>
                        : <span className="shrink-0 rounded-full bg-brand px-3 py-1 text-xs font-bold text-on-brand">Añadir</span>}
                    </button>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-muted">{nothing ? `Sin resultados para «${q}».` : ' '}</p>}
          {online.data?.can_search_more && !searching && (
            <Button size="sm" variant="ghost" className="mt-1" onClick={() => setMore(true)}>¿No está? Buscar más en API-Football (usa 1 consulta)</Button>
          )}
        </div>
      )}

      {q.length >= 2 && (manual ? (
        <div className="space-y-3 rounded-xl border border-gold/40 bg-gold/5 p-3">
          <p className="text-xs text-gold">Se registrará «{q}» como <strong>equipo manual</strong>: sin id oficial ni escudo (se muestra uno genérico). Si después aparece en API-Football, se vincula al mismo registro.</p>
          <Field label="Nombre corto (opcional)">{(id) => <Input id={id} value={short} maxLength={20} onChange={(e) => setShort(e.target.value)} />}</Field>
          <div className="flex gap-2">
            <Button size="sm" loading={busy} onClick={() => void saveManual()}>Registrar como manual</Button>
            <Button size="sm" variant="ghost" onClick={() => setManual(false)}>Volver</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {(nothing || online.data?.api_used) && <Button size="sm" variant="ghost" onClick={() => setManual(true)}>No lo encuentro: registrarlo como manual</Button>}
          {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>}
        </div>
      ))}
    </div>
  )
}
