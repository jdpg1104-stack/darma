// ============================================================================
// Envoltorios de ruta — la parte que sí conoce Next.
//
// Toda ruta de B01 se escribe así:
//
//   export async function POST(request: Request) {
//     return manejarRuta(async () => { ... return sobreOk(data) })
//   }
//
// `manejarRuta` garantiza tres cosas que no se pueden dejar a la disciplina de
// quien escribe la ruta:
//   1. Ninguna excepción escapa sin pasar por la redacción de `sobreDeError`.
//   2. Todas las respuestas llevan `Cache-Control: private, no-store`. En una
//      app anónima, una respuesta de sesión cacheada por un intermediario es
//      la identidad de una persona servida a otra.
//   3. El 429 lleva `Retry-After`, que es lo que hace que un cliente bien
//      escrito espere en vez de reintentar en bucle.
// ============================================================================

import { NextResponse } from 'next/server'
import { sobreDeError, type Respuesta, type Sobre } from './respuestas.ts'

/** Cabeceras de toda respuesta de auth. Ninguna de estas rutas es cacheable:
 *  todas dependen de la cookie de sesión. */
const CABECERAS_BASE: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store',
}

function aRespuestaNext<T>(sobre: Sobre<T>): NextResponse<Respuesta<T>> {
  const cabeceras: Record<string, string> = { ...CABECERAS_BASE }

  if (!sobre.cuerpo.ok && sobre.cuerpo.retryAfter !== undefined) {
    cabeceras['Retry-After'] = String(Math.max(1, Math.ceil(sobre.cuerpo.retryAfter)))
  }

  return NextResponse.json(sobre.cuerpo, { status: sobre.status, headers: cabeceras })
}

/**
 * Ejecuta el cuerpo de una ruta y serializa el resultado.
 *
 * El `catch` es la razón de ser de la función: sin él, una excepción se propaga
 * al runtime de Next, que en algunas configuraciones serializa el mensaje del
 * error en la respuesta. Ahí es donde se filtra el nombre de una tabla.
 */
export async function manejarRuta<T>(
  cuerpo: () => Promise<Sobre<T>>,
): Promise<NextResponse<Respuesta<T>>> {
  try {
    return aRespuestaNext(await cuerpo())
  } catch (causa) {
    // El detalle interno se queda aquí. `console.error` está permitido por el
    // eslint del repo justamente para esto; el cuerpo del error del usuario
    // nunca pasa por aquí, solo el fallo técnico.
    console.error('[darma][auth] error no controlado', causa)
    return aRespuestaNext(sobreDeError(causa)) as NextResponse<Respuesta<T>>
  }
}
