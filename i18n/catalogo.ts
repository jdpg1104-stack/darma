// ============================================================================
// B17 · Utilidades de catálogo, SIN dependencias de Node.
//
// Vive separado de `i18n/validacion.ts` a propósito: ese módulo importa
// `node:fs` para recorrer el árbol de componentes, y si el barril `i18n/index.ts`
// lo arrastrara, cualquier componente cliente que importe `@/i18n` reventaría al
// empaquetar. Aquí no hay nada que no funcione en el navegador.
// ============================================================================

export type Catalogo = Record<string, unknown>

/** Marca interna para hojas que no son texto. El espacio inicial la hace
 *  imposible de confundir con un mensaje real del catálogo. */
export const MARCA_NO_ES_TEXTO = ' NO_ES_TEXTO:'

/**
 * Aplana `{a: {b: "x"}}` a `{"a.b": "x"}`.
 *
 * Solo hojas de tipo string: un número o un booleano en un catálogo de mensajes
 * es casi siempre un error de edición, así que se marca en vez de ignorarse.
 */
export function aplanar(catalogo: Catalogo, prefijo = ''): Map<string, string> {
  const salida = new Map<string, string>()

  for (const [clave, valor] of Object.entries(catalogo)) {
    const ruta = prefijo === '' ? clave : `${prefijo}.${clave}`
    if (typeof valor === 'string') {
      salida.set(ruta, valor)
    } else if (valor !== null && typeof valor === 'object' && !Array.isArray(valor)) {
      for (const [k, v] of aplanar(valor as Catalogo, ruta)) salida.set(k, v)
    } else {
      salida.set(ruta, `${MARCA_NO_ES_TEXTO}${typeof valor}`)
    }
  }

  return salida
}
