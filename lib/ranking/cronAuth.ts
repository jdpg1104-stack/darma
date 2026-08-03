// ============================================================================
// B06 · Autenticación de POST /api/ranking/snapshot
//
// La ruta del constructor se autentica SOLO con `Authorization: Bearer
// <CRON_SECRET>`: sin sesión y sin cookie, porque el disparo llega de una
// máquina de Vercel Cron y no de un navegador.
//
// DOS PROPIEDADES QUE NO SE NEGOCIAN:
//
//  1. FAIL-CLOSED. Sin `CRON_SECRET` en el entorno → 401 SIEMPRE. La tentación
//     es «si no hay secreto configurado, deja pasar, que estamos en local».
//     Eso convierte un despliegue con una variable olvidada en un endpoint que
//     cualquiera puede martillear para reconstruir la foto en bucle.
//
//  2. COMPARACIÓN EN TIEMPO CONSTANTE. `a === b` sobre strings sale en cuanto
//     encuentra el primer byte distinto, y ese tiempo es medible por red con
//     suficientes muestras: se reconstruye el secreto byte a byte.
//
// ── POR QUÉ ESTO NO IMPORTA `lib/ingest/cronAuth.ts` ───────────────────────
// B08 tiene un helper idéntico y es tentador reutilizarlo. No se hace porque
// `lib/ingest/**` es propiedad exclusiva de B08 (HANDOFF/README): importarlo
// ataría el arranque del cron del ranking a los cambios de la ingesta de
// contenido, que son dos cosas sin ninguna relación. Anotado en PEDIDOS.md como
// candidato claro a subir a `lib/` compartido cuando B00 integre.
// ============================================================================

import { timingSafeEqual } from 'node:crypto'

const PREFIJO = 'Bearer '

/**
 * ¿Es válida la cabecera `Authorization` de este disparo?
 *
 * PURA respecto a la red y al entorno: recibe la cabecera y el secreto, así que
 * el test del camino de fallo no necesita ni petición ni `process.env`.
 *
 * @param cabecera valor de `Authorization`, o `null` si no venía.
 * @param secreto  `CRON_SECRET`; ausente o vacío ⇒ false (fail-closed).
 */
export function esCronRankingAutorizado(
  cabecera: string | null | undefined,
  secreto: string | undefined | null,
): boolean {
  if (typeof secreto !== 'string' || secreto.length === 0) return false
  if (typeof cabecera !== 'string' || !cabecera.startsWith(PREFIJO)) return false

  const enviado = Buffer.from(cabecera.slice(PREFIJO.length), 'utf8')
  const esperado = Buffer.from(secreto, 'utf8')

  // `timingSafeEqual` LANZA si las longitudes difieren, y comprobarlas antes
  // con un `return` temprano filtraría la longitud del secreto por tiempo. Se
  // rellenan los dos hasta el mismo tamaño, se compara siempre, y la igualdad
  // de longitudes se exige DESPUÉS, sobre un booleano ya calculado.
  const largo = Math.max(enviado.length, esperado.length, 1)
  const rellenar = (buf: Buffer): Buffer => {
    const salida = Buffer.alloc(largo)
    buf.copy(salida)
    return salida
  }

  const iguales = timingSafeEqual(rellenar(enviado), rellenar(esperado))
  return iguales && enviado.length === esperado.length
}

/** Lee el secreto en el momento de la petición, no al importar el módulo: en
 *  Vercel las variables se inyectan antes del handler, pero un módulo cacheado
 *  entre despliegues conservaría el valor viejo. */
export function secretoCronRanking(): string | undefined {
  return process.env.CRON_SECRET
}
