// ============================================================================
// B06 · Envoltorio de ruta con control de caché.
//
// ── POR QUÉ NO SE USA `manejarRuta` DE B01 TAL CUAL ────────────────────────
// `lib/auth/http.ts` fija `Cache-Control: private, no-store` en TODA respuesta,
// y es la decisión correcta allí: sus rutas dependen de la cookie de sesión y
// una respuesta de sesión cacheada por un intermediario es la identidad de una
// persona servida a otra.
//
// El tablero es el único caso de la app donde eso no aplica, y la ficha B06 lo
// pide explícitamente: `public, s-maxage=300, stale-while-revalidate=600`. La
// justificación tiene que ser exacta, porque es una excepción a una regla de
// anonimato:
//
//   · El cuerpo de `GET /api/ranking` es IDÉNTICO para todo el mundo. No lleva
//     ni un campo derivado de `auth.uid()`: es la foto pública, con los mismos
//     alias, los mismos puestos y el mismo `built_at` para cualquiera que
//     pregunte. Dos personas distintas reciben byte a byte lo mismo, así que
//     una respuesta compartida no le da a nadie nada que no fuera a recibir.
//   · Su contenido son campos de `PerfilPublico` (alias, semilla de avatar,
//     nivel) más un número de escuchas ya agregado. Cero PII, cero saldos.
//   · Cambia como mucho una vez por hora, y servirla desde el borde ahorra una
//     consulta por visita en la pantalla más «social» de la app.
//
// `/api/ranking/yo` NO entra en esto: depende de `auth.uid()` y se sirve
// siempre con `private, no-store`. Que las dos rutas estén en el mismo archivo
// y con constantes con nombre es deliberado — la diferencia tiene que verse.
//
// `Vary: Cookie` va en la respuesta cacheable como cinturón adicional: si algún
// día alguien añade un campo dependiente de la sesión, la caché deja de
// compartir en vez de filtrar.
// ============================================================================

import { NextResponse } from 'next/server'

import { sobreDeError, type Respuesta, type Sobre } from '@/lib/auth/respuestas'

/** Respuestas por persona. Idéntico a lo que hace `manejarRuta` de B01. */
export const CACHE_PRIVADA: Readonly<Record<string, string>> = {
  'Cache-Control': 'private, no-store',
}

/** La foto pública. 5 min en el borde + 10 min de servir rancio revalidando. */
export const CACHE_TABLERO: Readonly<Record<string, string>> = {
  'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  Vary: 'Cookie',
}

function aRespuestaNext<T>(
  sobre: Sobre<T>,
  cabecerasExito: Readonly<Record<string, string>>,
): NextResponse<Respuesta<T>> {
  // Un ERROR nunca se cachea, ni siquiera en la ruta cacheable: un 429 o un 500
  // guardado cinco minutos en el borde convierte un problema puntual en una
  // pantalla rota para todo el mundo durante ese rato.
  const cabeceras: Record<string, string> = sobre.cuerpo.ok
    ? { ...cabecerasExito }
    : { ...CACHE_PRIVADA }

  if (!sobre.cuerpo.ok && sobre.cuerpo.retryAfter !== undefined) {
    cabeceras['Retry-After'] = String(Math.max(1, Math.ceil(sobre.cuerpo.retryAfter)))
  }

  return NextResponse.json(sobre.cuerpo, { status: sobre.status, headers: cabeceras })
}

/**
 * Ejecuta el cuerpo de una ruta y serializa el resultado con la forma de
 * CONTRATOS §4. El `catch` es la razón de ser de la función: sin él, una
 * excepción se propaga al runtime de Next, que en algunas configuraciones
 * serializa el mensaje del error en la respuesta — y ahí es donde se filtra el
 * nombre de una tabla.
 */
export async function manejarRankingRuta<T>(
  cuerpo: () => Promise<Sobre<T>>,
  cabecerasExito: Readonly<Record<string, string>> = CACHE_PRIVADA,
): Promise<NextResponse<Respuesta<T>>> {
  try {
    return aRespuestaNext(await cuerpo(), cabecerasExito)
  } catch (causa) {
    console.error('[darma][ranking] error no controlado', causa)
    return aRespuestaNext(sobreDeError(causa), cabecerasExito) as NextResponse<Respuesta<T>>
  }
}
