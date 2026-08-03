// ============================================================================
// Textos de la economía — las CLAVES del catálogo, no el texto
//
// Este archivo existía para que la frase de la línea roja no se tecleara cinco
// veces. Sigue existiendo por lo mismo, con un idioma más: lo que centraliza ya
// no es la cadena en español, es la CLAVE de `messages/*.json`.
//
// ── POR QUÉ LA CLAVE Y NO EL TEXTO ──────────────────────────────────────────
// El texto vive en `messages/es.json` y `messages/en.json`, que es el único
// sitio donde puede vivir en los dos idiomas. Una constante en español obliga a
// que exista una segunda copia para el inglés, y dos copias de la misma promesa
// son, con el tiempo, dos promesas distintas — exactamente lo que este archivo
// nació para impedir.
//
// ── QUIÉN TRADUCE ───────────────────────────────────────────────────────────
// **La interfaz.** Una ruta de `/api/billing` no sabe en qué idioma lee quien
// pregunta: devuelve la clave y quien pinta la pantalla la resuelve con su
// locale. Por eso los campos de la respuesta se llaman `…Clave` y no
// `lineaRoja`: lo que viaja es un identificador, y llamarlo por su nombre evita
// que alguien lo pinte tal cual.
//
// `lib/billing/textos.test.ts` comprueba que cada una de estas claves existe y
// tiene texto en los DOS catálogos. Una clave mal escrita no revienta: se
// pintaría en la pantalla de pago tal cual, `karma.economia.lineaRroja`, que es
// una superficie de pago sin la promesa del producto.
// ============================================================================

/**
 * La frase del producto. Aparece **en texto** en toda superficie de pago:
 * tienda, diálogo de boost, selector de regalo, saldo e historial.
 *
 * No es un aviso legal ni una nota al pie: es la promesa que hace que alguien
 * se fíe de contar aquí lo que le pasa. Si un día hay que quitarla de una
 * pantalla, lo que hay que revisar es la pantalla.
 *
 * La pinta `components/economia/FraseLineaRoja.tsx`, y `lineaRoja.test.ts`
 * comprueba que ese componente está en las cuatro superficies de pago y que
 * esta clave tiene texto en los dos idiomas.
 */
export const CLAVE_LINEA_ROJA = 'karma.economia.lineaRoja'

/** Explicación larga, para la tienda. */
export const CLAVE_EXPLICACION_CRISTALES = 'karma.economia.explicacionCristales'

/** Se pinta junto a la opción de karma en el diálogo de boost. */
export const CLAVE_EXPLICACION_CUPO_GRATIS = 'karma.economia.cupoGratis'

/** Se pinta cuando la tienda no está disponible (web, o IAP sin configurar). */
export const CLAVE_TIENDA_SOLO_EN_LA_APP = 'karma.economia.soloEnLaApp'

/** Junto al selector de regalo. */
export const CLAVE_EXPLICACION_REGALO = 'karma.economia.explicacionRegalo'

/**
 * Todas las claves de prosa de la economía, para el test de paridad. Una
 * constante nueva arriba que no se añada aquí no se comprueba contra el
 * catálogo, así que se añade aquí.
 *
 * Las etiquetas de DATOS (paquetes, regalos, medios de pago) no están en esta
 * lista: viven junto a su dato en `catalogo.ts`, `regalos.ts` y `boosts.ts`, y
 * el mismo test las recorre desde allí.
 */
export const CLAVES_DE_TEXTO = [
  CLAVE_LINEA_ROJA,
  CLAVE_EXPLICACION_CRISTALES,
  CLAVE_EXPLICACION_CUPO_GRATIS,
  CLAVE_TIENDA_SOLO_EN_LA_APP,
  CLAVE_EXPLICACION_REGALO,
] as const
