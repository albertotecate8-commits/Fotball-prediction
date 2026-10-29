import { brand } from '@/config/brand'

export function SetupNotice() {
  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <div className="card max-w-md p-6 text-center">
        <h1 className="display mb-2 text-2xl font-semibold uppercase">{brand.name}</h1>
        <p className="text-sm text-muted">
          Falta configurar <code className="text-gold-soft">VITE_SUPABASE_URL</code> y <code className="text-gold-soft">VITE_SUPABASE_PUBLISHABLE_KEY</code>.
          Copia <code>.env.example</code> a <code>.env</code> y reinicia.
        </p>
      </div>
    </div>
  )
}
