import { useEffect, useState, useSyncExternalStore } from 'react'
import { detectPlatform, isStandalone, type InstallPlatform } from './platform'

/** Evento propio de Chrome/Edge/Samsung para el diálogo nativo de instalación. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installedNow = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

/** Se llama una vez al arrancar: el evento puede llegar antes de que se pinte Inicio. */
export function initInstallCapture() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    installedNow = true
    emit()
  })
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l) }

const DISMISS_KEY = 'shabex.install.dismissedAt'
const DISMISS_DAYS = 14
const readDismissed = () => {
  try { const v = Number(localStorage.getItem(DISMISS_KEY) ?? 0); return v > 0 && Date.now() - v < DISMISS_DAYS * 86400e3 } catch { return false }
}

export function useInstall() {
  const canPrompt = useSyncExternalStore(subscribe, () => deferred !== null, () => false)
  const justInstalled = useSyncExternalStore(subscribe, () => installedNow, () => false)
  const [platform] = useState<InstallPlatform>(() => detectPlatform())
  const [standalone, setStandalone] = useState(() => isStandalone())
  const [dismissed, setDismissed] = useState(readDismissed)
  useEffect(() => {
    const mq = window.matchMedia?.('(display-mode: standalone)')
    const on = () => setStandalone(isStandalone())
    mq?.addEventListener?.('change', on)
    return () => mq?.removeEventListener?.('change', on)
  }, [])

  /** Abre el diálogo nativo (Android/Chrome). Devuelve false si no está disponible. */
  const promptInstall = async () => {
    if (!deferred) return false
    const ev = deferred
    deferred = null
    emit()
    await ev.prompt()
    const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
    return choice.outcome === 'accepted'
  }
  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())) } catch { /* sin almacenamiento: solo esta vez */ }
    setDismissed(true)
  }
  return { platform, standalone, installed: standalone || justInstalled, canPrompt, promptInstall, dismissed, dismiss }
}
