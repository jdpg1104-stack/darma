// ============================================================================
// Avisos permanentes: «Darma no sustituye a la terapia» y la edad mínima.
//
// ── POR QUÉ EL TEXTO CORTO ESTÁ AQUÍ Y NO EN EL COMPONENTE QUE LO PINTA ────
// Este aviso aparece en el pie de toda la app, en la tarjeta de recursos de
// crisis y en una página legal propia. Si viviera duplicado en tres sitios, el
// día que un abogado o una revisión clínica cambie una palabra, cambiaría en
// dos de los tres. Aquí hay uno solo y los demás lo importan.
//
// ── CÓMO ESTÁ REDACTADO, Y POR QUÉ IMPORTA MÁS QUE EL HECHO DE PONERLO ─────
// El objetivo NO es cubrirnos: es que alguien entienda dónde está. La versión
// que se descartó decía «Darma no presta servicios sanitarios ni sustituye el
// diagnóstico, tratamiento o consejo de un profesional cualificado». Es
// correcta y es exactamente lo que no queremos: quien la lee a las cuatro de la
// madrugada entiende «este sitio no es para ti».
//
// La regla de redacción de este archivo: sin letra pequeña, sin jerga jurídica,
// y sin desalentar. Se nombra lo que Darma SÍ es —acompañamiento entre iguales—
// antes de nombrar lo que no es, y se termina abriendo una puerta, no cerrando
// una. Nadie debe sentirse rechazado por un aviso legal.
// ============================================================================

/**
 * Edad mínima para tener cuenta en Darma.
 *
 * 16 y no 14 (el mínimo español del art. 8 RGPD) por razones de producto y de
 * riesgo, no por cumplimiento: ver `/legal/menores`, donde la decisión está
 * razonada entera. Ponerla por encima del mínimo de la mayoría de
 * jurisdicciones evita además tener que recoger consentimiento parental para
 * los servicios de la sociedad de la información — y recoger el consentimiento
 * de un progenitor obligaría a vincular al menor con un adulto identificable,
 * que es justo lo que rompería el anonimato que le protege.
 */
export const EDAD_MINIMA = 16 as const

/**
 * Edad por debajo de la cual se aplican controles compensatorios adicionales
 * (sin mensajería privada con desconocidos, sin compras, umbral de moderación
 * más bajo). Ver `/legal/menores`.
 */
export const EDAD_ADULTA = 18 as const

/**
 * ¿La fecha de nacimiento declarada llega a la edad mínima?
 *
 * ⚠️ FUNCIÓN PURA Y SIN EFECTOS, Y ESO ES EL DISEÑO. Recibe la fecha, devuelve
 * un booleano y NO GUARDA NADA. La fecha de nacimiento no se almacena en
 * ninguna parte: si se rechaza el alta, esa fecha no deja rastro; si se acepta,
 * lo único que se escribe es el consentimiento `edad_minima` con su versión.
 * Guardar la fecha exacta sería añadir un identificador más en una aplicación
 * cuyo contrato prohíbe justamente eso — y con la fecha de nacimiento y dos
 * datos más se reidentifica a cualquiera.
 *
 * El onboarding de B01 debe llamar a esto y descartar la fecha en el acto (ver
 * HANDOFF/PEDIDOS.md).
 *
 * @param fechaNacimiento 'YYYY-MM-DD' declarada por la persona.
 * @param hoy             inyectable para poder probar el borde del cumpleaños.
 */
export function cumpleEdadMinima(fechaNacimiento: string, hoy = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaNacimiento)) return false

  const [anio, mes, dia] = fechaNacimiento.split('-').map(Number)
  const nacimiento = new Date(Date.UTC(anio, mes - 1, dia))

  // Fecha imposible (31 de febrero) o futura: no se acepta. `getUTCDate()`
  // detecta el desbordamiento que hace el constructor con días inexistentes.
  if (nacimiento.getUTCDate() !== dia || nacimiento.getUTCMonth() !== mes - 1) return false
  if (nacimiento.getTime() > hoy.getTime()) return false

  // Cumple los 16 el día de su decimosexto cumpleaños, no el siguiente.
  const limite = new Date(
    Date.UTC(hoy.getUTCFullYear() - EDAD_MINIMA, hoy.getUTCMonth(), hoy.getUTCDate()),
  )
  return nacimiento.getTime() <= limite.getTime()
}

/** Pie permanente. Una frase. Va en el layout de `app/(app)` (petición a B16/F4). */
export const AVISO_NO_TERAPIA =
  'Darma es acompañamiento entre personas, no atención sanitaria: si lo estás pasando mal, ' +
  'hablar aquí ayuda y pedir ayuda profesional también.'

/** La página `/legal/no-es-terapia`. Texto plano; NUNCA se renderiza como HTML. */
export const AVISO_NO_TERAPIA_LARGO = `Darma es una red de apoyo entre iguales. Quien te lee al otro lado es una persona
que ha pasado por algo parecido y ha decidido dedicarte un rato. Eso tiene un
valor real y está demostrado que ayuda: sentirse escuchado sin ser juzgado
cambia cómo se atraviesa un mal momento.

Lo que no somos es un servicio sanitario.

En Darma no hay profesionales de la salud mental atendiendo tu caso. Nadie que
te responda está haciendo un diagnóstico, ni indicando un tratamiento, ni
siguiendo tu evolución. Tampoco somos un servicio de emergencias: no hay nadie
de guardia veinticuatro horas esperando tu mensaje, y un mensaje aquí no es una
llamada al 112.

Las dos cosas no compiten. Puedes estar en terapia y usar Darma; muchísima
gente lo hace, porque una sesión a la semana deja seis días en medio. Y si
todavía no has dado el paso de pedir ayuda profesional, que estés aquí no es un
sustituto de darlo: es, con suerte, el sitio donde alguien te acompaña mientras
te decides.

Cuándo conviene buscar ayuda profesional además de escribir aquí:

· Cuando lo que sientes lleva semanas sin moverse.
· Cuando has dejado de hacer cosas que antes sostenías: comer, dormir,
  trabajar, ver a gente.
· Cuando aparece la idea de hacerte daño, aunque sea de pasada.
· Cuando alguien de tu alrededor te lo ha dicho y tú lo has quitado importancia.

Si ahora mismo estás en peligro, no escribas un post: llama al 112 (emergencias
en la Unión Europea) o al 024 (línea de atención a la conducta suicida en
España, gratuita y las veinticuatro horas). En Darma tienes el botón de ayuda
siempre visible, en cualquier pantalla, y detrás hay teléfonos reales del país
desde el que entras.

Nada de esto es letra pequeña para cubrirnos. Es lo que nos gustaría que
alguien nos hubiera dicho claro.`
