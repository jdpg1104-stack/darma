import { hayCredencialesAdmin } from './utils/admin'
import { cargarEnvLocal } from './utils/entorno'
import { idRun } from './utils/idRun'
import { limpiarPorPrefijo } from './utils/limpieza'

/**
 * Barrido final POR PREFIJO. Idempotente y a prueba de tests que revientan a
 * mitad: los ids se pierden cuando algo falla, el prefijo no.
 *
 * `darma-dev` es un plan gratuito de 500 MB compartido con los demás bloques.
 * Ya se quedó en solo-lectura una vez por dejar datos de prueba acumulados; no
 * es una limpieza estética.
 */
export default async function globalTeardown(): Promise<void> {
  cargarEnvLocal()
  if (!hayCredencialesAdmin()) return

  const borrados = await limpiarPorPrefijo(idRun)
  console.warn(`[e2e] limpieza final: ${borrados} usuarios borrados con prefijo ${idRun}`)
}
