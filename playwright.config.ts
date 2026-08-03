import { defineConfig, devices } from '@playwright/test'

// ============================================================================
// Darma · configuración de Playwright (bloque B18)
//
// Los seis recorridos de e2e/specs son la definición ejecutable de «Darma
// funciona»: la reciprocidad 3:1, la privacidad del karma gastable y la tarjeta
// de crisis atraviesan navegador, rutas de API, RLS y triggers de Postgres, y
// ninguna prueba unitaria puede verificarlas de extremo a extremo.
// ============================================================================

const esCI = !!process.env.CI

/**
 * Puerto propio del bloque. B18 es el ÚNICO autorizado a levantar el servidor
 * de desarrollo del árbol compartido, y lo hace en 3018 para no chocar con el
 * 3000 de nadie.
 */
const PUERTO = process.env.E2E_PORT ?? '3018'
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PUERTO}`

export default defineConfig({
  testDir: './e2e/specs',
  fullyParallel: true,

  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',

  // `check_rate_limit` guarda su contador en una tabla de Postgres COMPARTIDA
  // entre workers. Las claves por usuario no colisionan (cada test crea el
  // suyo), pero las claves por IP sí: todos los workers salen de la misma. Con
  // 8 workers empiezan los 429 esporádicos y se depuran fantasmas. 4 en local,
  // 2 en CI (donde además hay reintentos multiplicando la carga).
  workers: esCI ? 2 : 4,

  forbidOnly: esCI,
  retries: esCI ? 2 : 0,

  // Presupuesto de la suite: < 6 minutos. Si se pasa, el equipo deja de
  // ejecutarla y la red de seguridad desaparece.
  timeout: 45_000,
  expect: { timeout: 10_000 },

  reporter: esCI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    // Las trazas y los vídeos son artefactos CON CONTENIDO: los textos de
    // prueba de crisis y los alias quedan grabados. Solo se guardan cuando algo
    // falla, y el contenido es sintético (ver e2e/utils/textos.ts).
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
    locale: 'es-ES',
    timezoneId: 'Europe/Madrid',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: {
          // Sin esto, el <video> NUNCA arranca en Chromium headless: el karma de
          // `content_completed` no sube y se pasa una tarde buscando un bug en
          // app/api/content que no existe.
          args: ['--autoplay-policy=no-user-gesture-required'],
        },
      },
    },
    {
      // Darma se usa de noche, en el móvil. Si solo se prueba escritorio no se
      // está probando Darma: el BotonCrisis flotante y `env(safe-area-inset-*)`
      // solo fallan aquí. En WebKit no hay flag de autoplay equivalente, así que
      // el feed de vídeo dispara la reproducción con un click real — que es
      // exactamente lo que hace una persona.
      name: 'Mobile Safari',
      use: { ...devices['iPhone 13'] },
    },
  ],

  webServer: {
    // En CI se sirve el build de producción a propósito: `next dev` compila cada
    // ruta bajo demanda la primera vez que se visita, y ese retardo variable es
    // flakiness pura, no un fallo de la app.
    command: esCI
      ? `npm run build && npm run start -- --port ${PUERTO}`
      : `npm run dev -- --port ${PUERTO}`,
    url: BASE_URL,
    reuseExistingServer: !esCI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
})
