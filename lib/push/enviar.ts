// ============================================================================
// B13 · Envío · nunca lanza, y limpia lo que ya no existe
//
// ── POR QUÉ ESTE MÓDULO NO LANZA NUNCA ─────────────────────────────────────
// El envío de push cuelga de acciones que importan mucho más que él: validar un
// comentario, marcar «necesito hablar», escribir en un refugio. Si una entrega
// fallida propagara una excepción, un servicio de push caído tumbaría la acción
// del usuario. `enviarA()` devuelve `'error'` y sigue. La notificación es un
// efecto secundario, y un efecto secundario no puede romper el efecto principal.
//
// ── POR QUÉ 410/404 SE TRATAN DISTINTO ─────────────────────────────────────
// Un 410 Gone o un 404 del servicio de push significan que ESE navegador ya no
// acepta esa suscripción: el usuario reinstaló la PWA, limpió los datos del
// sitio, o el navegador rotó el endpoint por su cuenta. La fila hay que
// borrarla. Sin esa limpieza, `push_subscriptions` acumula endpoints muertos y
// cada envío masivo paga N peticiones HTTP a un servicio que va a devolver 410
// otra vez — el coste crece con el histórico, no con los usuarios activos.
//
// ── LOS DOS PUERTOS ────────────────────────────────────────────────────────
// `TransportePush` y `RepositorioSuscripciones` existen para que las pruebas
// puedan comprobar el 410 y la limpieza sin red, sin base de datos y sin
// `web-push` instalado. Los defaults son los reales; los tests inyectan dobles
// con `configurarEnvio()`.
// ============================================================================

import { pushConfigurado, configuracionVapid } from './vapid.ts'
import type { CargaPush, ResultadoEnvio, Suscripcion } from './tipos.ts'

export type { CargaPush, ResultadoEnvio, Suscripcion } from './tipos.ts'
export { pushConfigurado } from './vapid.ts'

/** Lotes del envío masivo. Un destinatario lento no puede bloquear a los demás:
 *  cada lote va con `Promise.allSettled`. */
export const TAMANO_LOTE = 100

// ── Puertos ─────────────────────────────────────────────────────────────────

export interface TransportePush {
  entregar(sub: Suscripcion, carga: CargaPush): Promise<ResultadoEnvio>
}

export interface RepositorioSuscripciones {
  /** Borra por id en UNA sola sentencia. Devuelve cuántas filas se fueron. */
  eliminar(ids: string[]): Promise<number>
  /** Marca entrega correcta. Best-effort: si falla, no pasa nada. */
  marcarOk?(ids: string[]): Promise<void>
}

let transporteInyectado: TransportePush | null = null
let repositorioInyectado: RepositorioSuscripciones | null = null

/** SOLO para pruebas. En producción nadie llama a esto. */
export function configurarEnvio(deps: {
  transporte?: TransportePush
  repositorio?: RepositorioSuscripciones
}): void {
  if (deps.transporte) transporteInyectado = deps.transporte
  if (deps.repositorio) repositorioInyectado = deps.repositorio
}

/** SOLO para pruebas: devuelve los puertos a sus implementaciones reales. */
export function restaurarEnvio(): void {
  transporteInyectado = null
  repositorioInyectado = null
}

// ── Transporte real ─────────────────────────────────────────────────────────

/** Forma mínima de `web-push` que usa este módulo. */
interface ModuloWebPush {
  sendNotification(
    suscripcion: { endpoint: string; keys: { p256dh: string; auth: string } },
    carga: string,
    opciones: { vapidDetails: { subject: string; publicKey: string; privateKey: string }; TTL?: number },
  ): Promise<unknown>
}

/** Vida del aviso en el servicio de push. Un día: pasado eso, «te escucharon»
 *  ya no es una noticia y entregarlo solo interrumpe. */
const TTL_SEGUNDOS = 86_400

let webPush: ModuloWebPush | null = null
let webPushIntentado = false

/**
 * Carga `web-push` con especificador en variable.
 *
 * El paquete NO está en `package.json` (no es un archivo de este bloque; pedido
 * anotado en HANDOFF/PEDIDOS.md), y un import literal haría fallar `tsc` en
 * todo el repositorio. Cuando entre en las dependencias, esta función puede
 * volverse un import normal sin que cambie ningún llamante.
 */
async function cargarWebPush(): Promise<ModuloWebPush | null> {
  if (webPushIntentado) return webPush
  webPushIntentado = true
  try {
    const especificador = 'web-push'
    const modulo = await import(/* webpackIgnore: true */ especificador)
    webPush = (modulo.default ?? modulo) as ModuloWebPush
  } catch {
    // Sin paquete instalado: el mismo estado que sin llaves. Silencioso a
    // propósito — ver la cabecera de vapid.ts.
    webPush = null
  }
  return webPush
}

/** Códigos que significan «esta suscripción ya no existe». */
function esGone(estado: number | undefined): boolean {
  return estado === 404 || estado === 410
}

const transporteReal: TransportePush = {
  async entregar(sub, carga) {
    const config = configuracionVapid()
    if (!config) return 'error'

    const modulo = await cargarWebPush()
    if (!modulo) return 'error'

    try {
      await modulo.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        // Solo los cuatro campos de `CargaPush`. Nada de post, autor ni ids.
        JSON.stringify(carga),
        { vapidDetails: config, TTL: TTL_SEGUNDOS },
      )
      return 'ok'
    } catch (causa) {
      const estado =
        typeof causa === 'object' && causa !== null && 'statusCode' in causa
          ? Number((causa as { statusCode?: unknown }).statusCode)
          : undefined

      if (esGone(estado)) return 'gone'

      // Ni el mensaje ni el cuerpo del error se registran: el error de un
      // servicio de push incluye el endpoint completo, que es una capability
      // URL y no debe acabar en los logs de Vercel.
      console.warn('[darma][b13] entrega push fallida', { estado: estado ?? 'desconocido' })
      return 'error'
    }
  },
}

// ── Repositorio real ────────────────────────────────────────────────────────

/**
 * Borra y marca con el cliente ADMIN.
 *
 * ⛔ Es una de las excepciones justificadas de CONTRATOS §6: el envío ocurre en
 * nombre del SISTEMA, no de una sesión. Quien recibe el aviso no está pidiendo
 * nada — puede estar durmiendo —, así que no hay `auth.uid()` con el que RLS
 * pueda trabajar, y `push_subscriptions` no tiene (ni debe tener) política de
 * UPDATE ni de INSERT para nadie.
 */
const repositorioReal: RepositorioSuscripciones = {
  async eliminar(ids) {
    if (ids.length === 0) return 0
    try {
      const { createAdminClient } = await import('../supabase/admin.ts')
      const { data, error } = await createAdminClient()
        .from('push_subscriptions')
        .delete()
        .in('id', ids)
        .select('id')
      if (error) throw new Error(error.code ?? 'delete')
      return data?.length ?? 0
    } catch {
      // No lanza: dejar filas muertas es un problema de coste, no de corrección.
      console.warn('[darma][b13] no se pudieron limpiar suscripciones caducadas')
      return 0
    }
  },

  async marcarOk(ids) {
    if (ids.length === 0) return
    try {
      const { createAdminClient } = await import('../supabase/admin.ts')
      await createAdminClient()
        .from('push_subscriptions')
        .update({ last_ok_at: new Date().toISOString() })
        .in('id', ids)
    } catch {
      // Best-effort puro: `last_ok_at` es diagnóstico, no funcionalidad.
    }
  },
}

function transporte(): TransportePush {
  return transporteInyectado ?? transporteReal
}

function repositorio(): RepositorioSuscripciones {
  return repositorioInyectado ?? repositorioReal
}

// ── API pública ─────────────────────────────────────────────────────────────

/**
 * Entrega a UNA suscripción. Nunca lanza.
 *
 * `'gone'` implica además borrar la fila: quien llama con una sola suscripción
 * no debería tener que acordarse de limpiar.
 */
export async function enviarA(s: Suscripcion, c: CargaPush): Promise<ResultadoEnvio> {
  // Sin llaves no hay envío y no hay error visible: es la misma decisión de
  // vapid.ts. Se comprueba aquí y no dentro del transporte para que el camino
  // apagado no cargue `web-push` ni construya nada.
  if (!pushConfigurado()) return 'error'

  let resultado: ResultadoEnvio
  try {
    resultado = await transporte().entregar(s, c)
  } catch {
    // Un transporte que lanza (un doble mal escrito, un fallo de DNS) se
    // comporta igual que un error de entrega.
    return 'error'
  }

  if (resultado === 'gone') {
    await repositorio().eliminar([s.id])
  } else if (resultado === 'ok') {
    await repositorio().marcarOk?.([s.id])
  }

  return resultado
}

/**
 * Entrega a N suscripciones en lotes, y limpia las caducadas de una vez.
 *
 * Dos cosas que no son adorno:
 *  · `Promise.allSettled` dentro de cada lote: un servicio de push lento no
 *    puede impedir que los demás destinatarios reciban su aviso.
 *  · UN solo `delete ... in (...)` al final, en vez de N borrados: es la
 *    diferencia entre una consulta y cien cuando un despliegue del navegador
 *    invalida miles de endpoints a la vez.
 */
export async function enviarAVarias(
  subs: Suscripcion[],
  c: CargaPush,
): Promise<{ enviadas: number; eliminadas: number }> {
  if (!pushConfigurado() || subs.length === 0) return { enviadas: 0, eliminadas: 0 }

  const caducadas: string[] = []
  const entregadas: string[] = []

  for (let i = 0; i < subs.length; i += TAMANO_LOTE) {
    const lote = subs.slice(i, i + TAMANO_LOTE)

    const resultados = await Promise.allSettled(
      lote.map((sub) => transporte().entregar(sub, c)),
    )

    resultados.forEach((r, indice) => {
      // Una promesa rechazada es un error de entrega, no una excepción que
      // deba subir: `allSettled` ya la contuvo y aquí se clasifica.
      const valor: ResultadoEnvio = r.status === 'fulfilled' ? r.value : 'error'
      if (valor === 'ok') entregadas.push(lote[indice].id)
      else if (valor === 'gone') caducadas.push(lote[indice].id)
    })
  }

  const eliminadas = caducadas.length > 0 ? await repositorio().eliminar(caducadas) : 0
  if (entregadas.length > 0) await repositorio().marcarOk?.(entregadas)

  return { enviadas: entregadas.length, eliminadas }
}
