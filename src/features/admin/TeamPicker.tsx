import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { adminApi, type CatalogTeam } from '@/services/admin'
import { errorMessage } from '@/lib/errors'
import { TeamCrest } from '@/components/TeamCrest'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'

/** Busca un equipo del catálogo o registra uno nuevo (sin duplicados). */
export function TeamPicker({ label, value, onChange }: { label: string; value: CatalogTeam | null; onChange: (t: CatalogTeam | null) => void }) {
  const [q, setQ] = useState('')
  const [creating, setCreating] = useState(false)
  const results = useQuery({ queryKey: ['admin', 'teams', q], queryFn: () => adminApi.searchTeams(q), enabled: q.trim().length >= 2 })
  if (value) {
    return (
      <div>
        <div className="mb-1.5 text-sm font-semibold">{label}</div>
        <div className="card-flat flex items-center gap-3 px-3 py-2.5">
          <TeamCrest team={{ ...value, code: null }} size={30} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{value.name}</div>
            <div className="text-[11px] text-muted">{value.external_id ? `API-Football #${value.external_id}` : 'Equipo registrado por el admin'}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onChange(null)}>Cambiar</Button>
        </div>
      </div>
    )
  }
  return (
    <div>
      <div className="mb-1.5 text-sm font-semibold">{label}</div>
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input aria-label={`Buscar ${label.toLowerCase()}`} placeholder="Buscar equipo (mín. 2 letras)" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {q.trim().length >= 2 && (
        <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
          {(results.data ?? []).map((t) => (
            <li key={t.id}>
              <button type="button" onClick={() => onChange(t)} className="card-flat flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:border-aqua/40">
                <TeamCrest team={{ ...t, code: null }} size={24} />
                <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
                <span className="shrink-0 text-[10px] text-muted">{t.external_id ? `#${t.external_id}` : 'manual'}</span>
              </button>
            </li>
          ))}
          {results.data && results.data.length === 0 && <li className="px-1 text-xs text-muted">Sin coincidencias en el catálogo.</li>}
        </ul>
      )}
      {creating ? <NewTeamForm initialName={q} onCreated={(t) => { onChange(t); setCreating(false) }} onCancel={() => setCreating(false)} />
        : <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Registrar equipo nuevo</Button>}
    </div>
  )
}

export function NewTeamForm({ initialName = '', onCreated, onCancel }: { initialName?: string; onCreated: (t: CatalogTeam) => void; onCancel?: () => void }) {
  const toast = useToast()
  const [name, setName] = useState(initialName)
  const [short, setShort] = useState('')
  const [logo, setLogo] = useState('')
  const [pid, setPid] = useState('')
  const [busy, setBusy] = useState(false)
  const valid = name.trim().length >= 2 && (!logo || logo.startsWith('https://')) && (!pid || /^\d{1,10}$/.test(pid))
  const save = async () => {
    setBusy(true)
    try {
      const r = await adminApi.createTeam(name.trim(), short.trim(), logo.trim(), pid.trim())
      toast(r.created ? 'Equipo registrado' : 'Ese equipo ya existía: se usará el del catálogo')
      const found = await adminApi.searchTeams(name.trim())
      const t = found.find((x) => x.id === r.id) ?? { id: r.id, name: name.trim(), short_name: short || name, logo_url: logo || null, provider: pid ? 'api-football' : 'manual', external_id: pid || null }
      onCreated(t)
    } catch (e) { toast(errorMessage(e), 'error') } finally { setBusy(false) }
  }
  return (
    <div className="card-flat mt-2 space-y-3 p-3">
      <Field label="Nombre del equipo">{(id) => <Input id={id} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />}</Field>
      <Field label="Nombre corto (opcional)">{(id) => <Input id={id} value={short} maxLength={20} onChange={(e) => setShort(e.target.value)} />}</Field>
      <Field label="Escudo: dirección https de la imagen (opcional)" hint="Si no hay escudo real se muestra un icono genérico.">{(id) => <Input id={id} value={logo} placeholder="https://…" onChange={(e) => setLogo(e.target.value)} />}</Field>
      <Field label="Id de API-Football (solo si lo conoces)">{(id) => <Input id={id} inputMode="numeric" value={pid} onChange={(e) => setPid(e.target.value.replace(/\D/g, ''))} />}</Field>
      <div className="flex gap-2">
        <Button size="sm" loading={busy} disabled={!valid} onClick={() => void save()}>Guardar equipo</Button>
        {onCancel && <Button size="sm" variant="ghost" onClick={onCancel}>Cancelar</Button>}
      </div>
    </div>
  )
}
