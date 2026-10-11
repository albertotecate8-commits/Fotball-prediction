// Detección (prudente) de plataforma y del modo «app instalada».
// Nunca se afirma algo que el navegador no permite saber con certeza.

export type InstallPlatform = 'ios-safari' | 'ios-other' | 'in-app' | 'android' | 'desktop' | 'other'

interface NavigatorStandalone extends Navigator { standalone?: boolean }

export function detectPlatform(ua = navigator.userAgent, nav: Navigator = navigator): InstallPlatform {
  // Navegadores dentro de otras apps (Instagram, Facebook, TikTok, LinkedIn…).
  if (/FBAN|FBAV|FB_IAB|Instagram|Line\/|TikTok|musical_ly|BytedanceWebview|LinkedInApp|Snapchat|Twitter/i.test(ua)) return 'in-app'
  const iPadOS = /Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) {
    // Chrome, Firefox o Edge en iOS: también pueden añadir a inicio (iOS 16.4+), pero con otros menús.
    if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua)) return 'ios-other'
    return 'ios-safari'
  }
  if (/Android/i.test(ua)) return 'android'
  if (/Windows|Macintosh|Linux|CrOS/.test(ua)) return 'desktop'
  return 'other'
}

/** true si la app se abrió como aplicación instalada (pantalla de inicio). */
export function isStandalone(): boolean {
  try {
    if ((navigator as NavigatorStandalone).standalone === true) return true
    return ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => window.matchMedia(`(display-mode: ${m})`).matches)
  } catch {
    return false
  }
}

export function isMobile(p: InstallPlatform) {
  return p === 'ios-safari' || p === 'ios-other' || p === 'android' || p === 'in-app'
}
