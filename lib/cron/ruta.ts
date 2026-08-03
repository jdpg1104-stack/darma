// ============================================================================
// B00 · integración · el cuerpo compartido de las rutas de despacho.
//
// Las tres rutas (`diario`, `frecuente`, `moderacion-pendiente`) hacen lo
// mismo: comprobar el Bearer, tomar el arrendamiento, despachar su lista
// registrando trabajo a trabajo, soltar el arrendamiento y devolver el resumen.
// Lo único que cambia entre ellas es el nombre y la lista, así que vive aquí y
// no copiado tres veces: una comprobación de secreto duplicada es una
// comprobación de secreto que algún día se corrige en dos sitios de tres.
//
// ── AUTENTICACIÓN ──────────────────────────────────────────────────────────
// `Authorization: Bearer <CRON_SECRET>`, fail-closed y en tiempo constante. Se
// REUTILIZA `lib/ingest/cronAuth.ts` (B08) en lugar de copiarlo: ya existe, ya
// está probado y es una primitiva de seguridad. Una tercera copia byte a byte
// de una comparación en tiempo constante es peor que el acoplamiento — hay una
// petición abierta en PEDIDOS.md para unificar las dos que ya existen
// (`lib/ingest/cronAuth.ts` y `lib/ranking/cronAuth.ts`), y añadir una más
// empeoraría justo lo que esa petición quiere arreglar.
//
// `/api/cron/` ya es pública en `proxy.ts`: estos disparos llegan de una
// máquina, sin navegador y sin cookie, así que el proxy no puede autenticarlos
// y cada handler se autentica solo.
// ============================================================================

import type { NextResponse } from 'next/server'
import { ErrorApi } from '../auth/errores.ts'
import { manejarRuta } from '../auth/http.ts'
import { sobreOk, type Respuesta } from '../auth/respuestas.ts'
import { esCronAutorizado, secretoCron } from '../ingest/cronAuth.ts'
import { logger } from '../logger.ts'
import { createAdminClient } from '../supabase/admin.ts'
import { despachar, PRESUPUESTO_DESPACHO_MS } from './despachador.ts'
import { registrarEjecucion, soltarLease, tomarLease } from './registro.ts'
import type { ResultadoDespacho, Trabajo } from './tipos.ts'

/**
 * Duración del arrendamiento. Un poco más que `maxDuration` para que un disparo
 * que muere justo en el límite no deje entrar a otro encima del anterior.
 */
export const LEASE_SEGUNDOS = 70

/** Lo que devuelve un despacho: el resumen, o el aviso de que ya había uno vivo. */
export type DatosDespacho = ResultadoDespacho | { despacho: string; omitido: 'en_curso' }

/**
 * Cuerpo completo de una ruta de despacho.
 *
 * @param nombre       identificador del despacho; va a `cron_runs.despacho`.
 * @param autorizacion cabecera `Authorization` cruda de la petición.
 * @param trabajos     la lista YA en orden de prioridad.
 */
export async function responderDespacho(
  nombre: string,
  autorizacion: string | null,
  trabajos: readonly Trabajo[],
): Promise<NextResponse<Respuesta<DatosDespacho>>> {
  // El genérico va ANOTADO a mano: la unión tiene dos ramas y `sobreOk` inferiría
  // solo la primera que aparece, dejando fuera el atajo del arrendamiento.
  return manejarRuta<DatosDespacho>(async () => {
    // Lo primero de todo: un 401 no debe costar ni una consulta, ni una lectura
    // de entorno de más, ni ser distinguible por tiempo del caso «secreto
    // correcto pero base caída». El registro va explícito porque el `catch` de
    // `manejarRuta` no conoce de qué despacho venía la petición, y en un cron
    // ese dato es la mitad de la línea del log.
    if (!esCronAutorizado(autorizacion, secretoCron())) {
      logger.info('cron_no_autorizado', { ruta: `cron:${nombre}` })
      throw new ErrorApi('no_autenticado')
    }

    const admin = createAdminClient()

    if (!(await tomarLease(admin, nombre, LEASE_SEGUNDOS))) {
      // Ya hay un disparo corriendo. Se sale con 200 y no con error: esto es el
      // sistema funcionando, y un 5xx haría que Vercel reintentara — es decir,
      // que insistiera en solaparse.
      return sobreOk<DatosDespacho>({ despacho: nombre, omitido: 'en_curso' })
    }

    try {
      const resultado = await despachar(nombre, trabajos, {
        admin,
        presupuestoMs: PRESUPUESTO_DESPACHO_MS,
        // Registro INCREMENTAL: si la función muere al agotar `maxDuration`, lo
        // ya corrido ya está escrito. Un registro acumulado en memoria se
        // pierde entero justo el día raro, que es el único día en que se
        // consulta.
        alTerminarTrabajo: (fila) => registrarEjecucion(admin, nombre, fila),
      })
      return sobreOk<DatosDespacho>(resultado)
    } finally {
      // En `finally`: si algo imprevisto se escapa, el arrendamiento se suelta
      // igual y el disparo siguiente no tiene que esperar a que venza.
      await soltarLease(admin, nombre)
    }
  })
}
