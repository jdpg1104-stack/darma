import { comprobarFusible, probarCredencialesAdmin } from './utils/admin'
import { cargarEnvLocal } from './utils/entorno'
import { idRun } from './utils/idRun'
import { barrerRestosViejos } from './utils/limpieza'

/**
 * Lo primero que ocurre en la ejecución, en este orden y no en otro:
 *
 *   1. Cargar `.env.local` (el proceso de Playwright no es el de Next).
 *   2. Fijar el prefijo de la ejecución y propagarlo a los workers.
 *   3. **Disparar el fusible anti-producción antes de tocar nada.**
 *   4. Comprobar de verdad si la clave de administración sirve, y propagar el
 *      veredicto a los workers.
 *   5. Barrer los restos de ejecuciones anteriores de más de 24 h.
 */
export default async function globalSetup(): Promise<void> {
  cargarEnvLocal()

  // Sin esto cada worker inventaría su propio prefijo y el teardown dejaría
  // fuera lo que crearon los otros tres.
  process.env.E2E_ID_RUN = idRun

  // El fusible ANTES de cualquier operación, no después.
  comprobarFusible(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.E2E_SUPABASE_PROJECT_REF)

  const veredicto = await probarCredencialesAdmin()
  process.env.E2E_ADMIN_OK = veredicto.ok ? '1' : '0'

  if (!veredicto.ok) {
    // No se aborta: los recorridos que no la necesitan deben poder ejecutarse.
    // Los demás quedan en `test.fixme()` con el motivo, no en rojo con ruido.
    console.warn(
      `[e2e] Sin administración utilizable sobre darma-dev (${veredicto.motivo}). ` +
        'Los recorridos que necesitan crear usuarios, sembrar posts o validar ' +
        'comentarios quedan en test.fixme(). Ver HANDOFF/PEDIDOS.md · B18.',
    )
    return
  }

  const barridos = await barrerRestosViejos(24)
  if (barridos > 0) {
    console.warn(`[e2e] barridos ${barridos} usuarios de ejecuciones anteriores (>24 h).`)
  }
}
