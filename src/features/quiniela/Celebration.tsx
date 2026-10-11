import { useEffect, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/Button'

/** Balón de futbol dibujado (pentágonos negros sobre blanco). */
function SoccerBall({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <circle cx="32" cy="32" r="30" fill="#f8fafc" stroke="#0f172a" strokeWidth="2" />
      <polygon points="32,20 42,27 38,39 26,39 22,27" fill="#0f172a" />
      <polygon points="32,3 40,8 32,13 24,8" fill="#0f172a" />
      <polygon points="56,22 61,31 55,36 49,29" fill="#0f172a" />
      <polygon points="8,22 15,29 9,36 3,31" fill="#0f172a" />
      <polygon points="18,52 26,50 28,58 20,60" fill="#0f172a" />
      <polygon points="46,52 44,60 36,58 38,50" fill="#0f172a" />
      <g stroke="#0f172a" strokeWidth="1.6" fill="none">
        <path d="M32 20V13M42 27l7 2M38 39l3 11M26 39l-3 11M22 27l-7 2" />
      </g>
    </svg>
  )
}

function Clover({ className }: { className?: string }) {
  const leaf = 'M12 12C10.2 10.6 7.3 8.6 7.6 6.2 7.9 4.4 10.2 3.9 12 5.8 13.8 3.9 16.1 4.4 16.4 6.2 16.7 8.6 13.8 10.6 12 12Z'
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path d="M12.6 13.2c.4 3.2 1.7 6.1 4 8.3" stroke="#1e9e57" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      {[0, 90, 180, 270].map((r) => <path key={r} d={leaf} transform={`rotate(${r} 12 12)`} fill="#2ecc71" stroke="#1e9e57" strokeWidth="0.6" />)}
    </svg>
  )
}

const COLORS = ['#E52B3A', '#00BFEA', '#C8A45D', '#2ecc71', '#DCE2EA']

/** Pantalla de «¡Gracias por participar!»: balón que rebota, tréboles y confeti. */
export function Celebration({ onClose }: { onClose: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus() }, [])
  // Posiciones fijas por montaje (sin parpadeos al re-renderizar).
  const pieces = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    left: (i * 37) % 100, delay: (i % 12) * 0.18, dur: 2.6 + (i % 5) * 0.4, color: COLORS[i % COLORS.length], clover: i % 9 === 0,
  })), [])
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="gracias" className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-bg/85 px-6 backdrop-blur-sm">
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {pieces.filter((p) => !p.clover).map((p, i) => (
          <span key={i} className="absolute top-0 h-3 w-1.5 rounded-sm" style={{ left: `${p.left}%`, background: p.color, animation: `confetti-fall ${p.dur}s linear ${p.delay}s infinite` }} />
        ))}
        {pieces.filter((p) => p.clover).map((p, i) => (
          <span key={`c${i}`} className="absolute top-0" style={{ left: `${(p.left + 11) % 100}%`, animation: `confetti-fall ${p.dur + 1}s linear ${p.delay}s infinite` }}><Clover className="size-6" /></span>
        ))}
      </div>
      <div className="relative w-full max-w-sm text-center [animation:pop-in_0.5s_ease-out_both]">
        <div className="relative mx-auto mb-4 h-52 w-32">
          <div className="absolute inset-x-0 bottom-3 mx-auto size-24 [animation:ball-bounce_1.1s_cubic-bezier(.3,.1,.4,1)_infinite]">
            <SoccerBall className="size-24 drop-shadow-[0_8px_16px_rgba(0,0,0,0.5)] [animation:ball-spin_1.6s_linear_infinite]" />
          </div>
          <div className="absolute inset-x-0 bottom-0 mx-auto h-3 w-20 rounded-[50%] bg-black/60 blur-[2px] [animation:ball-shadow_1.1s_cubic-bezier(.3,.1,.4,1)_infinite]" />
          <Clover className="absolute -right-6 bottom-6 size-12 rotate-12 drop-shadow-[0_2px_6px_rgba(0,0,0,0.5)] [animation:clover-spin_5s_ease-in-out_infinite]" />
        </div>
        <h2 id="gracias" className="display text-4xl font-semibold uppercase leading-none">¡Gracias por participar!</h2>
        <p className="mt-3 text-lg text-gold">Mucha suerte 🍀</p>
        <p className="mt-1 text-sm text-muted">Tu quiniela quedó enviada. Sigue los partidos y mira cómo vas en la clasificación.</p>
        <Button ref={button} size="lg" block className="mt-6" onClick={onClose}>Listo</Button>
      </div>
    </div>
  )
}
