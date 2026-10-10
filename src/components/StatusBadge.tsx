import { Badge, LiveBadge, type Tone } from '@/components/ui/Badge'
import type { MatchStatus, PredictionStatus, RoundPhase } from '@/types/domain'

export const PHASE_LABEL: Record<RoundPhase, string> = {
  draft: 'Borrador', upcoming: 'Próxima', open: 'Abierta', closed: 'Cerrada',
  in_progress: 'En proceso', finished: 'Finalizada', under_review: 'En revisión',
}
const PHASE_TONE: Record<RoundPhase, Tone> = {
  draft: 'neutral', upcoming: 'gold', open: 'accent', closed: 'neutral', in_progress: 'warning', finished: 'success', under_review: 'warning',
}
export const RoundPhaseBadge = ({ phase }: { phase: RoundPhase }) => <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>

export function MyPredictionBadge({ status, phase }: { status: PredictionStatus; phase: RoundPhase }) {
  if (status === 'submitted') return <Badge tone="success">Enviada</Badge>
  if (status === 'draft' && phase === 'open') return <Badge tone="gold">Borrador</Badge>
  if (phase === 'open') return <Badge tone="accent">Pendiente</Badge>
  if (phase === 'upcoming') return null
  return <Badge tone="neutral">Sin quiniela</Badge>
}

export const MATCH_STATUS_LABEL: Record<MatchStatus, string> = {
  scheduled: 'Programado', live: 'En vivo', finished: 'Final', postponed: 'Aplazado', suspended: 'Suspendido',
  cancelled: 'Cancelado', abandoned: 'Abandonado', unknown: 'Por confirmar',
}

export function MatchStatusBadge({ status, elapsed, confirmed }: { status: MatchStatus; elapsed?: number | null; confirmed?: boolean }) {
  if (status === 'live') return <LiveBadge minute={elapsed} />
  if (status === 'finished') return <Badge tone={confirmed ? 'success' : 'warning'}>{confirmed ? 'Final' : 'Final · provisional'}</Badge>
  if (status === 'scheduled') return null
  return <Badge tone={status === 'unknown' ? 'warning' : 'danger'}>{MATCH_STATUS_LABEL[status]}</Badge>
}
