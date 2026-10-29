import { Link } from 'react-router'
import { ChevronDown, Users } from 'lucide-react'
import { useGroup } from '@/features/groups/GroupProvider'

export function GroupSwitcher() {
  const { activeGroups, group, select } = useGroup()
  if (!group) return null
  if (activeGroups.length < 2) {
    return (
      <Link to="/grupos" className="hidden max-w-[10rem] items-center gap-1.5 truncate rounded-full border border-line bg-surface/70 px-3 py-2 text-xs font-semibold text-muted transition hover:text-ink sm:inline-flex">
        <Users className="size-3.5 text-gold-soft" /> {group.name}
      </Link>
    )
  }
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Grupo</span>
      <Users className="pointer-events-none absolute left-3 size-3.5 text-gold-soft" />
      <select value={group.group_id} onChange={(e) => select(e.target.value)}
        className="h-10 max-w-[11rem] appearance-none truncate rounded-full border border-line bg-surface/80 pl-8 pr-8 text-xs font-semibold text-ink">
        {activeGroups.map((g) => <option key={g.group_id} value={g.group_id}>{g.name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 size-3.5 text-muted" />
    </label>
  )
}
