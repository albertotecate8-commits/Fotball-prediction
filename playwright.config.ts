import { defineConfig, devices } from '@playwright/test'

// Pruebas visuales con el backend SIMULADO (ver tests/visual/mockBackend.ts).
export default defineConfig({
  testDir: './tests/visual',
  outputDir: './test-results',
  timeout: 45_000,
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:5179', trace: 'off', colorScheme: 'dark', locale: 'es-MX', timezoneId: 'America/Mexico_City' },
  webServer: {
    command: 'npx vite --port 5179 --strictPort',
    url: 'http://localhost:5179',
    reuseExistingServer: true,
    env: { VITE_SUPABASE_URL: 'https://mock-project.supabase.co', VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_mock' },
  },
  projects: [
    { name: 'phone-small', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'phone-large', use: { ...devices['iPhone 14 Pro Max'], browserName: 'chromium' } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true, browserName: 'chromium' } },
    { name: 'desktop', use: { viewport: { width: 1440, height: 900 }, browserName: 'chromium' } },
  ],
})
