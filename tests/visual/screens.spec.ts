import { expect, test } from '@playwright/test'
import { mockBackend } from './mockBackend'

const shot = (name: string, project: string) => `test-results/screens/${project}/${name}.png`

test.describe('pantallas', () => {
  test('inicio: solo partidos de la quiniela', async ({ page }, info) => {
    await mockBackend(page)
    await page.goto('/')
    await expect(page.getByRole('heading', { name: '10 partidos abiertos' })).toBeVisible()
    await expect(page.getByText('Bolsa acumulada')).toBeVisible()
    await expect(page.getByText(/\$1,200/)).toBeVisible()
    await expect(page.getByText('Premio de esta semana')).toBeVisible()
    await expect(page.getByRole('link', { name: /Llenar mi quiniela/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Próximo partido' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Hacer pronóstico' })).toHaveAttribute('href', /\/quinielas$/)
    await expect(page.getByRole('heading', { name: 'Más partidos de tu quiniela' })).toBeVisible()
    // Los destacados de otras ligas ya no aparecen en Inicio.
    await expect(page.getByText(/Local Ficticio|Visita Ficticia|Partido destacado/)).toHaveCount(0)
    await expect(page.getByText(/API-Football|proveedor|sincroniz/i)).toHaveCount(0)
    await expect(page.getByRole('img', { name: 'SHABEX — La Quiniela' }).first()).toBeVisible()
    await page.screenshot({ path: shot('01-inicio', info.project.name), fullPage: true })
  })

  test('inicio sin partidos: estados vacíos con acciones reales', async ({ page }, info) => {
    await mockBackend(page, { featured: [], noGroup: true })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Sin partidos abiertos' })).toBeVisible()
    await expect(page.getByText('Aún no hay partidos en la quiniela')).toBeVisible()
    await expect(page.getByText(/grupo/i)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'En vivo' })).toHaveCount(0)
    await page.getByRole('main').getByRole('link', { name: 'Ver mi quiniela' }).click()
    await expect(page).toHaveURL(/\/quinielas$/)
    await page.screenshot({ path: shot('01b-inicio-vacio', info.project.name), fullPage: true })
  })

  test('mi quiniela: marcador obligatorio, se guarda solo y solo se envía completa', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { calls })
    await page.goto('/quinielas')
    await expect(page.getByRole('heading', { name: 'Mi quiniela' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Resultados' })).toBeVisible()
    await expect(page.getByText('Añadido por el admin').first()).toBeVisible()
    // Sin marcadores: no se puede enviar; el botón lleva al primero que falta.
    const goMissing = page.getByRole('button', { name: /Faltan 10 marcadores/ })
    await expect(goMissing).toBeVisible()
    await expect(page.getByRole('button', { name: 'Enviar quiniela' })).toHaveCount(0)
    await page.screenshot({ path: shot('02-mi-quiniela', info.project.name) })
    const plus = page.getByRole('button', { name: /^Más goles de/ })
    const minus = page.getByRole('button', { name: /^Menos goles de/ })
    // Partido 1: 2-1 · resto: 0-0 (con «−» desde vacío)
    await plus.nth(0).click(); await plus.nth(0).click(); await plus.nth(1).click()
    await expect(page.getByText(/^Gana /).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Faltan 9 marcadores/ })).toBeVisible()
    for (let i = 2; i < 20; i++) await minus.nth(i).click()
    await expect.poll(() => calls.includes('save_pool_picks'), { timeout: 5000 }).toBe(true)
    const send = page.getByRole('button', { name: 'Enviar quiniela' })
    await expect(send).toBeVisible()
    await send.click()
    const dialog = page.getByRole('dialog', { name: '¿Enviar tu quiniela?' })
    await expect(dialog.getByText('2-1')).toBeVisible()
    await page.screenshot({ path: shot('03-confirmacion', info.project.name) })
    expect(calls).not.toContain('submit_pool_picks')
    await dialog.getByRole('button', { name: 'Enviar mis 10 marcadores' }).click()
    await expect(page.getByRole('heading', { name: '¡Gracias por participar!' })).toBeVisible()
    await expect(page.getByText('Mucha suerte 🍀')).toBeVisible()
    expect(calls).toContain('submit_pool_picks')
    await page.screenshot({ path: shot('03c-gracias', info.project.name) })
    await page.getByRole('button', { name: 'Listo' }).click()
    await expect(page.getByRole('heading', { name: '¡Gracias por participar!' })).toHaveCount(0)
  })

  test('sin pago: la quiniela se guarda sola pero no se envía, y ve cómo pagar', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { paid: false, calls })
    await page.goto('/quinielas')
    await expect(page.getByText(/para enviarla necesitas tu pago confirmado/)).toBeVisible()
    await page.getByRole('button', { name: /^Más goles de/ }).nth(0).click()
    await page.getByRole('button', { name: /^Menos goles de/ }).nth(1).click()
    await expect.poll(() => calls.includes('save_pool_picks'), { timeout: 5000 }).toBe(true)
    await expect(page.getByRole('button', { name: 'Enviar quiniela' })).toHaveCount(0)
    expect(calls).not.toContain('submit_pool_picks')
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

  test('admin: entra directo a su panel exclusivo (sin navegación de jugador)', async ({ page }, info) => {
    await mockBackend(page, { admin: true })
    await page.goto('/')
    await expect(page).toHaveURL(/\/admin$/)
    const adminNav = page.getByRole('navigation', { name: 'Secciones de administración' })
    await expect(adminNav.getByRole('link')).toHaveText(['Próxima quiniela', 'Equipos', 'Resultados', 'Participantes y pagos', 'Consumo API'])
    await expect(page.getByRole('navigation', { name: 'Navegación principal' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Próxima quiniela' })).toBeVisible()
    await expect(page.getByRole('heading', { name: /A · Partidos seleccionados \(3\)/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: /B · Partidos disponibles para agregar \(3\)/ })).toBeVisible()
    await expect(page.getByText('Publicado').first()).toBeVisible()
    await expect(page.getByText('Seleccionado · sin publicar')).toBeVisible()
    await expect(page.getByText('Descubierto').first()).toBeVisible()
    await expect(page.getByText('Revisar: Ya no aparece en API-Football')).toBeVisible()
    await expect(page.getByText('Manual', { exact: true }).first()).toBeVisible()
    await expect(page.getByText(/Mi quiniela|Clasificación/)).toHaveCount(0)
    await page.screenshot({ path: shot('08-admin', info.project.name), fullPage: true })
  })

  test('admin: seleccionar, ordenar y publicar con confirmación y motivo', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { admin: true, calls })
    await page.goto('/admin')
    await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    await page.getByRole('button', { name: 'Agregar', exact: true }).first().click()
    await expect(page.getByRole('heading', { name: /A · Partidos seleccionados \(4\)/ })).toBeVisible()
    await page.getByRole('button', { name: 'Bajar' }).first().click()
    // Quitar un partido publicado con pronósticos avisa antes.
    let warned = ''
    page.once('dialog', (d) => { warned = d.message(); void d.accept() })
    await page.getByRole('button', { name: 'Quitar' }).nth(1).click()
    expect(warned).toMatch(/3 pronósticos enviados/)
    await page.getByRole('button', { name: /^Publicar/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Publicar la quiniela' })
    await expect(sheet.getByText('Se publican (2)')).toBeVisible()
    await expect(sheet.getByText('Se retiran (1)')).toBeVisible()
    await expect(sheet.getByText(/No se borran ni se modifican/)).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Confirmar y publicar' })).toBeDisabled()
    await sheet.getByLabel('Motivo del retiro').fill('Cambio de programación')
    await page.screenshot({ path: shot('08e-publicar', info.project.name) })
    await sheet.getByRole('button', { name: 'Confirmar y publicar' }).click()
    await expect.poll(() => calls.includes('admin_publish_selection')).toBe(true)
    expect(calls.indexOf('admin_save_selection')).toBeLessThan(calls.indexOf('admin_publish_selection'))
  })

  test('admin: quinielas automáticas por semana (modo y armado)', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { admin: true, calls })
    await page.goto('/admin')
    await expect(page.getByRole('heading', { name: 'Armado automático por semana' })).toBeVisible()
    await expect(page.getByText('3/12 elegidos · 2 publicados')).toBeVisible()
    await expect(page.getByText(/Liga MX · Barcelona \(fin de semana\) ✓ · Real Madrid \(fin de semana\)/)).toBeVisible()
    await expect(page.getByRole('radio', { name: 'Automática' })).toHaveAttribute('aria-checked', 'true')
    await page.getByRole('radio', { name: 'Solo seleccionar' }).click()
    await expect.poll(() => calls.includes('admin_set_week_mode')).toBe(true)
    await page.getByRole('button', { name: 'Armar una semana' }).click()
    const sheet = page.getByRole('dialog', { name: 'Armar una semana' })
    await expect(sheet.getByRole('button', { name: 'Durango (Alacranes)' })).toHaveCount(0)
    await expect(sheet.getByRole('button', { name: 'Liga MX (liga)' })).toHaveAttribute('aria-pressed', 'true')
    await page.screenshot({ path: shot('08g-armado-automatico', info.project.name) })
    await sheet.getByRole('button', { name: 'Guardar semana' }).click()
    await expect.poll(() => calls.includes('admin_plan_week')).toBe(true)
  })

  test('admin: vista participante y volver al panel', async ({ page }) => {
    await mockBackend(page, { admin: true })
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Vista participante' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByText('Vista de participante')).toBeVisible()
    await page.getByRole('button', { name: 'Volver al panel' }).click()
    await expect(page).toHaveURL(/\/admin$/)
  })

  test('admin: añadir partido que no apareció', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { admin: true, calls })
    await page.goto('/admin')
    await page.getByRole('button', { name: 'Agregar partido que no aparece' }).click()
    const sheet = page.getByRole('dialog', { name: 'Agregar partido a la selección' })
    await expect(sheet.getByRole('button', { name: 'Buscar y agregar a la selección' })).toBeDisabled()
    await sheet.getByLabel('Buscar equipo local').fill('Atl')
    await sheet.getByRole('button', { name: /Atlético Prueba/ }).click()
    await sheet.getByLabel('Buscar equipo visitante').fill('Dep')
    await sheet.getByRole('button', { name: /Deportivo Demo/ }).click()
    await expect(sheet.getByText('Equipo registrado por el admin').first()).toBeVisible()
    await page.screenshot({ path: shot('08b-anadir-partido', info.project.name) })
    expect(calls).toContain('admin_search_teams')
  })

  test('admin: añadir equipo por nombre (API-Football) y retirar/eliminar sin perder historial', async ({ page }, info) => {
    const calls: string[] = []
    await mockBackend(page, { admin: true, calls })
    await page.goto('/admin/equipos')
    await expect(page.getByText('API-Football #7001 · 4 partidos · 12 pronósticos')).toBeVisible()
    await expect(page.getByText('Retirado').first()).toBeVisible()
    await page.getByRole('button', { name: 'Añadir equipo' }).click()
    const add = page.getByRole('dialog', { name: 'Añadir equipo' })
    await add.getByLabel('Nombre del equipo').fill('Toros')
    await add.getByRole('button', { name: 'Buscar en API-Football' }).click()
    await expect(add.getByText('2 resultados. Elige el equipo correcto:')).toBeVisible()
    await expect(add.getByText('Ya en catálogo')).toBeVisible()
    await expect(add.getByText('País Prueba · API-Football #99001')).toBeVisible()
    await page.screenshot({ path: shot('08f-anadir-equipo', info.project.name) })
    await add.getByRole('button', { name: /Toros FC/ }).click()
    await expect.poll(() => calls.includes('admin_create_team')).toBe(true)
    expect(calls).toContain('provider-fixtures:teams')

    // Con historial: no se puede eliminar, solo retirar.
    await page.getByRole('button', { name: /Atlético Prueba/ }).click()
    const manage = page.getByRole('dialog', { name: 'Atlético Prueba' })
    await expect(manage.getByRole('button', { name: 'Eliminar del catálogo' })).toBeDisabled()
    await expect(manage.getByText(/no se puede eliminar para no perder pronósticos/)).toBeVisible()
    await manage.getByRole('button', { name: 'Retirar equipo' }).click()
    await expect(manage.getByRole('button', { name: 'Confirmar retiro' })).toBeDisabled()
    await manage.getByLabel('Motivo').fill('No forma parte de la quiniela')
    await manage.getByRole('button', { name: 'Confirmar retiro' }).click()
    await expect.poll(() => calls.includes('admin_retire_team')).toBe(true)
    // Sin historial: sí se puede eliminar.
    await page.getByRole('button', { name: /Club Sin Partidos/ }).click()
    await expect(page.getByRole('dialog', { name: 'Club Sin Partidos' }).getByRole('button', { name: 'Eliminar del catálogo' })).toBeEnabled()
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

  test('confirmación: enlace caducado muestra el error, limpia la URL y permite reenviar al sitio correcto', async ({ page }, info) => {
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/auth/v1/resend') return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/auth/confirmar#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired')
    await expect(page.getByRole('heading', { name: 'Enlace caducado' })).toBeVisible()
    await expect(page.getByText('Correo confirmado')).toHaveCount(0)
    expect(page.url()).not.toContain('error_code')
    await page.getByLabel('Correo de la cuenta').fill('persona@example.test')
    const req = page.waitForRequest((r) => r.url().includes('/auth/v1/resend'))
    await page.getByRole('button', { name: 'Reenviar correo de confirmación' }).click()
    const body = (await req).postDataJSON()
    expect(body).toMatchObject({ type: 'signup', email: 'persona@example.test' })
    expect(new URL((await req).url()).searchParams.get('redirect_to') ?? body.options?.email_redirect_to ?? body.gotrue_meta_security?.redirect_to ?? '').toMatch(/\/auth\/confirmar$/)
    await expect(page.getByText(/Solicitud aceptada/)).toBeVisible()
    await page.screenshot({ path: shot('00b-confirmacion-caducada', info.project.name) })
  })

  test('confirmación: enlace válido solo muestra éxito si Supabase confirma el correo', async ({ page }, info) => {
    const user = { id: '00000000-0000-4000-8000-0000000000c1', aud: 'authenticated', role: 'authenticated', email: 'persona@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/auth/v1/verify') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: 'mock.jwt.token', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user }) })
      }
      if (u.pathname === '/auth/v1/user') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/auth/confirmar?token_hash=ficticio123&type=signup')
    await expect(page.getByRole('heading', { name: 'Correo confirmado' })).toBeVisible()
    expect(page.url()).not.toContain('token_hash')
    await page.screenshot({ path: shot('00c-confirmacion-ok', info.project.name) })
  })

  test('confirmación: enlace con la sesión en el fragmento también confirma', async ({ page }) => {
    const user = { id: '00000000-0000-4000-8000-0000000000c2', aud: 'authenticated', role: 'authenticated', email: 'persona@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/auth/v1/user') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    const exp = Math.floor(Date.now() / 1000) + 3600
    // JWT ficticio con forma válida (sin firma real).
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.c2lnbmF0dXJl`
    await page.goto(`/auth/confirmar#access_token=${jwt}&refresh_token=ficticio&expires_at=${exp}&expires_in=3600&token_type=bearer&type=signup`)
    await expect(page.getByRole('heading', { name: 'Correo confirmado' })).toBeVisible()
    expect(page.url()).not.toContain('access_token')
  })

  test('confirmación: si Supabase rechaza el token no se muestra éxito', async ({ page }) => {
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/auth/v1/verify') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: 403, error_code: 'otp_expired', msg: 'Email link is invalid or has expired' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/auth/confirmar?token_hash=usado&type=signup')
    await expect(page.getByRole('heading', { name: 'Enlace caducado' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Reenviar correo de confirmación' })).toBeVisible()
  })

  test('entrar sin confirmar: explica el motivo y ofrece reenviar el correo', async ({ page }, info) => {
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/auth/v1/token') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 400, error_code: 'email_not_confirmed', msg: 'Email not confirmed' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/entrar')
    await page.getByLabel('Correo').first().fill('persona@example.test')
    await page.getByLabel('Contraseña').fill('contrasena-ficticia')
    await page.getByRole('button', { name: 'Entrar' }).click()
    await expect(page.getByText(/Confirma tu correo antes de iniciar sesión/)).toBeVisible()
    await expect(page.getByLabel('Correo de la cuenta')).toHaveValue('persona@example.test')
    await expect(page.getByRole('button', { name: 'Reenviar correo de confirmación' })).toBeVisible()
    await page.screenshot({ path: shot('00d-entrar-sin-confirmar', info.project.name), fullPage: true })
  })

  test('registro con correo ya registrado y sin confirmar: no crea otra cuenta y ofrece reenviar', async ({ page }, info) => {
    const calls: string[] = []
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      calls.push(u.pathname)
      if (u.pathname === '/rest/v1/rpc/auth_email_status') return route.fulfill({ status: 200, contentType: 'application/json', body: '"pending"' })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/registro')
    await page.getByLabel('Alias').fill('Persona')
    await page.getByLabel('Correo').fill(' Persona@Example.test ')
    await page.getByLabel('Contraseña').fill('contrasena-ficticia')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page.getByRole('heading', { name: 'Ya tienes cuenta' })).toBeVisible()
    await expect(page.getByText('No se creó otra cuenta', { exact: false })).toBeVisible()
    expect(calls).not.toContain('/auth/v1/signup')
    await expect(page.getByLabel('Correo de la cuenta')).toHaveValue('persona@example.test')
    await page.screenshot({ path: shot('00e-registro-existente', info.project.name) })
  })

  test('registro de correo nuevo: crea la cuenta con el enlace de confirmación correcto', async ({ page }) => {
    let signupBody: Record<string, unknown> | null = null
    let redirect = ''
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/rest/v1/rpc/auth_email_status') return route.fulfill({ status: 200, contentType: 'application/json', body: '"new"' })
      if (u.pathname === '/auth/v1/signup') {
        signupBody = route.request().postDataJSON()
        redirect = u.searchParams.get('redirect_to') ?? ''
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'u1', email: 'nueva@example.test', identities: [{ id: 'i1' }] }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/registro')
    await page.getByLabel('Alias').fill('Nueva')
    await page.getByLabel('Correo').fill('nueva@example.test')
    await page.getByLabel('Contraseña').fill('contrasena-ficticia')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page.getByRole('heading', { name: 'Revisa tu correo' })).toBeVisible()
    expect(signupBody).toMatchObject({ email: 'nueva@example.test' })
    expect(redirect).toMatch(/\/auth\/confirmar$/)
  })

  test('registro: el error real de Supabase se explica, no se oculta', async ({ page }) => {
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/rest/v1/rpc/auth_email_status') return route.fulfill({ status: 200, contentType: 'application/json', body: '"new"' })
      if (u.pathname === '/auth/v1/signup') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ code: 400, error_code: 'validation_failed', msg: 'Unable to validate email address: invalid format' }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/registro')
    await page.getByLabel('Alias').fill('Nueva')
    await page.getByLabel('Correo').fill('nueva@example.test')
    await page.getByLabel('Contraseña').fill('contrasena-ficticia')
    await page.getByRole('button', { name: 'Crear cuenta' }).click()
    await expect(page.getByRole('alert')).toContainText('formato válido')
    await expect(page.getByText('Ocurrió un error inesperado')).toHaveCount(0)
  })

  test('recuperar contraseña: el enlace abierto en otro navegador permite guardar la nueva contraseña', async ({ page }) => {
    const user = { id: '00000000-0000-4000-8000-0000000000c3', aud: 'authenticated', role: 'authenticated', email: 'persona@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() }
    let updated = false
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/auth/v1/user' && route.request().method() === 'PUT') { updated = true; return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }) }
      if (u.pathname === '/auth/v1/user') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      if (u.pathname === '/rest/v1/profiles') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: user.id, display_name: 'Persona', avatar_url: null, role: 'player', status: 'active', created_at: user.created_at }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    const exp = Math.floor(Date.now() / 1000) + 3600
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, exp, role: 'authenticated' })}.c2lnbmF0dXJl`
    await page.goto(`/restablecer#access_token=${jwt}&refresh_token=ficticio&expires_at=${exp}&expires_in=3600&token_type=bearer&type=recovery`)
    await expect(page.getByRole('heading', { name: 'Nueva contraseña' })).toBeVisible()
    expect(page.url()).not.toContain('access_token')
    await page.getByLabel('Contraseña', { exact: true }).fill('nueva-ficticia-123')
    await page.getByLabel('Confirmar').fill('nueva-ficticia-123')
    await page.getByRole('button', { name: 'Guardar' }).click()
    await expect.poll(() => updated).toBe(true)
  })

  test('recuperar contraseña: el correo se pide con un enlace válido en cualquier navegador', async ({ page }) => {
    let url = ''
    await page.route('https://mock-project.supabase.co/**', (route) => {
      const u = new URL(route.request().url())
      if (u.pathname === '/auth/v1/recover') { url = route.request().url(); return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }) }
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await page.goto('/recuperar')
    await page.getByLabel('Correo').fill(' Persona@Example.test ')
    await page.getByRole('button', { name: 'Enviar enlace' }).click()
    await expect(page.getByText(/recibirás el enlace/)).toBeVisible()
    expect(new URL(url).searchParams.get('redirect_to')).toMatch(/\/restablecer$/)
    expect(url).not.toContain('code_challenge')
  })

  test('login sin sesión', async ({ page }, info) => {
    await page.goto('/entrar')
    await expect(page.getByRole('heading', { name: 'Entrar' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'SHABEX — La Quiniela' }).first()).toBeVisible()
    await page.screenshot({ path: shot('00-login', info.project.name), fullPage: true })
  })
})
