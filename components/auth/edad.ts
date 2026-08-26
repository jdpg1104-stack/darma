// ============================================================================
// Dominio puro del paso de edad del onboarding.
//
// ── POR QUÉ LA COMPROBACIÓN CORRE EN EL CLIENTE, Y CUÁL ES SU LÍMITE ───────
// La fecha de nacimiento se valida AQUÍ, en el navegador, a propósito: es la
// única forma de que la fecha no viaje. Si la validara el servidor, la fecha
// llegaría a una petición HTTP —y con ella a los logs de acceso, a los buffers
// del proxy y a cualquier traza— aunque después nadie la escribiera en una
// columna. Una fecha de nacimiento más dos datos reidentifican a cualquiera,
// y el contrato de Darma prohíbe justamente acumular identificadores.
//
// El límite asumido: quien mienta con la fecha pasa. Esto es una DECLARACIÓN,
// no una verificación — verificarla exigiría un documento de identidad, es
// decir, exactamente el identificador que esta app promete no pedir. La casilla
// y esta pantalla existen por el RGPD-K/art. 8 (edad mínima declarada), no como
// control real; la restricción de funciones para 16-17 años (`EDAD_ADULTA` en
// `lib/privacy/avisos.ts`) es otra pieza, con sus propios mecanismos.
//
// Este módulo es puro (sin red, sin almacenamiento, sin efectos) para poder
// probarse con `node --test` sin DOM, siguiendo el patrón del repo de separar
// la lógica pura (`*.dominio.ts`); `edad.test.ts` vigila esa pureza sobre el
// propio fuente.
// ============================================================================

import { cumpleEdadMinima } from '../../lib/privacy/avisos.ts'

/** Lo que la pantalla necesita distinguir para hablar claro. */
export type ResultadoEdad = 'cumple' | 'noCumple' | 'invalida'

/**
 * ¿La cadena es una fecha real 'YYYY-MM-DD' y no futura?
 *
 * `cumpleEdadMinima()` colapsa a `false` tanto la fecha imposible como la de
 * quien aún no llega a la edad — responde a UNA pregunta, y ese diseño es
 * correcto para su sitio. Pero la pantalla necesita distinguirlas: a quien se
 * equivocó tecleando hay que decirle «revisa la fecha», no «todavía no puedes
 * entrar». De ahí esta comprobación separada, con las mismas reglas de forma.
 */
export function esFechaDeclaradaPosible(fecha: string, hoy: Date = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return false

  const [anio, mes, dia] = fecha.split('-').map(Number)
  const nacimiento = new Date(Date.UTC(anio, mes - 1, dia))

  // El constructor desborda los días inexistentes (31 de febrero → 3 de marzo);
  // `getUTCDate()` lo delata.
  if (nacimiento.getUTCDate() !== dia || nacimiento.getUTCMonth() !== mes - 1) return false
  return nacimiento.getTime() <= hoy.getTime()
}

/**
 * Evalúa la fecha declarada y devuelve lo que el paso debe hacer con ella.
 * Puro y sin efectos: recibe la fecha, devuelve un veredicto y NO guarda nada.
 * Quien llama debe descartar la fecha en el acto, sea cual sea el resultado.
 *
 * @param fecha 'YYYY-MM-DD' tal y como sale del `<input type="date">`.
 * @param hoy   inyectable para poder probar el borde del cumpleaños.
 */
export function evaluarFechaDeclarada(fecha: string, hoy: Date = new Date()): ResultadoEdad {
  if (!esFechaDeclaradaPosible(fecha, hoy)) return 'invalida'
  return cumpleEdadMinima(fecha, hoy) ? 'cumple' : 'noCumple'
}
