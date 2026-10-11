import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { adminApi, type CatalogTeam } from '@/services/admin'
import { TeamCrest } from '@/components/TeamCrest'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { AddTeamFlow } from './AddTeamFlow'

/** Busca un equipo del catálogo activo o añade uno nuevo (sin duplicados). */
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
      {creating ? <div className="mt-2"><AddTeamFlow initialName={q} onDone={(t) => { onChange(t); setCreating(false) }} onCancel={() => setCreating(false)} /></div>
        : <Button size="sm" variant="ghost" className="mt-2" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>Añadir equipo</Button>}
    </div>
  )
}
