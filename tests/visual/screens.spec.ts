import { expect, test } from '@playwright/test'
import { mockBackend } from './mockBackend'

const shot = (name: string, project: string) => `test-results/screens/${project}/${name}.png`

test.describe('pantallas', () => {
  test('inicio', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '10 partidos abiertos' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Llenar mi quiniela/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Partidos destacados' })).toBeVisible()
    await expect(page.getByText('Partido destacado')).toBeVisible()
    // El destacado incluido en la jornada lleva a pronosticar; los demás no se agregan solos.
    await expect(page.getByRole('link', { name: 'Hacer pronóstico' })).toHaveAttribute('href', /\/quinielas$/)
    await expect(page.getByText(/API-Football|proveedor|sincroniz/i)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'En vivo' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Próximos partidos' })).toBeVisible()
    await expect(page.getByLabel('Código de invitación')).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'SHABEX — La Quiniela' }).first()).toBeVisible()
    await page.screenshot({ path: shot('01-inicio', info.project.name), fullPage: true })
  })

  test('inicio sin destacados ni jornada: estados vacíos con acciones reales', async ({ page }, info) => {
    await mockBackend(page, { featured: [], noGroup: true })
    await page.goto('/')
    await expect(page.getByText('Sin partidos destacados por ahora')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Sin partidos abiertos' })).toBeVisible()
    await expect(page.getByText(/grupo/i)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'En vivo' })).toHaveCount(0)
    await page.getByRole('main').getByRole('link', { name: 'Ver mi quiniela' }).click()
    await expect(page).toHaveURL(/\/quinielas$/)
    await expect(page.getByText('Aún no hay partidos en la quiniela')).toBeVisible()
    await page.screenshot({ path: shot('01b-inicio-vacio', info.project.name), fullPage: true })
  })

  test('mi quiniela: elegir 1X2, guardar en el servidor y enviar con confirmación', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { calls })
    await page.goto('/quinielas')
    await expect(page.getByRole('heading', { name: 'Mi quiniela' })).toBeVisible()
    const groups = page.getByRole('radiogroup')
    await expect(groups).toHaveCount(14)
    await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible()
    await expect(page.getByText('Añadido por el admin').first()).toBeVisible()
    await expect(groups.nth(0).getByRole('radio', { name: /1/ })).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('Pendiente').first()).toBeVisible()
    for (let i = 6; i < 10; i++) await groups.nth(i).getByRole('radio').nth(i % 3).click()
    await expect(groups.nth(9).getByRole('radio').nth(0)).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('Sin guardar').first()).toBeVisible()
    await page.screenshot({ path: shot('02-mi-quiniela', info.project.name) })
    await page.getByRole('button', { name: 'Guardar mi quiniela' }).click()
    await expect(page.getByText(/Guardado en el servidor/)).toBeVisible()
    expect(calls).toContain('save_pool_picks')
  })

  test('mi quiniela: confirmación antes de enviar muestra contestados y faltantes', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { calls })
    await page.goto('/quinielas')
    await expect(page.getByRole('button', { name: 'Enviar pronósticos' })).toBeVisible()
    await page.getByRole('button', { name: 'Enviar pronósticos' }).click()
    const dialog = page.getByRole('dialog', { name: '¿Enviar tus pronósticos?' })
    await expect(dialog.getByText('contestados')).toBeVisible()
    await expect(dialog.getByText('sin contestar', { exact: true })).toBeVisible()
    await page.screenshot({ path: shot('03-confirmacion', info.project.name) })
    expect(calls).not.toContain('submit_pool_picks')
    await dialog.getByRole('button', { name: 'Enviar 6 pronósticos' }).click()
    await expect(page.getByText(/Confirmado por el servidor: 6 pronósticos enviados/)).toBeVisible()
    expect(calls).toContain('submit_pool_picks')
  })

  test('sin pago: puede guardar pero no enviar, y ve cómo pagar', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { paid: false, calls })
    await page.goto('/quinielas')
    await expect(page.getByText(/para enviar necesitas tu pago confirmado/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enviar pronósticos' })).toHaveCount(0)
    await page.getByRole('radiogroup').nth(7).getByRole('radio').nth(1).click()
    await page.getByRole('button', { name: 'Guardar mi quiniela' }).click()
    await expect(page.getByText(/Guardado en el servidor/)).toBeVisible()
    expect(calls).toContain('save_pool_picks')
    expect(calls).not.toContain('submit_quiniela')
    await page.getByRole('link', { name: 'Ver cómo pagar' }).click()
    await expect(page).toHaveURL(/perfil#pago$/)
    await page.screenshot({ path: shot('03b-sin-pago', info.project.name) })
  })

  test('mi perfil: datos de pago con botones para copiar', async ({ page }, info) => {
    await mockBackend(page, { paid: false, payInfo: true })
    await page.goto('/perfil')
    await expect(page.getByRole('heading', { name: 'Mi pago' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copiar CLABE' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copiar referencia' })).toBeVisible()
    await page.getByRole('button', { name: 'Ver instrucciones de pago' }).click()
    await expect(page.getByRole('dialog', { name: 'Cómo pagar' })).toContainText('Banco de Prueba')
    await page.screenshot({ path: shot('07b-pago', info.project.name), fullPage: true })
  })

  test('mi perfil: datos de pago pendientes de configurar', async ({ page }) => {
    await mockBackend(page, { paid: false })
    await page.goto('/perfil')
    await expect(page.getByText(/aún no están configurados/)).toBeVisible()
  })
  test('resultados: pronósticos enviados con puntos y enlaces antiguos redirigen', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/quinielas/r-fin')
    await expect(page).toHaveURL(/\/quinielas$/)
    const results = page.getByRole('heading', { name: 'Resultados' })
    await results.scrollIntoViewIfNeeded()
    await expect(page.getByText('+5 pts').first()).toBeVisible()
    await expect(page.getByText('Enviado').first()).toBeVisible()
    await page.screenshot({ path: shot('05-resultados', info.project.name), fullPage: true })
  })

  test('clasificación', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/clasificacion')
    await expect(page.getByLabel('Podio')).toBeVisible()
    await expect(page.locator('[aria-current="true"]')).toContainText('Alberto')
    await page.screenshot({ path: shot('06-clasificacion', info.project.name), fullPage: true })
  })

  test('perfil', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/perfil')
    await expect(page.getByRole('button', { name: 'Cerrar sesión' }).last()).toBeVisible()
    await page.screenshot({ path: shot('07-perfil', info.project.name), fullPage: true })
  })

  test('admin oculto para jugadores', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/admin')
    await expect(page).toHaveURL(/\/$/)
  })

  test('admin: resumen', async ({ page }, info) => {
    await mockBackend(page, { admin: true })
    await page.goto('/admin')
    await expect(page).toHaveURL(/admin\/partidos$/)
    const adminNav = page.getByRole('navigation', { name: 'Secciones de administración' })
    await expect(adminNav.getByRole('link')).toHaveCount(6)
    await expect(page.getByText('Automático').first()).toBeVisible()
    await expect(page.getByText('Añadido por admin').first()).toBeVisible()
    await expect(page.getByText('Retirado').first()).toBeVisible()
    await page.screenshot({ path: shot('08-admin', info.project.name), fullPage: true })
  })

  test('admin: añadir partido con equipos del catálogo', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { admin: true, calls })
    await page.goto('/admin/partidos')
    await page.getByRole('button', { name: 'Añadir partido' }).click()
    const sheet = page.getByRole('dialog', { name: 'Añadir partido' })
    await expect(sheet.getByRole('button', { name: 'Guardar y publicar' })).toBeDisabled()
    await sheet.getByLabel('Buscar equipo local').fill('Atl')
    await sheet.getByRole('button', { name: /Atlético Prueba/ }).click()
    await sheet.getByLabel('Buscar equipo visitante').fill('Dep')
    await sheet.getByRole('button', { name: /Deportivo Demo/ }).click()
    await expect(sheet.getByText('Equipo registrado por el admin').first()).toBeVisible()
    await sheet.getByRole('button', { name: 'Registrar equipo nuevo' }).count()
    await page.screenshot({ path: shot('08b-anadir-partido', info.project.name) })
    expect(calls).toContain('admin_search_teams')
  })

  test('admin: capturar resultados de partidos iniciados', async ({ page }, info) => {
    await mockBackend(page, { admin: true })
    await page.goto('/admin/resultados')
    await expect(page.getByText(/partido pendiente/)).toBeVisible()
    await expect(page.getByText(/Añadido por el admin/).first()).toBeVisible()
    await page.screenshot({ path: shot('08c-resultados', info.project.name), fullPage: true })
  })

  test('admin: consumo API con presupuesto, saldo estimado y registro', async ({ page }, info) => {
    await mockBackend(page, { admin: true })
    await page.goto('/admin/consumo')
    await expect(page.getByRole('heading', { name: 'Consumo API' })).toBeVisible()
    await expect(page.getByText('consultas de SHABEX hoy · presupuesto interno')).toBeVisible()
    await expect(page.getByRole('progressbar', { name: 'Consumo del presupuesto' })).toHaveAttribute('aria-valuemax', '80')
    await expect(page.getByText('estimación')).toBeVisible()
    await expect(page.getByText('LOW_BUDGET_P3')).toBeVisible()
    await expect(page.getByText(/apisports-key/i)).toHaveCount(0)
    await page.screenshot({ path: shot('08d-consumo-api', info.project.name), fullPage: true })
  })

  test('jugador no ve el panel de consumo', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/admin/consumo')
    await expect(page).toHaveURL(/\/$/)
  })

  test('jugador no ve el botón de admin aunque su perfil diga admin', async ({ page }) => {
    await mockBackend(page, { admin: false })
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Admin' })).toHaveCount(0)
  })

  test('navegación inferior funciona y no tapa contenido', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'En escritorio se usa barra lateral')
    await mockBackend(page)
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Navegación principal' })
    await expect(nav.getByRole('link')).toHaveCount(4)
    for (const [name, url] of [['Mi quiniela', /quinielas$/], ['Clasificación', /clasificacion$/], ['Mi perfil', /perfil$/], ['Inicio', /\/$/]] as const) {
      await nav.getByRole('link', { name }).click()
      await expect(page).toHaveURL(url)
      await expect(nav.getByRole('link', { name })).toHaveAttribute('aria-current', 'page')
    }
    // sin desplazamiento horizontal
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })

  test('login sin sesión', async ({ page }, info) => {
    await page.goto('/entrar')
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'SHABEX — La Quiniela' }).first()).toBeVisible()
    await page.screenshot({ path: shot('00-login', info.project.name), fullPage: true })
  })
})
