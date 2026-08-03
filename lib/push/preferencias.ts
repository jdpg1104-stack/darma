// ============================================================================
// B13 · Preferencias de notificación
//
// ── LA REGLA QUE DECIDE QUÉ TIPOS EXISTEN ──────────────────────────────────
// Si un tipo de notificación no puede completar la frase
//
//     «alguien hizo X **por ti**»
//
// no existe. Ninguna racha, ningún recuento de actividad ajena, ningún «llevas
// 3 días sin entrar». Un aviso que solo busca reabrir la app es publicidad
// disfrazada de cuidado, y en una app de apoyo emocional eso es peor que
// publicidad. La lista de abajo es cerrada a propósito y `sanitizarPrefs`
// descarta cualquier clave que no esté en ella: añadir un tipo nuevo obliga a
// tocar este archivo, que es donde está escrita la regla.
//
// ── POR QUÉ SE SANEA EN CADA LECTURA Y NO SOLO AL GUARDAR ──────────────────
// `notification_prefs.prefs` es un `jsonb` con `grant update (prefs)` para
// `authenticated` (migración 0131): el cliente lo escribe DIRECTAMENTE vía
// PostgREST, sin pasar por ninguna ruta nuestra. Por tanto su contenido no es
// «lo que guardamos», es entrada de usuario arbitraria — puede traer un array,
// un número, `__proto__`, o `te_escucharon: "sí"`. Se sanea al leer.
// ============================================================================

/** Tipos de aviso. Cerrado: cada uno responde a un acto dirigido a la persona. */
export type TipoNotificacion =
  | 'te_escucharon'
  | 'te_ayudo'
  | 'alma_afin_en_crisis'
  | 'mensaje_refugio'
  | 'respuesta_hilo'
  | 'nivel_alcanzado'

/**
 * Preferencias de una persona.
 *
 * `revelar_alias` NO es un tipo de aviso: es una decisión **del emisor** sobre
 * si su alias puede aparecer en los avisos que reciben los demás. Vive aquí
 * porque es la misma fila y la misma pantalla, pero se consulta del lado
 * contrario (ver `lib/push/plantillas.ts`).
 */
export type Preferencias = Partial<Record<TipoNotificacion, boolean>> & {
  revelar_alias?: boolean
}

/** Orden estable para recorrer los tipos en pruebas y en la UI. */
export const TIPOS_NOTIFICACION: readonly TipoNotificacion[] = [
  'te_escucharon',
  'te_ayudo',
  'alma_afin_en_crisis',
  'mensaje_refugio',
  'respuesta_hilo',
  'nivel_alcanzado',
] as const

/** Todas las claves aceptadas, incluida la que no es un tipo de aviso. */
const CLAVES_VALIDAS: ReadonlySet<string> = new Set<string>([
  ...TIPOS_NOTIFICACION,
  'revelar_alias',
])

/**
 * Defaults.
 *
 * ON solo lo que es directo, dirigido y poco frecuente. `respuesta_hilo` está
 * OFF porque un hilo activo puede generar decenas de eventos y ninguno es
 * «por ti» en sentido estricto; `nivel_alcanzado` está OFF porque el nivel es
 * una consecuencia de escuchar, no una recompensa que haya que anunciar para
 * que alguien vuelva.
 */
export const PREFS_POR_DEFECTO: Readonly<Preferencias> = Object.freeze({
  te_escucharon: true,
  te_ayudo: true,
  alma_afin_en_crisis: true,
  mensaje_refugio: true,
  respuesta_hilo: false,
  nivel_alcanzado: false,
  revelar_alias: true,
})

/** ¿Es un tipo conocido? Guarda de tipo para lo que llega de la red. */
export function esTipoNotificacion(valor: unknown): valor is TipoNotificacion {
  return typeof valor === 'string' && (TIPOS_NOTIFICACION as readonly string[]).includes(valor)
}

/**
 * Normaliza cualquier cosa a unas preferencias válidas.
 *
 * Nunca lanza: una preferencia corrupta no puede impedir que alguien reciba el
 * aviso de que un Alma Afín está en crisis. Ante la duda, defaults.
 *
 * Detalles que no son adorno:
 *  - Se parte de `{...PREFS_POR_DEFECTO}`, así que el resultado SIEMPRE tiene
 *    las siete claves. Quien consume no necesita saber de `undefined`.
 *  - Solo se copian claves de `CLAVES_VALIDAS` y solo si el valor es `boolean`
 *    de verdad. `'sí'`, `1` y `'false'` se descartan: convertirlos con `!!`
 *    haría que `'false'` activara un aviso.
 *  - `__proto__`, `constructor` y `prototype` ni siquiera se consideran (no
 *    están en la lista), así que no hay contaminación de prototipo posible. El
 *    objeto se crea además sin prototipo antes de fusionar.
 */
export function sanitizarPrefs(input: unknown): Preferencias {
  const salida: Preferencias = Object.assign(Object.create(null), PREFS_POR_DEFECTO)

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    // `Object.assign({}, salida)` devuelve el objeto con prototipo normal, que
    // es lo que espera el resto del código (y lo que serializa `JSON.stringify`).
    return { ...salida }
  }

  // `Object.entries` sobre el propio objeto: no recorre la cadena de
  // prototipos, así que un `__proto__` inyectado por `JSON.parse` tampoco
  // llegaría por esta vía.
  for (const [clave, valor] of Object.entries(input as Record<string, unknown>)) {
    if (!CLAVES_VALIDAS.has(clave)) continue
    if (typeof valor !== 'boolean') continue
    ;(salida as Record<string, boolean>)[clave] = valor
  }

  return { ...salida }
}

/**
 * ¿Esta persona quiere este aviso?
 *
 * Recibe `unknown` a propósito: quien llama tiene el `jsonb` crudo de la base y
 * no debería tener que acordarse de sanearlo antes. Aquí no se puede olvidar.
 */
export function estaActivo(prefs: unknown, tipo: TipoNotificacion): boolean {
  return sanitizarPrefs(prefs)[tipo] === true
}

/**
 * ¿El EMISOR permite que su alias salga en los avisos ajenos?
 *
 * Se separa de `estaActivo` porque la confusión entre «mis preferencias» y «las
 * de quien me escribe» es exactamente el fallo de anonimato que este bloque
 * tiene que evitar: `revelar_alias` se consulta SIEMPRE sobre el emisor.
 */
export function revelaAlias(prefsDelEmisor: unknown): boolean {
  return sanitizarPrefs(prefsDelEmisor).revelar_alias === true
}
