// ============================================================================
// Autenticación de las rutas de cron — LA ÚNICA IMPLEMENTACIÓN
//
// Vivía duplicada en `lib/ingest/cronAuth.ts` (B08) y `lib/ranking/cronAuth.ts`
// (B06). Eran la misma comparación en tiempo constante escrita dos veces, con
// dos nombres. Se sube aquí y los dos módulos pasan a re-exportar.
//
// ── POR QUÉ NO PODÍAN SEGUIR SIENDO DOS ────────────────────────────────────
// Esto es código de seguridad, y el problema de dos copias de código de
// seguridad no es la estética: es que un arreglo se aplica en una y se olvida
// en la otra, y nadie se entera porque las dos siguen pasando sus tests. Los
// dos ficheros ya habían divergido en un detalle del relleno (`Math.max(a, b)`
// frente a `Math.max(a, b, 1)`), que es exactamente la forma que tiene esa
// clase de fallo de empezar.
//
// El argumento original de B06 para no importar B08 —«`lib/ingest/**` es
// propiedad exclusiva de B08, importarlo ataría el cron del ranking a los
// cambios de la ingesta»— era correcto, y por eso la solución no es que uno
// importe al otro sino que los dos importen de `lib/`, que no es de nadie.
//
// ── DOS PROPIEDADES QUE NO SE NEGOCIAN ─────────────────────────────────────
//
//  1. FAIL-CLOSED. Sin `CRON_SECRET` en el entorno → 401 SIEMPRE. La tentación
//     es «si no hay secreto configurado, deja pasar, que estamos en local»: eso
//     es lo que convierte un despliegue con una variable olvidada en un
//     endpoint abierto que cualquiera puede martillear.
//
//  2. COMPARACIÓN EN TIEMPO CONSTANTE. `a === b` sobre strings sale en cuanto
//     encuentra el primer byte distinto, y ese tiempo es medible por red con
//     suficientes muestras: se puede reconstruir el secreto byte a byte.
//     `timingSafeEqual` tarda lo mismo acierte o falle.
//
// Estas rutas van con `runtime = 'nodejs'` y no `edge`: `timingSafeEqual` viene
// de `node:crypto`.
// ============================================================================

import { timingSafeEqual } from 'node:crypto'

const PREFIJO = 'Bearer '

/**
 * ¿Es válida la cabecera `Authorization` de este disparo?
 *
 * PURA respecto a la red y al entorno: recibe la cabecera y el secreto, así que
 * el camino de fallo se prueba sin petición y sin `process.env`.
 *
 * @param cabecera valor de `Authorization`, o `null`/`undefined` si no venía.
 * @param secreto  `CRON_SECRET`; ausente o vacío ⇒ false (fail-closed).
 */
export function esCronAutorizado(
  cabecera: string | null | undefined,
  secreto: string | null | undefined,
): boolean {
  if (typeof secreto !== 'string' || secreto.length === 0) return false
  if (typeof cabecera !== 'string' || cabecera.length === 0) return false
  if (!cabecera.startsWith(PREFIJO)) return false

  const enviado = Buffer.from(cabecera.slice(PREFIJO.length), 'utf8')
  const esperado = Buffer.from(secreto, 'utf8')

  // `timingSafeEqual` LANZA si los búferes no miden lo mismo, y comprobar las
  // longitudes antes con un `return` temprano filtraría la longitud del secreto
  // por tiempo. Se rellenan los dos hasta el mismo tamaño, se compara SIEMPRE,
  // y la igualdad de longitudes se exige DESPUÉS, sobre un booleano ya
  // calculado. El `, 1` del `Math.max` evita un `Buffer.alloc(0)`: con el
  // secreto vacío ya se ha salido arriba, pero un búfer de tamaño cero
  // dependiendo de que esa guarda siga estando es justo lo que no queremos.
  const largo = Math.max(enviado.length, esperado.length, 1)
  const rellenar = (buf: Buffer): Buffer => {
    const salida = Buffer.alloc(largo)
    buf.copy(salida)
    return salida
  }

  const iguales = timingSafeEqual(rellenar(enviado), rellenar(esperado))
  return iguales && enviado.length === esperado.length
}

/**
 * Lee el secreto EN EL MOMENTO de la petición, no al importar el módulo: en
 * Vercel las variables se inyectan antes del handler, pero un módulo cacheado
 * entre despliegues conservaría el valor viejo.
 */
export function secretoCron(): string | undefined {
  return process.env.CRON_SECRET
}
