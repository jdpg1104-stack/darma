// ============================================================================
// Magic link — la respuesta es SIEMPRE la misma, exista o no la cuenta
//
// ── EL ORÁCULO QUE HAY QUE CERRAR ──────────────────────────────────────────
// Si la ruta contestara "te hemos enviado el enlace" cuando la cuenta existe y
// "no hay ninguna cuenta con ese correo" cuando no, se convertiría en un
// buscador: escribe un email, y Darma te dice si esa persona está aquí. En una
// app de salud mental eso no es una fuga de metadatos, es una herramienta. Un
// jefe, una pareja controladora o un acosador solo necesitan el correo de
// alguien —que ya tienen— para averiguar que usa una red de apoyo emocional.
//
// Ni el cuerpo, ni el status, ni el tiempo de respuesta deben distinguir los
// dos casos. Por eso:
//   · el cuerpo es una CONSTANTE, no una expresión que dependa del resultado;
//   · cualquier fallo del proveedor se traga y se registra, en lugar de salir
//     como error, porque un 500 en un caso y un 200 en el otro también es un
//     oráculo;
//   · el rate limit se aplica ANTES, en la ruta, y por hash de contacto, para
//     que tampoco se pueda sondear a base de repetir.
//
// El único caso que sí se responde distinto es la entrada inválida (un texto
// que ni siquiera es un correo): ahí no hay nada que filtrar, porque la
// respuesta no depende de si esa dirección tiene cuenta.
//
// ── LO QUE ESTA FUNCIÓN NO HACE ────────────────────────────────────────────
// No guarda el email. Ni en `profiles`, ni en una cookie, ni en el estado de la
// sesión. Lo que la persona teclea vive en memoria el tiempo de esta llamada.
// ============================================================================

import { sobreOk, type Sobre } from './respuestas.ts'

export interface DatosMagicLink {
  enviado: true
}

/** El cuerpo. Es una constante para que no pueda depender de nada. */
export const RESPUESTA_MAGIC_LINK: DatosMagicLink = Object.freeze({ enviado: true })

export interface OpcionesMagicLink {
  /** Ya validado y normalizado por `validarEmail`. */
  email: string
  /** Envía el enlace. Puede lanzar; da igual, se traga. */
  enviar: (email: string) => Promise<void>
}

/**
 * Ejecuta el envío y devuelve SIEMPRE el mismo sobre.
 *
 * Se separa de la ruta para poder probar precisamente eso: que con un `enviar`
 * que resuelve y con uno que lanza, el status y el cuerpo son idénticos.
 */
export async function procesarMagicLink(opciones: OpcionesMagicLink): Promise<Sobre<DatosMagicLink>> {
  try {
    await opciones.enviar(opciones.email)
  } catch (causa) {
    // Se registra sin el email: el log de Vercel no es el sitio donde debe
    // acabar la dirección que acabamos de prometer no guardar.
    console.error('[darma][auth] fallo al enviar el magic link', causa)
  }

  return sobreOk(RESPUESTA_MAGIC_LINK)
}
