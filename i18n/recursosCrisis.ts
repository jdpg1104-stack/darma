// ============================================================================
// B17 · RECURSOS DE AYUDA EN CRISIS, INDEXADOS POR PAÍS
//
// ⚠️⚠️ TODO: VERIFICACIÓN CLÍNICA / LEGAL PENDIENTE ⚠️⚠️
//
// NINGÚN número de este archivo ha sido confirmado por un humano contra su
// fuente oficial. Los datos vienen de `lib/crisis.ts` (que a su vez los tiene
// escritos de memoria) y de conocimiento general, no de una comprobación. Cada
// entrada lo declara explícitamente con `verificadoPor: null`.
//
// ANTES DE PRODUCCIÓN, alguien con nombre y apellidos tiene que:
//   1. Abrir la `fuente` de cada recurso.
//   2. Comprobar número, horario, gratuidad e idiomas de atención.
//   3. Poner su nombre en `verificadoPor` y la fecha de HOY en `verificadoEn`.
// La lista de lo que falta la da `recursosPendientesDeVerificacion()`, y
// `i18n/recursosCrisis.test.ts` falla si alguien añade un recurso sin declararlo
// en `PENDIENTES_DECLARADOS` (para que nadie cuele un número nuevo en silencio)
// y si algún `verificadoEn` supera los 180 días.
//
// Un número equivocado en una pantalla de crisis es PEOR que no mostrar número.
//
// ── LA REGLA DURA DEL BLOQUE ───────────────────────────────────────────────
// Esto se indexa por PAÍS (ISO-3166-1 alfa-2), NUNCA por idioma. Un
// hispanohablante en Estados Unidos necesita el 988, no el 024. Por eso
// `recursosParaPais()` rechaza un `Locale` incluso en tiempo de tipos: el error
// no se puede escribir. Si alguien pide un `recursosParaLocale()`, la respuesta
// es no.
//
// ── CONTRATO PARA LOS DEMÁS BLOQUES ────────────────────────────────────────
//   · Para pintar la tarjeta se llama SIEMPRE
//     `recursosParaPais(await resolverPais())`. El país nunca se deriva del
//     locale.
//   · `nombre` y `valor` NO se traducen: son los datos oficiales del país.
//     Solo se traduce `descripcionKey`.
//   · Ningún bloque escribe un número de teléfono en su propio código.
//   · Un número de emergencias no se "localiza" con formato: `024`, `988`,
//     `112`, `*4141` se pintan literales, y además de `tel:` se muestra el texto
//     copiable (en escritorio `tel:` no hace nada).
// ============================================================================

import type { Locale } from './routing.ts'
import type { CodigoPais } from './pais.ts'

export type TipoRecurso = 'telefono' | 'sms' | 'chat' | 'emergencias' | 'web'

export interface RecursoCrisis {
  tipo: TipoRecurso
  /** Nombre de la organización tal y como se anuncia. No se traduce. */
  nombre: string
  /** Número marcable o URL https. Sin espacios ni guiones si es teléfono. */
  valor: string
  /** Clave de `messages/*.json` con la descripción. Lo ÚNICO traducible. */
  descripcionKey: string
  /** Idiomas en los que ATIENDE la línea. Independiente del idioma de la UI. */
  idiomasAtencion: readonly string[]
  horario: '24/7' | string
  gratuito: boolean
  /**
   * Fecha ISO de la última REVISIÓN de esta entrada.
   *
   * ⚠️ No implica verificación humana: eso lo dice `verificadoPor`. Aquí sirve
   * para que el guard de caducidad (180 días) tenga contra qué comparar.
   */
  verificadoEn: string
  /**
   * Quién confirmó el dato contra `fuente`. `null` = NADIE todavía.
   *
   * Este campo es la extensión que B17 añade al contrato de la ficha: sin él,
   * `verificadoEn` mentiría (una fecha reciente parece una verificación
   * reciente). Anotado en HANDOFF/PEDIDOS.md para que B00 lo recoja.
   */
  verificadoPor: string | null
  /**
   * SOLO para `tipo: 'sms'`. La palabra con la que hay que EMPEZAR el mensaje.
   *
   * ── POR QUÉ ESTE CAMPO EXISTE ────────────────────────────────────────────
   * Las líneas de texto no contestan a un mensaje en blanco: esperan una
   * palabra concreta que enruta la conversación. La app enseñaba el número y
   * el enlace `sms:` abre el compositor VACÍO, así que quien lo usara mandaría
   * un mensaje que no recibe respuesta. En una pantalla de crisis eso no es un
   * detalle de producto: es alguien que pide ayuda y no obtiene nada, y que
   * probablemente no lo intenta dos veces.
   *
   * `null` = NO CONSTA. Igual que `verificadoPor`, y por el mismo motivo: no se
   * inventa. Mientras sea `null`, `/ayuda` no promete una palabra concreta —
   * dice que hay que mirarla en la fuente y enlaza allí. Es peor que tenerla,
   * y mucho mejor que enseñar una equivocada.
   */
  palabraClave?: string | null
  /** URL oficial contra la que se verifica. */
  fuente: string
}

export interface RecursosPais {
  pais: CodigoPais | 'INTERNACIONAL'
  /** Ordenados por prioridad de presentación. El primero es el que más se ve. */
  recursos: readonly RecursoCrisis[]
}

/** Ventana de frescura. Pasada, el dato se considera caducado. */
export const VENTANA_VERIFICACION_DIAS = 180

/**
 * Clave del mensaje que acompaña SIEMPRE al bloque internacional: «llama al
 * número de emergencias de tu país». No es un recurso porque no tiene número:
 * es la instrucción que sustituye al número que no podemos saber.
 */
export const CLAVE_EMERGENCIAS_LOCALES = 'crisis.recursos.emergenciasLocales'

/** Fecha en la que se escribió esta tabla. NO es una fecha de verificación. */
const ESCRITO_EN = '2026-08-03'

function r(recurso: RecursoCrisis): RecursoCrisis {
  return Object.freeze(recurso)
}

// ── La tabla ────────────────────────────────────────────────────────────────
// Regla: cada país lleva SIEMPRE su número de emergencias general además de la
// línea especializada. Si la línea está saturada —y en crisis lo están—, tiene
// que haber una alternativa en la misma tarjeta.

const ENTRADAS: readonly RecursosPais[] = [
  {
    pais: 'ES',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: 'Línea de Atención a la Conducta Suicida',
        valor: '024',
        descripcionKey: 'crisis.recursos.lineaSuicidio',
        idiomasAtencion: ['es', 'ca', 'eu', 'gl', 'en'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.sanidad.gob.es/linea024/home.htm',
      }),
      r({
        tipo: 'telefono',
        nombre: 'Teléfono de la Esperanza',
        valor: '717003717',
        descripcionKey: 'crisis.recursos.escuchaEmocional',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: false,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://telefonodelaesperanza.org',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'Emergencias',
        valor: '112',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['es', 'en', 'fr', 'de'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.112.es',
      }),
    ],
  },
  {
    pais: 'MX',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: 'Línea de la Vida',
        valor: '8009112000',
        descripcionKey: 'crisis.recursos.saludMental',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.gob.mx/salud/conadic',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'Emergencias',
        valor: '911',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.gob.mx/911',
      }),
    ],
  },
  {
    pais: 'AR',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: 'Centro de Asistencia al Suicida (CAS)',
        valor: '135',
        descripcionKey: 'crisis.recursos.lineaSuicidio',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.asistenciaalsuicida.org.ar',
      }),
      r({
        tipo: 'telefono',
        nombre: 'Línea de Salud Mental Responde',
        valor: '08009990091',
        descripcionKey: 'crisis.recursos.saludMental',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.argentina.gob.ar/salud/mental',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'Emergencias',
        valor: '911',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.argentina.gob.ar/emergencias',
      }),
    ],
  },
  {
    pais: 'CO',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: 'Línea 106 «El poder de ser escuchado»',
        valor: '106',
        descripcionKey: 'crisis.recursos.saludMental',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.saludcapital.gov.co',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'Emergencias',
        valor: '123',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.policia.gov.co',
      }),
    ],
  },
  {
    pais: 'CL',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: 'Línea de prevención del suicidio *4141',
        valor: '*4141',
        descripcionKey: 'crisis.recursos.lineaSuicidio',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.gob.cl/hablemosdetodo/',
      }),
      r({
        tipo: 'telefono',
        nombre: 'Salud Responde',
        valor: '6003607777',
        descripcionKey: 'crisis.recursos.saludMental',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: false,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.minsal.cl',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'SAMU · Emergencias',
        valor: '131',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.minsal.cl',
      }),
    ],
  },
  {
    pais: 'PE',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: 'Línea 113 · opción 5 (salud mental)',
        valor: '113',
        descripcionKey: 'crisis.recursos.saludMental',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.gob.pe/minsa',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'SAMU · Emergencias',
        valor: '106',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.gob.pe/institucion/minsa/campa%C3%B1as/samu',
      }),
    ],
  },
  {
    pais: 'US',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: '988 Suicide & Crisis Lifeline',
        valor: '988',
        descripcionKey: 'crisis.recursos.lineaSuicidio',
        // Atiende también en español. Que la línea hable español NO significa
        // que a un hispanohablante en España haya que darle este número: son
        // dos cosas distintas y confundirlas es el bug que este módulo evita.
        idiomasAtencion: ['en', 'es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://988lifeline.org',
      }),
      r({
        tipo: 'sms',
        nombre: 'Crisis Text Line',
        valor: '741741',
        // NO CONSTA: hay que confirmarla con la organización. Ver el campo en la
        // interfaz. Mientras sea null, /ayuda manda a la fuente en vez de
        // prometer una palabra que podría estar mal.
        palabraClave: null,
        descripcionKey: 'crisis.recursos.sms',
        idiomasAtencion: ['en', 'es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.crisistextline.org',
      }),
      r({
        tipo: 'chat',
        nombre: '988 Lifeline Chat',
        valor: 'https://988lifeline.org/chat/',
        descripcionKey: 'crisis.recursos.chat',
        idiomasAtencion: ['en', 'es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://988lifeline.org/chat/',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'Emergencies',
        valor: '911',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['en', 'es'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.911.gov',
      }),
    ],
  },
  {
    pais: 'GB',
    recursos: [
      r({
        tipo: 'telefono',
        nombre: 'Samaritans',
        valor: '116123',
        descripcionKey: 'crisis.recursos.escuchaEmocional',
        idiomasAtencion: ['en'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.samaritans.org',
      }),
      r({
        tipo: 'sms',
        nombre: 'Shout',
        valor: '85258',
        // NO CONSTA. Ver la nota de Crisis Text Line.
        palabraClave: null,
        descripcionKey: 'crisis.recursos.sms',
        idiomasAtencion: ['en'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://giveusashout.org',
      }),
      r({
        tipo: 'emergencias',
        nombre: 'Emergency services',
        valor: '999',
        descripcionKey: 'crisis.recursos.emergencias',
        idiomasAtencion: ['en'],
        horario: '24/7',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://www.gov.uk/call-999',
      }),
    ],
  },
  {
    // Red de seguridad. Un directorio, NUNCA el teléfono de otro país: llamar
    // al 024 desde Manila no ayuda a nadie. La instrucción de emergencias local
    // la aporta CLAVE_EMERGENCIAS_LOCALES, que la tarjeta pinta siempre aquí.
    pais: 'INTERNACIONAL',
    recursos: [
      r({
        tipo: 'web',
        nombre: 'Find A Helpline',
        valor: 'https://findahelpline.com',
        descripcionKey: 'crisis.recursos.directorioInternacional',
        idiomasAtencion: ['en', 'es'],
        horario: 'Según el país',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://findahelpline.com',
      }),
      r({
        tipo: 'web',
        nombre: 'Befrienders Worldwide',
        valor: 'https://befrienders.org',
        descripcionKey: 'crisis.recursos.directorioInternacional',
        idiomasAtencion: ['en'],
        horario: 'Según el país',
        gratuito: true,
        verificadoEn: ESCRITO_EN,
        verificadoPor: null,
        fuente: 'https://befrienders.org',
      }),
    ],
  },
]

/**
 * Mapa congelado y SIN PROTOTIPO.
 *
 * Sin prototipo porque un `RECURSOS_POR_PAIS['constructor']` sobre un objeto
 * normal devuelve una función, y eso acabaría en un `.recursos` indefinido
 * dentro de una tarjeta de crisis. Congelado porque nadie debe poder mutar en
 * caliente el número al que llama una persona en riesgo.
 *
 * Búsqueda O(1), en el bundle del servidor, sin red y sin `await`:
 * CONTRATOS §9 — la crisis gana siempre y no espera a nadie.
 */
export const RECURSOS_POR_PAIS: Readonly<Record<string, RecursosPais>> = (() => {
  const mapa = Object.create(null) as Record<string, RecursosPais>
  for (const entrada of ENTRADAS) {
    mapa[entrada.pais] = Object.freeze({
      pais: entrada.pais,
      recursos: Object.freeze(entrada.recursos),
    })
  }
  return Object.freeze(mapa)
})()

/** Países del lanzamiento, sin el fallback. Lo usa el guard de cobertura. */
export const PAISES_SOPORTADOS: readonly string[] = Object.freeze(
  Object.keys(RECURSOS_POR_PAIS).filter((k) => k !== 'INTERNACIONAL'),
)

/**
 * Rechaza un `Locale` en tiempo de tipos.
 *
 * `recursosParaPais('es')` NO COMPILA, y ese es justo el punto: el error que
 * este bloque existe para prevenir no se puede ni escribir. Un `string` normal
 * (el resultado de `resolverPais()`) sigue pasando sin fricción.
 */
export type NoUnLocale<T> = T extends Locale ? never : T

/**
 * EL punto de entrada para el resto de la app.
 *
 * `null`, país desconocido, minúsculas o basura → `INTERNACIONAL`.
 * NUNCA devuelve un array vacío y NUNCA cae al país del idioma: una tarjeta de
 * crisis vacía es un callejón sin salida, y el número de otro país es peor.
 */
export function recursosParaPais<T extends CodigoPais | null>(
  pais: T & NoUnLocale<T>,
): RecursosPais {
  if (typeof pais !== 'string') return RECURSOS_POR_PAIS.INTERNACIONAL

  // OJO: NO se normaliza a mayúsculas a propósito. 'es' en minúsculas es el
  // LOCALE español, y quien lo pasa aquí se está equivocando de eje; devolverle
  // los recursos de España confirmaría el error justo en la pantalla donde más
  // caro sale. Un código de país legítimo llega ya en mayúsculas porque pasa por
  // `normalizarPais()` (i18n/pais.ts), que es la única puerta de entrada.
  const clave = pais.trim()
  // `Object.hasOwn` y no `mapa[clave]`: la clave viene, en última instancia, de
  // una cookie que escribe el cliente.
  if (!Object.hasOwn(RECURSOS_POR_PAIS, clave)) return RECURSOS_POR_PAIS.INTERNACIONAL

  const encontrado = RECURSOS_POR_PAIS[clave]
  // Cinturón y tirantes: si alguna vez alguien mete una entrada vacía en la
  // tabla, se cae al internacional en vez de pintar una tarjeta sin recursos.
  if (encontrado.recursos.length === 0) return RECURSOS_POR_PAIS.INTERNACIONAL
  return encontrado
}

// ── Mecanismo de verificación humana ────────────────────────────────────────

export interface EntradaDeVerificacion {
  readonly pais: string
  readonly nombre: string
  readonly valor: string
  readonly fuente: string
  readonly verificadoEn: string
  readonly verificadoPor: string | null
}

/** Todos los recursos, aplanados con su país. Para guards e informes. */
export function todosLosRecursos(): readonly EntradaDeVerificacion[] {
  const salida: EntradaDeVerificacion[] = []
  for (const clave of Object.keys(RECURSOS_POR_PAIS)) {
    for (const recurso of RECURSOS_POR_PAIS[clave].recursos) {
      salida.push({
        pais: clave,
        nombre: recurso.nombre,
        valor: recurso.valor,
        fuente: recurso.fuente,
        verificadoEn: recurso.verificadoEn,
        verificadoPor: recurso.verificadoPor,
      })
    }
  }
  return salida
}

/**
 * Lo que NADIE ha confirmado todavía contra su fuente oficial.
 *
 * Para registrar una verificación: pon tu nombre en `verificadoPor` y la fecha
 * de hoy en `verificadoEn` del recurso, y quita su identificador de
 * `PENDIENTES_DECLARADOS`. La prueba compara las dos listas, así que ni se puede
 * añadir un número nuevo en silencio ni marcar uno como verificado sin tocar el
 * inventario.
 */
export function recursosPendientesDeVerificacion(): readonly EntradaDeVerificacion[] {
  return todosLosRecursos().filter((e) => e.verificadoPor === null)
}

/** Identificador estable de un recurso dentro del inventario: `PAIS·nombre`. */
export function idDeRecurso(entrada: EntradaDeVerificacion): string {
  return `${entrada.pais}·${entrada.nombre}`
}

/**
 * Inventario EXPLÍCITO de lo que está pendiente de verificación humana.
 *
 * Es una lista escrita a mano a propósito: obliga a que añadir un teléfono sea
 * un acto consciente en dos sitios. Hoy están todos, porque hoy no se ha
 * verificado ninguno.
 */
export const PENDIENTES_DECLARADOS: readonly string[] = Object.freeze([
  'ES·Línea de Atención a la Conducta Suicida',
  'ES·Teléfono de la Esperanza',
  'ES·Emergencias',
  'MX·Línea de la Vida',
  'MX·Emergencias',
  'AR·Centro de Asistencia al Suicida (CAS)',
  'AR·Línea de Salud Mental Responde',
  'AR·Emergencias',
  'CO·Línea 106 «El poder de ser escuchado»',
  'CO·Emergencias',
  'CL·Línea de prevención del suicidio *4141',
  'CL·Salud Responde',
  'CL·SAMU · Emergencias',
  'PE·Línea 113 · opción 5 (salud mental)',
  'PE·SAMU · Emergencias',
  'US·988 Suicide & Crisis Lifeline',
  'US·Crisis Text Line',
  'US·988 Lifeline Chat',
  'US·Emergencies',
  'GB·Samaritans',
  'GB·Shout',
  'GB·Emergency services',
  'INTERNACIONAL·Find A Helpline',
  'INTERNACIONAL·Befrienders Worldwide',
])

/**
 * ¿Se puede desplegar a producción con esta tabla?
 *
 * `false` mientras quede un recurso sin verificar. B15 puede colgar de aquí un
 * paso de CI que bloquee el despliegue a producción (ver PEDIDOS.md); en
 * desarrollo y en preview la tabla se usa igual, porque un número probablemente
 * correcto sigue siendo mejor que una pantalla de crisis en blanco.
 */
export function tablaListaParaProduccion(): boolean {
  return recursosPendientesDeVerificacion().length === 0
}

/** Días transcurridos desde una fecha ISO. `Infinity` si la fecha no es válida. */
export function diasDesde(fechaIso: string, hoy: Date = new Date()): number {
  const t = Date.parse(fechaIso)
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY
  return Math.floor((hoy.getTime() - t) / 86_400_000)
}

/** Recursos cuya última revisión supera la ventana de frescura. */
export function recursosCaducados(
  hoy: Date = new Date(),
  ventanaDias: number = VENTANA_VERIFICACION_DIAS,
): readonly EntradaDeVerificacion[] {
  return todosLosRecursos().filter((e) => diasDesde(e.verificadoEn, hoy) > ventanaDias)
}
