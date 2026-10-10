import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { adminApi } from '@/services/admin'
import { TeamCrest } from '@/components/TeamCrest'
import { Input } from '@/components/ui/Field'
import { EmptyState } from '@/components/ui/States'
import { NewTeamForm } from './TeamPicker'

/** Catálogo reutilizable de equipos. */
export function AdminTeams() {
  const [q, setQ] = useState('')
  const [last, setLast] = useState<string | null>(null)
  const list = useQuery({ queryKey: ['admin', 'teams', q, last], queryFn: () => adminApi.searchTeams(q) })
  return (
    <div>
      <h1 className="display mb-4 text-3xl font-semibold uppercase">Equipos</h1>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <Input aria-label="Buscar equipo" placeholder="Buscar por nombre o id de API-Football" className="pl-11" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <ul className="mb-6 space-y-1.5">
        {(list.data ?? []).map((t) => (
          <li key={t.id} className="card-flat flex items-center gap-3 px-3 py-2 text-sm">
            <TeamCrest team={{ ...t, code: null }} size={26} />
            <span className="min-w-0 flex-1 truncate font-semibold">{t.name}</span>
            <span className="shrink-0 text-[11px] text-muted">{t.external_id ? `API-Football #${t.external_id}` : 'Registrado por el admin'}</span>
          </li>
        ))}
      </ul>
      {list.data && list.data.length === 0 && <EmptyState title="Sin coincidencias" description="Registra el equipo abajo." />}
      <h2 className="mb-1 font-semibold">Registrar equipo nuevo</h2>
      <p className="mb-2 text-xs text-muted">Antes de guardar se buscan coincidencias por nombre e id para no duplicar.</p>
      <NewTeamForm key={last ?? 'new'} onCreated={(t) => setLast(t.id)} />
    </div>
  )
}
