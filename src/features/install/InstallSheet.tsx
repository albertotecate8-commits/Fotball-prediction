import { useState } from 'react'
import { Check, Compass, Copy, Download, EllipsisVertical, MonitorDown, PlusSquare, Share } from 'lucide-react'
import { BrandMark } from '@/components/BrandLogo'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import type { InstallPlatform } from './platform'

type Step = { icon: React.ReactNode; title: string; hint?: string }

const ICON = 'size-5'
const STEPS: Record<InstallPlatform, { intro: string; steps: Step[]; note?: string }> = {
  'ios-safari': {
    intro: 'En iPhone se instala desde Safari en 3 pasos:',
    steps: [
      { icon: <Share className={ICON} />, title: 'Pulsa el botón Compartir', hint: 'Es el cuadrito con una flecha hacia arriba, en la barra de Safari (abajo en iPhone, arriba en iPad).' },
      { icon: <PlusSquare className={ICON} />, title: 'Elige «Añadir a pantalla de inicio»', hint: 'Si no la ves, desliza la lista hacia abajo. En algunas versiones está dentro de «Más» o del menú «···».' },
      { icon: <Check className={ICON} />, title: 'Confirma con «Añadir»', hint: 'Arriba a la derecha. Si aparece «Abrir como app web», déjalo activado.' },
    ],
    note: 'Listo: GB QUINELA aparecerá en tu pantalla de inicio con su propio icono.',
  },
  'ios-other': {
    intro: 'Desde este navegador en iPhone:',
    steps: [
      { icon: <Share className={ICON} />, title: 'Toca Compartir', hint: 'En Chrome está en la barra de direcciones (arriba a la derecha); en otros navegadores, en su menú.' },
      { icon: <PlusSquare className={ICON} />, title: 'Elige «Añadir a pantalla de inicio»', hint: 'Si no aparece, abre GB QUINELA en Safari (copia el enlace abajo) y sigue los pasos de Safari.' },
      { icon: <Check className={ICON} />, title: 'Confirma con «Añadir»' },
    ],
  },
  'in-app': {
    intro: 'Estás viendo GB QUINELA dentro de otra app (por ejemplo Instagram, Facebook o TikTok), que no permite instalarla. Ábrela en tu navegador:',
    steps: [
      { icon: <EllipsisVertical className={ICON} />, title: 'Toca el menú «···» de esta pantalla', hint: 'Suele estar arriba a la derecha.' },
      { icon: <Compass className={ICON} />, title: 'Elige «Abrir en Safari» o «Abrir en el navegador»', hint: 'Si no hay esa opción, copia el enlace y pégalo en Safari (iPhone) o Chrome (Android).' },
      { icon: <PlusSquare className={ICON} />, title: 'Luego toca «Instalar GB QUINELA» otra vez', hint: 'Verás los pasos para tu teléfono.' },
    ],
  },
  android: {
    intro: 'En Android se instala desde Chrome (o tu navegador):',
    steps: [
      { icon: <EllipsisVertical className={ICON} />, title: 'Abre el menú del navegador', hint: 'En Chrome son los tres puntos ⋮ arriba a la derecha. En Samsung Internet, el menú ≡ de abajo.' },
      { icon: <Download className={ICON} />, title: 'Toca «Instalar aplicación» o «Añadir a pantalla de inicio»', hint: 'En Samsung Internet: «Añadir página a» → «Pantalla de inicio».' },
      { icon: <Check className={ICON} />, title: 'Confirma con «Instalar»' },
    ],
    note: 'GB QUINELA quedará con su icono entre tus apps.',
  },
  desktop: {
    intro: 'En computadora:',
    steps: [
      { icon: <MonitorDown className={ICON} />, title: 'Chrome o Edge: icono de instalar en la barra de direcciones', hint: 'O en el menú ⋮ → «Instalar GB QUINELA» / «Aplicaciones» → «Instalar este sitio como aplicación».' },
      { icon: <Compass className={ICON} />, title: 'Safari en Mac: Archivo → «Añadir al Dock»' },
    ],
    note: 'Para tenerla en el celular, abre shabex.vercel.app desde tu teléfono.',
  },
  other: {
    intro: 'Este navegador no ofrece una forma de instalar aplicaciones web. Puedes abrir GB QUINELA en Safari (iPhone) o Chrome (Android) y desde ahí añadirla a tu pantalla de inicio.',
    steps: [],
  },
}

/** Ventana con los pasos para añadir GB QUINELA a la pantalla de inicio, según el dispositivo. */
export function InstallSheet({ open, onClose, platform }: { open: boolean; onClose: () => void; platform: InstallPlatform }) {
  const [copied, setCopied] = useState(false)
  const info = STEPS[platform]
  const url = typeof window !== 'undefined' ? window.location.origin + (import.meta.env.BASE_URL || '/') : 'https://shabex.vercel.app/'
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* el usuario puede copiarlo a mano */ }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Instalar GB QUINELA"
      footer={<Button block size="lg" variant="secondary" onClick={onClose}>Entendido</Button>}>
      <div className="space-y-4 text-sm">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3">
          <BrandMark size={48} className="rounded-xl" />
          <div>
            <p className="font-semibold">Tu quiniela a un toque</p>
            <p className="text-xs text-muted">Ábrela desde la pantalla de inicio con su propio icono, sin buscar el enlace.</p>
          </div>
        </div>
        <p className="text-muted">{info.intro}</p>
        {info.steps.length > 0 && (
          <ol className="space-y-2.5">
            {info.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="relative grid size-10 shrink-0 place-items-center rounded-xl border border-gold-soft/40 bg-gold-soft/10 text-gold-soft">
                  {s.icon}
                  <span className="absolute -left-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-brand text-[11px] font-bold text-on-brand">{i + 1}</span>
                </span>
                <div className="min-w-0 pt-0.5">
                  <p className="font-semibold">{s.title}</p>
                  {s.hint && <p className="text-xs text-muted">{s.hint}</p>}
                </div>
              </li>
            ))}
          </ol>
        )}
        {info.note && <p className="text-xs text-success">{info.note}</p>}
        {(platform === 'in-app' || platform === 'ios-other' || platform === 'other') && (
          <Button size="sm" variant="outline" icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />} onClick={() => void copy()}>
            {copied ? 'Enlace copiado' : 'Copiar enlace de GB QUINELA'}
          </Button>
        )}
      </div>
    </Sheet>
  )
}
