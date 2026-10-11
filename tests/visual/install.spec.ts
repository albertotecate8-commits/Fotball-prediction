import { expect, test, type Page } from '@playwright/test'
import { mockBackend } from './mockBackend'

// Instalación como app: se simulan navegadores con su user agent. El diálogo real
// de iOS/Android no se puede abrir en una prueba automática (requiere un teléfono).
const IPHONE_SAFARI = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_CHROME = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const INSTAGRAM = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0'
const shot = (name: string, project: string) => `test-results/screens/${project}/${name}.png`

test.describe('instalar SHABEX', () => {
  // Una sola resolución basta: la lógica no depende del tamaño de pantalla.
  test.beforeEach(({ browserName }, info) => { void browserName; test.skip(info.project.name !== 'phone-small') })

  test('manifest e iconos existen y son válidos', async ({ request }) => {
    const res = await request.get('/manifest.webmanifest')
    expect(res.ok()).toBe(true)
    const m = await res.json()
    expect(m).toMatchObject({ name: 'SHABEX — La Quiniela', short_name: 'SHABEX', display: 'standalone', start_url: './?source=pwa', scope: './' })
    const sizes = (m.icons as { sizes: string; purpose: string }[]).map((i) => `${i.sizes}:${i.purpose}`)
    expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']))
    for (const icon of m.icons as { src: string }[]) {
      const r = await request.get(`/${icon.src}`)
      expect(r.ok(), icon.src).toBe(true)
      expect(r.headers()['content-type']).toContain('image/png')
    }
    for (const p of ['/icons/apple-touch-icon.png', '/icons/apple-touch-icon-180.png', '/sw.js']) expect((await request.get(p)).ok(), p).toBe(true)
    const html = await (await request.get('/')).text()
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('apple-touch-icon')
    expect(html).toContain('apple-mobile-web-app-capable')
  })

  test.describe('iPhone (Safari)', () => {
    test.use({ userAgent: IPHONE_SAFARI })
    test('invitación en Inicio con los 3 pasos de Safari; se puede cerrar y no se repite', async ({ page }, info) => {
      await mockBackend(page)
      await page.goto('/')
      const card = page.getByRole('region', { name: 'Instala SHABEX en tu celular' })
      await expect(card).toBeVisible()
      await card.getByRole('button', { name: 'Instalar SHABEX' }).click()
      const sheet = page.getByRole('dialog', { name: 'Instalar SHABEX' })
      await expect(sheet.getByText('Pulsa el botón Compartir')).toBeVisible()
      await expect(sheet.getByText('Elige «Añadir a pantalla de inicio»')).toBeVisible()
      await expect(sheet.getByText('Confirma con «Añadir»')).toBeVisible()
      await expect(sheet.getByText(/dentro de «Más» o del menú/)).toBeVisible()
      await page.screenshot({ path: shot('09-instalar-iphone', info.project.name) })
      await sheet.getByRole('button', { name: 'Entendido' }).click()
      await card.getByRole('button', { name: 'Cerrar invitación para instalar' }).click()
      await expect(card).toHaveCount(0)
      await page.reload()
      await expect(page.getByRole('heading', { name: 'Próximo partido' })).toBeVisible()
      await expect(page.getByRole('region', { name: 'Instala SHABEX en tu celular' })).toHaveCount(0)
      // En Mi perfil sigue disponible para consultar los pasos.
      await page.goto('/perfil')
      await expect(page.getByRole('button', { name: 'Instalar SHABEX' })).toBeVisible()
    })
  })

  test.describe('Android (Chrome)', () => {
    test.use({ userAgent: ANDROID_CHROME })
    test('usa el diálogo nativo cuando el navegador lo ofrece', async ({ page }) => {
      await mockBackend(page)
      await page.addInitScript(() => {
        // Simula el evento que Chrome dispara cuando la app es instalable.
        window.addEventListener('load', () => setTimeout(() => {
          const ev = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
          ev.prompt = async () => { (window as unknown as { __prompted: boolean }).__prompted = true }
          ev.userChoice = Promise.resolve({ outcome: 'accepted' })
          window.dispatchEvent(ev)
        }, 50))
      })
      await page.goto('/')
      await page.getByRole('button', { name: 'Instalar SHABEX' }).click()
      await expect.poll(() => page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted === true)).toBe(true)
      await expect(page.getByRole('dialog', { name: 'Instalar SHABEX' })).toHaveCount(0)
      await expect(page.getByText('¡Listo! SHABEX quedó instalada')).toBeVisible()
    })

    test('sin diálogo nativo: instrucciones de Chrome y Samsung Internet', async ({ page }, info) => {
      await mockBackend(page)
      await page.goto('/')
      await page.getByRole('button', { name: 'Instalar SHABEX' }).click()
      const sheet = page.getByRole('dialog', { name: 'Instalar SHABEX' })
      await expect(sheet.getByText('Toca «Instalar aplicación» o «Añadir a pantalla de inicio»')).toBeVisible()
      await expect(sheet.getByText(/Samsung Internet/).first()).toBeVisible()
      await page.screenshot({ path: shot('09b-instalar-android', info.project.name) })
    })
  })

  test.describe('navegador dentro de otra app', () => {
    test.use({ userAgent: INSTAGRAM })
    test('explica cómo abrir SHABEX en Safari y permite copiar el enlace', async ({ page }) => {
      await mockBackend(page)
      await page.goto('/')
      await page.getByRole('button', { name: 'Instalar SHABEX' }).click()
      const sheet = page.getByRole('dialog', { name: 'Instalar SHABEX' })
      await expect(sheet.getByText(/Elige «Abrir en Safari» o «Abrir en el navegador»/)).toBeVisible()
      await expect(sheet.getByRole('button', { name: 'Copiar enlace de SHABEX' })).toBeVisible()
    })
  })

  test.describe('abierta como app instalada', () => {
    test.use({ userAgent: IPHONE_SAFARI })
    const asStandalone = async (page: Page) => page.addInitScript(() => {
      const real = window.matchMedia.bind(window)
      window.matchMedia = (q: string) => (q.includes('display-mode: standalone') ? { ...real(q), matches: true, media: q } as MediaQueryList : real(q))
    })
    test('no vuelve a invitar a instalar y lo indica en Mi perfil', async ({ page }) => {
      await mockBackend(page)
      await asStandalone(page)
      await page.goto('/')
      await expect(page.getByRole('heading', { name: 'Próximo partido' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Instalar SHABEX' })).toHaveCount(0)
      await page.goto('/perfil')
      await expect(page.getByText('Estás usando SHABEX como app desde tu pantalla de inicio.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Instalar SHABEX' })).toHaveCount(0)
    })
  })
})
