import { useQuery } from '@tanstack/react-query'
import { playerApi } from '@/services/player'
import { qk } from '@/services/queryKeys'
import { DEFAULT_TZ } from '@/lib/time'

export function useAppConfig() {
  const q = useQuery({ queryKey: qk.config, queryFn: playerApi.config, staleTime: 10 * 60_000 })
  return { timezone: q.data?.timezone ?? DEFAULT_TZ, maxGoals: q.data?.max_goals ?? 15, loaded: !!q.data }
}
