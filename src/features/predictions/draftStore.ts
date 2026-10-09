// Respaldo local del borrador: si la red falla, no se pierde lo capturado.
export type Picks = Record<string, { home: number | null; away: number | null }>
export interface LocalDraft { seq: number; picks: Picks; savedToServer: boolean }

const key = (roundId: string, userId: string) => `fp.draft.${userId}.${roundId}`

export function readLocalDraft(roundId: string, userId: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(key(roundId, userId))
    return raw ? (JSON.parse(raw) as LocalDraft) : null
  } catch {
    return null
  }
}

export function writeLocalDraft(roundId: string, userId: string, d: LocalDraft) {
  try { localStorage.setItem(key(roundId, userId), JSON.stringify(d)) } catch { /* sin almacenamiento */ }
}

export function clearLocalDraft(roundId: string, userId: string) {
  try { localStorage.removeItem(key(roundId, userId)) } catch { /* sin almacenamiento */ }
}

/** Secuencia monotónica: nunca menor que la última conocida. */
export function nextSeq(last: number) {
  return Math.max(Date.now(), last + 1)
}

export const completePairs = (picks: Picks, order: string[]) =>
  order.filter((id) => picks[id]?.home != null && picks[id]?.away != null)
