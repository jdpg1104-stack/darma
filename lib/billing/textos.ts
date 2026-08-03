// ============================================================================
// Textos de la economía — español directo
//
// La frase de la línea roja está AQUÍ y no tecleada en cada componente porque
// tiene que ser LA MISMA en las cinco superficies de pago. Una frase que dice
// casi lo mismo en cinco sitios se convierte, con el tiempo, en cinco frases
// distintas, y la última en cambiar acaba diciendo algo que no queríamos decir.
//
// Deuda de traducción anotada en HANDOFF/PEDIDOS.md: el catálogo i18n (B17) va
// en paralelo y este bloque no puede editar `messages/**`.
// ============================================================================

/**
 * La frase del producto. Aparece **en texto** en toda superficie de pago:
 * tienda, diálogo de boost, selector de regalo, saldo e historial.
 *
 * No es un aviso legal ni una nota al pie: es la promesa que hace que alguien
 * se fíe de contar aquí lo que le pasa. Si un día hay que quitarla de una
 * pantalla, lo que hay que revisar es la pantalla.
 */
export const FRASE_LINEA_ROJA = 'Los cristales no dan karma ni prioridad. Escuchar sí.'

/** Explicación larga, para la tienda. */
export const EXPLICACION_CRISTALES =
  'Los cristales pagan decoración y un poco de alcance, durante un rato. ' +
  'No suben tu karma, no te ponen antes en la cola de nadie y no cambian el ' +
  'orden en el que se atiende a quien está en crisis.'

/** Se pinta junto a la opción de karma en el diálogo de boost. */
export const EXPLICACION_CUPO_GRATIS =
  'Tienes un impulso gratis al día. Lo paga el karma que ya ganaste escuchando ' +
  'a otras personas: que te lean nunca depende de que pagues.'

/** Se pinta cuando la tienda no está disponible (web, o IAP sin configurar). */
export const TIENDA_SOLO_EN_LA_APP =
  'Los cristales solo se compran desde la aplicación móvil. ' +
  'Todo lo demás funciona igual aquí.'

/** Junto al selector de regalo. */
export const EXPLICACION_REGALO =
  'Un regalo es un gesto visible en el hilo. Parte se queda en Darma para ' +
  'sostenerlo y el resto llega a quien lo recibe, en cristales. No le da karma: ' +
  'el karma se gana escuchando.'
