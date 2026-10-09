import { supabase } from '@/lib/supabase'
import { toAppError } from '@/lib/errors'
import type { Profile } from '@/types/domain'

export const profileApi = {
  get: async (uid: string) => {
    const { data, error } = await supabase.from('profiles').select('id, display_name, avatar_url, role, status, created_at').eq('id', uid).single()
    if (error) throw toAppError(error)
    return data as Profile
  },
  updateName: async (uid: string, displayName: string) => {
    const { error } = await supabase.from('profiles').update({ display_name: displayName.trim() }).eq('id', uid)
    if (error) throw toAppError(error)
  },
}
