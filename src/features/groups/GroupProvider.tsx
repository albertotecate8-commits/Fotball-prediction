import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import type { MyGroup } from '@/types/domain'

const STORAGE_KEY = 'fp.selectedGroup'

interface GroupState {
  groups: MyGroup[]
  activeGroups: MyGroup[]
  group: MyGroup | null
  loading: boolean
  error: unknown
  select: (groupId: string) => void
  refetch: () => void
}

const GroupContext = createContext<GroupState | null>(null)

const readStored = () => {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export function GroupProvider({ children }: { children: ReactNode }) {
  const q = useQuery({ queryKey: qk.groups, queryFn: playerApi.myGroups, staleTime: 60_000 })
  const [selected, setSelected] = useState<string | null>(readStored)

  const groups = useMemo(() => q.data ?? [], [q.data])
  const activeGroups = useMemo(() => groups.filter((g) => g.member_status === 'active'), [groups])
  const group = activeGroups.find((g) => g.group_id === selected) ?? activeGroups[0] ?? null

  useEffect(() => {
    if (group && group.group_id !== selected) setSelected(group.group_id)
  }, [group, selected])

  const value = useMemo<GroupState>(() => ({
    groups, activeGroups, group, loading: q.isLoading, error: q.error,
    select: (id) => {
      setSelected(id)
      try { localStorage.setItem(STORAGE_KEY, id) } catch { /* almacenamiento no disponible */ }
    },
    refetch: () => void q.refetch(),
  }), [groups, activeGroups, group, q])

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>
}

export function useGroup() {
  const ctx = useContext(GroupContext)
  if (!ctx) throw new Error('useGroup fuera de GroupProvider')
  return ctx
}
