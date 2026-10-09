import { cn } from '@/lib/cn'

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('skeleton rounded-xl', className)} aria-hidden />

export function CardSkeleton({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('card space-y-3 p-5', className)} role="status" aria-label="Cargando">
      <Skeleton className="h-5 w-1/3" />
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className="h-4" />)}
    </div>
  )
}
