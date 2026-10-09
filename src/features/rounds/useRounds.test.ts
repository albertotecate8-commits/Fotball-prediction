import { describe, expect, it } from 'vitest'
import { pickFeaturedRound } from './useRounds'
import type { RoundListItem } from '@/types/domain'

const r = (id: string, phase: RoundListItem['phase'], deadline: string, my: RoundListItem['my_status'] = 'none') =>
  ({ round_id: id, phase, deadline_at: deadline, my_status: my }) as RoundListItem

describe('jornada destacada', () => {
  it('prioriza la abierta sin enviar más próxima a cerrar', () => {
    const f = pickFeaturedRound([
      r('fin', 'finished', '2026-10-01'), r('a', 'open', '2026-10-20', 'submitted'), r('b', 'open', '2026-10-25'), r('c', 'upcoming', '2026-10-15'),
    ])
    expect(f?.round_id).toBe('b')
  })
  it('sin abiertas: muestra la próxima', () => {
    expect(pickFeaturedRound([r('fin', 'finished', '2026-10-01'), r('up', 'upcoming', '2026-10-30')])?.round_id).toBe('up')
  })
  it('vacío', () => expect(pickFeaturedRound([])).toBeNull())
})
