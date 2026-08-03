// ============================================================================
// B08 · Autenticación de las rutas de cron.
//
// `/api/cron/` es público en `proxy.ts`: los disparos llegan de una máquina, sin
// navegador y sin cookie de sesión, así que el proxy no puede autenticarlos. La
// consecuencia es que CADA handler se autentica solo, y si uno se olvida,
// cualquiera con la URL dispara la ingesta y agota la cuota de moderación —o
// peor, la usa como amplificador contra YouTube desde nuestra IP—.
//
// DOS PROPIEDADES QUE NO SE NEGOCIAN:
//
//  1. FAIL-CLOSED. Sin `CRON_SECRET` en el entorno → 401 SIEMPRE. La tentación
//     es «si no hay secreto configurado, deja pasar, que estamos en local»: eso
//     es exactamente lo que convierte un despliegue con una variable olvidada en
//     un endpoint abierto.
//
//  2. COMPARACIÓN EN TIEMPO CONSTANTE. `a === b` sobre strings sale en cuanto
//     encuentra el primer byte distinto, y ese tiempo es medible por red con
//     suficientes muestras: se puede reconstruir el secreto byte a byte.
//     `timingSafeEqual` tarda lo mismo acierte o falle.
// ============================================================================

import { timingSafeEqual } from 'node:crypto'

/**
 * ¿Es válida la cabecera `Authorization` de este disparo?
 *
 * PURA respecto a la red: se le pasa la cabecera y el secreto, así que el test
 * no necesita ni petición ni entorno.
 *
 * @param cabecera valor de `Authorization`, o null si no venía.
 * @param secreto  `CRON_SECRET`; ausente o vacío ⇒ false.
 */
export function esCronAutorizado(cabecera: string | null | undefined, secreto: string | undefined | null): boolean {
  if (typeof secreto !== 'string' || secreto.length === 0) return false
  if (typeof cabecera !== 'string' || cabecera.length === 0) return false

  const prefijo = 'Bearer '
  if (!cabecera.startsWith(prefijo)) return false
  const enviado = cabecera.slice(prefijo.length)

  const a = Buffer.from(enviado, 'utf8')
  const b = Buffer.from(secreto, 'utf8')

  // `timingSafeEqual` LANZA si las longitudes difieren, y comprobarlas antes
  // filtra la longitud del secreto. Se compara sobre buffers del mismo tamaño
  // y se exige además que las longitudes coincidan: el `&&` evalúa las dos
  // partes porque `iguales` ya está calculado antes del operador.
  const largo = Math.max(a.length, b.length)
  const relleno = (buf: Buffer): Buffer => {
    const out = Buffer.alloc(largo)
    buf.copy(out)
    return out
  }

  const iguales = timingSafeEqual(relleno(a), relleno(b))
  return iguales && a.length === b.length
}

/** Lee el secreto del entorno en el momento de la petición (no al importar el módulo). */
export function secretoCron(): string | undefined {
  return process.env.CRON_SECRET
}
