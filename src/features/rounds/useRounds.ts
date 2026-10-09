import { useQuery } from '@tanstack/react-query'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import type { RoundListItem } from '@/types/domain'

export function useRounds(groupId: string | undefined) {
  return useQuery({
    queryKey: qk.rounds(groupId ?? 'none'),
    queryFn: () => playerApi.rounds(groupId!),
    enabled: !!groupId,
    refetchInterval: 60_000,
  })
}

const PRIORITY: Record<string, number> = { open: 0, upcoming: 1, in_progress: 2, closed: 3, under_review: 4, finished: 5, draft: 9 }

/** Jornada destacada en Inicio: la abierta más urgente, si no la próxima o la en curso. */
export function pickFeaturedRound(rounds: RoundListItem[]): RoundListItem | null {
  const sorted = [...rounds].sort((a, b) => {
    const p = (PRIORITY[a.phase] ?? 9) - (PRIORITY[b.phase] ?? 9)
    if (p !== 0) return p
    if (a.phase === 'open' && a.my_status !== b.my_status) return a.my_status === 'submitted' ? 1 : -1
    return a.phase === 'finished'
      ? new Date(b.deadline_at).getTime() - new Date(a.deadline_at).getTime()
      : new Date(a.deadline_at).getTime() - new Date(b.deadline_at).getTime()
  })
  return sorted[0] ?? null
}
