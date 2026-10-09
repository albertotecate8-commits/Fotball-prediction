import { cn } from '@/lib/cn'

const initials = (name: string) =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'

export function Avatar({ name, url, size = 40, className, highlight }: { name: string; url?: string | null; size?: number; className?: string; highlight?: boolean }) {
  return (
    <span style={{ width: size, height: size, fontSize: size * 0.38 }}
      className={cn('relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full border font-bold',
        highlight ? 'border-lime bg-lime text-bg' : 'border-line-strong bg-gradient-to-br from-olive/60 to-surface-2 text-ink', className)}>
      {url ? <img src={url} alt="" className="size-full object-cover" loading="lazy" referrerPolicy="no-referrer" /> : <span aria-hidden>{initials(name)}</span>}
      <span className="sr-only">{name}</span>
    </span>
  )
}
