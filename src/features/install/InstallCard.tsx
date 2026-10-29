import { useState } from 'react'
import { Download, Smartphone, X } from 'lucide-react'
import { BrandMark } from '@/components/BrandLogo'
import { Button } from '@/components/ui/Button'
import { useToast } from '@/components/ui/Toast'
import { InstallSheet } from './InstallSheet'
import { isMobile } from './platform'
import { useInstall } from './installState'

/**
 * «Instalar GB QUINELA». En Android con soporte abre el diálogo nativo; en iPhone
 * (y donde no hay diálogo) explica los pasos. Abierta como app, no aparece.
 * - variant «home»: invitación que se puede cerrar (no se repite por 14 días).
 * - variant «profile»: siempre disponible para consultar los pasos.
 */
export function InstallCard({ variant }: { variant: 'home' | 'profile' }) {
  const { platform, installed, standalone, canPrompt, promptInstall, dismissed, dismiss } = useInstall()
  const toast = useToast()
  const [open, setOpen] = useState(false)

  if (standalone) {
    // Solo aquí se sabe con certeza que es la app instalada.
    return variant === 'profile' ? (
      <p className="flex items-center gap-2 rounded-2xl border border-success/30 bg-success/10 p-3 text-xs text-success">
        <Smartphone className="size-4" /> Estás usando GB QUINELA como app desde tu pantalla de inicio.
      </p>
    ) : null
  }
  if (variant === 'home' && (dismissed || installed || (!isMobile(platform) && !canPrompt))) return null

  const install = async () => {
    if (canPrompt) {
      const ok = await promptInstall()
      if (ok) toast('¡Listo! GB QUINELA quedó instalada')
      return
    }
    setOpen(true)
  }

  return (
    <section aria-labelledby={`instalar-${variant}`} className="card relative overflow-hidden p-4">
      {variant === 'home' && (
        <button type="button" aria-label="Cerrar invitación para instalar" onClick={dismiss}
          className="absolute right-2 top-2 grid size-8 place-items-center rounded-full text-muted hover:bg-white/5 hover:text-ink"><X className="size-4" /></button>
      )}
      <div className="flex items-center gap-3 pr-6">
        <BrandMark size={44} className="rounded-xl" />
        <div className="min-w-0">
          <h2 id={`instalar-${variant}`} className="font-semibold">Instala GB QUINELA en tu celular</h2>
          <p className="text-xs text-muted">Abre tu quiniela desde la pantalla de inicio, con su propio icono, como una app.</p>
        </div>
      </div>
      <Button block className="mt-3" icon={<Download className="size-5" />} onClick={() => void install()}>Instalar GB QUINELA</Button>
      {installed && <p className="mt-2 text-center text-xs text-success">Se instaló en este dispositivo. Ábrela desde su icono.</p>}
      {variant === 'profile' && !installed && <p className="mt-2 text-center text-[11px] text-faint">¿Ya la instalaste? Ábrela desde el icono de GB QUINELA en tu pantalla de inicio.</p>}
      <InstallSheet open={open} onClose={() => setOpen(false)} platform={platform} />
    </section>
  )
}
