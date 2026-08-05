import { randomBytes } from 'node:crypto'

/**
 * Prefijo único de ESTA ejecución: `e2e_<8hex>_`.
 *
 * Se calcula una sola vez por proceso de Playwright y se propaga a los workers
 * por variable de entorno. Sin esa propagación cada worker inventaría el suyo y
 * el teardown por prefijo dejaría fuera los usuarios de los otros tres.
 *
 * Todo lo que la suite crea —usuarios, alias, posts— lleva este prefijo. El
 * teardown borra POR PREFIJO y no por lista de ids: los ids se pierden si un
 * test revienta a mitad, el prefijo no.
 */
export const PREFIJO_E2E = 'e2e_'

function calcularIdRun(): string {
  const existente = process.env.E2E_ID_RUN
  if (existente && /^e2e_[0-9a-f]{8}_$/.test(existente)) return existente

  const nuevo = `${PREFIJO_E2E}${randomBytes(4).toString('hex')}_`
  process.env.E2E_ID_RUN = nuevo
  return nuevo
}

/** Prefijo de esta ejecución. Estable dentro del proceso. */
export const idRun = calcularIdRun()

/**
 * Índice del worker de Playwright (TEST_WORKER_INDEX), único en TODA la
 * ejecución — incluidos los dos proyectos (chromium y Mobile Safari), que
 * corren en paralelo los mismos specs con las mismas etiquetas. Sin él, dos
 * workers generaban `e2e_<id>_otro` a la vez y GoTrue rechazaba el segundo con
 * «already been registered». El bug fue invisible mientras los fixtures se
 * saltaban por falta de service_role: la primera ejecución real lo destapó.
 */
function indiceWorker(): string {
  return process.env.TEST_WORKER_INDEX ?? '0'
}

/**
 * Alias/etiqueta única dentro de la ejecución: `e2e_<8hex>_w<worker>x<sufijo>`.
 * Presupuesto de longitud: el CHECK de `profiles.alias` admite 24; el prefijo
 * gasta 13, `w##x` hasta 4, y el sufijo más largo en uso («otro» tras un
 * contador de un dígito) cabe con margen.
 */
export function nombreE2E(sufijo: string): string {
  return `${idRun}w${indiceWorker()}x${sufijo}`
}

/**
 * Correo sintético del usuario de prueba.
 *
 * ⚠️ El registro de Supabase RECHAZA los dominios `.test`, `.local` y
 * `.example.com` con `email_address_invalid`, así que no sirve el TLD reservado
 * de manual. Se usa un dominio que nunca se resuelve y que además es
 * inconfundible en la tabla `auth.users`.
 *
 * Este correo vive SOLO del lado del fixture. Jamás se afirma contra la UI: si
 * apareciera en una pantalla, el recorrido (a) debe fallar.
 */
export function correoE2E(sufijo: string): string {
  return `${nombreE2E(sufijo)}@darma-e2e.dev`
}

/** Contraseña común de los usuarios sintéticos. No protege nada real. */
export const CONTRASENA_E2E = 'Contrasena-De-Prueba-2026!'
