import { expect, test } from '@playwright/test'
import { mockBackend } from './mockBackend'

const shot = (name: string, project: string) => `test-results/screens/${project}/${name}.png`

test.describe('pantallas', () => {
  test('inicio', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Jornada 12' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Continuar borrador/ })).toBeVisible()
    await expect(page.getByRole('timer').first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Partidos destacados' })).toBeVisible()
    await expect(page.getByText('Partido destacado')).toBeVisible()
    // El destacado incluido en la jornada lleva a pronosticar; los demás no se agregan solos.
    await expect(page.getByRole('link', { name: 'Hacer pronóstico' })).toHaveAttribute('href', /\/quinielas\/r-open$/)
    await expect(page.getByRole('heading', { name: 'En vivo' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Próximos partidos' })).toBeVisible()
    await expect(page.getByLabel('Código de invitación')).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'SHABEX — La Quiniela' }).first()).toBeVisible()
    await page.screenshot({ path: shot('01-inicio', info.project.name), fullPage: true })
  })

  test('inicio sin destacados ni grupo: estados vacíos con acciones reales', async ({ page }, info) => {
    await mockBackend(page, { featured: [], noGroup: true })
    await page.goto('/')
    await expect(page.getByText('Sin partidos destacados por ahora')).toBeVisible()
    await expect(page.getByText('Únete a un grupo para jugar la quiniela')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'En vivo' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Grupos', exact: true }).first().click()
    await expect(page).toHaveURL(/\/grupos$/)
    await expect(page.getByLabel('Código de invitación')).toBeVisible()
    await page.screenshot({ path: shot('01b-inicio-vacio', info.project.name), fullPage: true })
  })

  test('grupos', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/grupos')
    await expect(page.getByRole('heading', { name: 'Grupos' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: 'Los del Barrio' })).toContainText('8 jugadores')
    await expect(page.getByText('Unirme a otro grupo')).toBeVisible()
    await page.screenshot({ path: shot('09-grupos', info.project.name), fullPage: true })
  })

  test('quinielas', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/quinielas')
    await expect(page.getByRole('tab', { name: /Disponibles/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('tab', { name: /Finalizadas/ }).click()
    await expect(page.getByText('Jornada 11')).toBeVisible()
    await page.screenshot({ path: shot('02-quinielas', info.project.name), fullPage: true })
  })

  test('hacer quiniela: progreso, edición y revisión', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/quinielas/r-open/jugar')
    await expect(page.getByText('6', { exact: true }).first()).toBeVisible()
    await page.screenshot({ path: shot('03-jugar', info.project.name), fullPage: false })
    // completar los 4 pendientes
    for (let i = 7; i <= 10; i++) {
      const card = page.locator('li', { hasText: `Partido ${i}` })
      await card.getByRole('textbox').first().fill('1')
      await card.getByRole('textbox').nth(1).fill('0')
    }
    await expect(page.getByText('Borrador guardado')).toBeVisible({ timeout: 5000 })
    const btn = page.getByRole('button', { name: 'Revisar y enviar' })
    await expect(btn).toBeEnabled()
    await btn.click()
    await expect(page.getByRole('dialog', { name: 'Confirma tu quiniela' })).toBeVisible()
    await page.screenshot({ path: shot('04-revision', info.project.name) })
  })

  test('campos de goles rechazan texto y negativos', async ({ page }) => {
    await mockBackend(page)
    await page.goto('/quinielas/r-open/jugar')
    const input = page.locator('li', { hasText: 'Partido 7' }).getByRole('textbox').first()
    await input.fill('-3a')
    await expect(input).toHaveValue('3')
    await input.fill('99')
    await expect(input).toHaveValue('15')
  })

  test('resultados de jornada', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/quinielas/r-fin')
    await expect(page.getByText('Resultados oficiales')).toBeVisible()
    await expect(page.getByText('de 50 posibles')).toBeVisible()
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
    await expect(page.getByRole('heading', { name: 'Resumen' })).toBeVisible()
    await page.screenshot({ path: shot('08-admin', info.project.name), fullPage: true })
  })

  test('navegación inferior funciona y no tapa contenido', async ({ page }, info) => {
    test.skip(info.project.name === 'desktop', 'En escritorio se usa barra lateral')
    await mockBackend(page)
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Navegación principal' })
    for (const [name, url] of [['Quiniela', /quinielas$/], ['Clasificación', /clasificacion$/], ['Grupos', /grupos$/], ['Perfil', /perfil$/], ['Inicio', /\/$/]] as const) {
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
