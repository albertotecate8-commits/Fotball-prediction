import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { App } from './app/App'
import { initInstallCapture } from './features/install/installState'
import { reloadForNewBuild } from './app/staleBuild'

// El diálogo nativo de instalación puede llegar antes de que se pinte la app.
initInstallCapture()

// Archivo de una versión anterior que ya no existe: recargar con la nueva.
window.addEventListener('vite:preloadError', (e) => { if (reloadForNewBuild()) e.preventDefault() })

// Service worker: solo en producción y solo para recursos estáticos (ver public/sw.js).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
