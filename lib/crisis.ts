// ============================================================================
// Detección de crisis — TRIAJE por reglas (español + inglés)
//
// ⚠️ LEE ESTO ENTERO ANTES DE TOCAR NADA AQUÍ ⚠️
//
// ── QUÉ ES ─────────────────────────────────────────────────────────────────
// Un TRIAJE. Marca textos que PODRÍAN contener señales de ideación suicida o
// autolesión para que (a) se le muestren recursos de ayuda a la persona y (b)
// el contenido entre en la cola de revisión humana (idx_posts_risk).
//
// ── QUÉ NO ES ──────────────────────────────────────────────────────────────
// NO es un diagnóstico. NO es una evaluación de riesgo clínica. NO sustituye a
// un profesional, y Darma tampoco: Darma es apoyo entre pares, y eso es otra
// cosa. Ninguna decisión irreversible sobre una persona puede tomarse a partir
// del resultado de esta función.
//
// ── LA REGLA DE ORO: SOLO ESCALA, NUNCA DESCARTA ───────────────────────────
// El nivel de riesgo que devuelve esta función es un SUELO, no un veredicto.
// Puede subirlo el clasificador de IA, un reporte de otra persona, o un
// moderador. Lo que NADIE puede hacer es bajarlo automáticamente. Está
// codificado en `escalate()`: la única operación permitida sobre un risk_level
// es el máximo. Si algún día ves código que asigna un riesgo menor al que ya
// tenía una fila sin intervención humana explícita, es un bug grave.
//
// ── ASIMETRÍA DE ERRORES (el porqué de todos los umbrales) ─────────────────
// Un FALSO POSITIVO le enseña recursos de ayuda a alguien que no los necesitaba
// hoy. Es una molestia. Un FALSO NEGATIVO es una persona que pidió ayuda de la
// única forma que pudo y a la que no se la dimos. No son comparables, así que
// los umbrales están calibrados hacia el lado ruidoso A PROPÓSITO. Cualquier
// cambio que reduzca los falsos positivos a costa de aumentar los falsos
// negativos va en la dirección contraria a esta app, por buena que sea la
// métrica agregada que lo justifique.
//
// ── POR QUÉ REGLAS Y NO SOLO UN MODELO ─────────────────────────────────────
// Porque las reglas siempre están disponibles: no tienen cuota, ni latencia, ni
// una caída del proveedor, ni un cambio de versión que altere el comportamiento
// sin avisar. El modelo va ENCIMA y solo puede escalar. El día que el
// clasificador esté caído, el suelo sigue puesto.
// ============================================================================

import { esLocale } from '../i18n/routing.ts'
import type { CodigoPais } from '../i18n/pais.ts'
import {
  recursosParaPais,
  RECURSOS_POR_PAIS,
  type RecursoCrisis,
  type TipoRecurso,
} from '../i18n/recursosCrisis.ts'

// Reexportado para que quien ya importa recursos desde `lib/crisis` pueda pasar
// al dato bueno sin cambiar de puerta. La tabla sigue siendo de `i18n/`.
export {
  recursosParaPais,
  RECURSOS_POR_PAIS,
  PAISES_SOPORTADOS,
  CLAVE_EMERGENCIAS_LOCALES,
  tablaListaParaProduccion,
  recursosPendientesDeVerificacion,
} from '../i18n/recursosCrisis.ts'
export type { RecursoCrisis, RecursosPais, TipoRecurso } from '../i18n/recursosCrisis.ts'

/** Espejo del enum public.risk_level. Ordenado de menor a mayor gravedad. */
export type RiskLevel = 'none' | 'low' | 'high' | 'critical'

const RISK_ORDER: Readonly<Record<RiskLevel, number>> = {
  none: 0,
  low: 1,
  high: 2,
  critical: 3,
} as const

/**
 * ÚNICA operación permitida sobre un nivel de riesgo: el máximo.
 *
 * No existe —ni debe escribirse— una función que baje el riesgo. Bajar un
 * riesgo es una decisión humana que se registra en moderación, no un cálculo.
 */
export function escalate(current: RiskLevel, incoming: RiskLevel): RiskLevel {
  return RISK_ORDER[incoming] > RISK_ORDER[current] ? incoming : current
}

/** ¿Este nivel exige intervención (mostrar recursos + cola humana)? */
export function requiresIntervention(level: RiskLevel): boolean {
  return RISK_ORDER[level] >= RISK_ORDER.high
}

// ── Patrones ────────────────────────────────────────────────────────────────
// Se escriben sobre el texto NORMALIZADO (minúsculas, sin tildes) para que
// "quiero morirme" y "QUIERO MORÍRME!!!" den lo mismo. Cada patrón lleva su
// nivel; el resultado es el máximo de los que casan, nunca la suma: dos señales
// bajas no equivalen a una alta, y sumar produciría escaladas absurdas en
// textos largos que hablan del tema en tercera persona.

interface CrisisPattern {
  readonly id: string
  readonly level: RiskLevel
  readonly re: RegExp
}

/**
 * CRÍTICO — plan, medio, inminencia o despedida. Exige intervención inmediata:
 * recursos en pantalla ANTES de publicar y revisión humana prioritaria.
 */
const CRITICAL_PATTERNS: readonly CrisisPattern[] = [
  { id: 'es_plan_tonight', level: 'critical', re: /\b(esta noche|hoy|manana|en cuanto|cuando llegue a casa)\b[^.]{0,40}\b(acabar|terminar|quitarme|matarme|suicidarme|hacerlo)\b/ },
  { id: 'es_goodbye', level: 'critical', re: /\b(me despido|es mi (ultima|ultimo)|(esta|este) es mi (ultimo|ultima)|no me vereis mas|gracias por todo,? adios|cuando ya no este)\b/ },
  { id: 'es_method', level: 'critical', re: /\b(tengo|he comprado|he conseguido|he guardado|junte|reuni)\b[^.]{0,30}\b(pastillas|pistola|cuerda|soga|cuchilla|cuchillo|veneno|lejia|navaja)\b/ },
  { id: 'es_written_note', level: 'critical', re: /\b(ya (he |ha )?(escrito|escrita|deje|dejado)|deje escrita|tengo escrita)\b[^.]{0,25}\b(carta|nota)\b/ },
  { id: 'es_decided', level: 'critical', re: /\b(ya (lo )?(he )?decidido|esta decidido|ya tome la decision)\b[^.]{0,40}\b(morir|acabar|irme|no seguir|no despertar)\b/ },
  { id: 'en_plan_tonight', level: 'critical', re: /\b(tonight|today|tomorrow)\b[^.]{0,40}\b(end it|kill myself|do it|not be here)\b/ },
  { id: 'en_goodbye', level: 'critical', re: /\b(this is goodbye|final goodbye|you won'?t see me again|last message from me)\b/ },
  { id: 'en_method', level: 'critical', re: /\b(i (have|bought|got|saved up))\b[^.]{0,30}\b(pills|gun|rope|blade|poison|bleach)\b/ },
]

/**
 * ALTO — ideación explícita o autolesión, sin plan declarado. Recursos en
 * pantalla y cola de revisión.
 */
const HIGH_PATTERNS: readonly CrisisPattern[] = [
  // `suicidarme` / `matarme` en primera persona valen por sí solos: exigir
  // además un verbo concreto ("quiero", "pienso") producía falsos negativos con
  // construcciones perfectamente normales ("llevo semanas pensando en
  // suicidarme"), y un falso negativo aquí es inaceptable.
  { id: 'es_ideation', level: 'high', re: /\b(quiero (morir|morirme|desaparecer para siempre)|me quiero morir|deseo (morir|morirme)|suicidarme|matarme|ideas suicidas|ideacion suicida|pensamientos suicidas)\b/ },
  // FORMULACIÓN IMPERSONAL. La regla de arriba solo ve la primera persona
  // (`suicidarme`, `matarme`), y quien está peor rara vez habla en primera
  // persona: pregunta por «alguien», por «una persona», o en infinitivo
  // —«¿alguien más ha pensado en suicidarse?»—. Es una forma reconocida de
  // tantear el terreno antes de hablar de uno mismo, y con la regla anterior
  // pasaba entera sin marcar.
  //
  // Sí, marca también a quien pregunta por un tercero de verdad («mi hermano
  // ha hablado de suicidarse»). Es el resultado correcto: esa persona también
  // necesita los recursos en pantalla, y quien acompaña a alguien en riesgo
  // está atravesando su propia crisis. Falso positivo aceptable; falso
  // negativo, no.
  { id: 'es_ideation_impersonal', level: 'high', re: /\b(suicidarse|suicidio|matarse|quitarse la vida|acabar con su vida|autolesionarse|hacerse dano a proposito)\b/ },
  { id: 'en_ideation_impersonal', level: 'high', re: /\b(suicide|killing themsel(f|ves)|kill themsel(f|ves)|taking their (own )?life|self.?harming)\b/ },
  { id: 'es_end_life', level: 'high', re: /\b(acabar con (mi vida|todo esto)|terminar con (mi vida|todo)|quitarme la vida|no quiero (seguir viviendo|vivir mas|estar aqui)|dejar de existir)\b/ },
  { id: 'es_selfharm', level: 'high', re: /\b(me (corto|he cortado|autolesiono|hago dano|hago cortes)|cortarme|autolesion(arme|es)?|quemarme a proposito)\b/ },
  { id: 'es_better_dead', level: 'high', re: /\b(estarian mejor sin mi|todos estarian mejor|no le importo a nadie y ya no|sobro en este mundo|no merezco (vivir|estar aqui))\b/ },
  { id: 'es_no_wake', level: 'high', re: /\b(ojala no (despertar|despertara|me despierte)|no quiero despertar(me)? manana|que no llegue el manana)\b/ },
  { id: 'en_ideation', level: 'high', re: /\b(want to die|kill(ing)? myself|suicidal|end(ing)? my life|take my (own )?life|don'?t want to (live|be alive|be here))\b/ },
  { id: 'en_selfharm', level: 'high', re: /\b(self.?harm|cutting myself|i cut myself|hurting myself on purpose)\b/ },
  { id: 'en_better_off', level: 'high', re: /\b(better off without me|no one would miss me|world would be better without me)\b/ },
]

/**
 * BAJO — desesperanza intensa, dolor emocional agudo, aislamiento. NO implica
 * ideación. Se marca porque es el terreno del que sale, y porque a alguien así
 * conviene mostrarle recursos aunque no los haya pedido.
 *
 * Este nivel es el que más falsos positivos produce, y está bien: 'low' NO
 * bloquea nada, no manda a revisión humana y no le cambia la experiencia a
 * nadie salvo por un enlace de ayuda al pie.
 */
const LOW_PATTERNS: readonly CrisisPattern[] = [
  { id: 'es_hopeless', level: 'low', re: /\b(no puedo mas|estoy al limite|no aguanto mas|no le veo (sentido|salida)|todo me da igual|no hay salida|estoy vacio|estoy vacia|me estoy hundiendo|toco fondo|he tocado fondo)\b/ },
  { id: 'es_burden', level: 'low', re: /\b(soy una carga|solo doy problemas|estorbo a todos|nadie me echaria de menos)\b/ },
  { id: 'es_alone', level: 'low', re: /\b(estoy (completamente )?solo|estoy (completamente )?sola|no tengo a nadie|nadie me escucha|nadie lo entiende)\b/ },
  { id: 'es_pain', level: 'low', re: /\b(dolor insoportable|no soporto (mas )?este dolor|solo quiero que pare|que se acabe este dolor)\b/ },
  { id: 'en_hopeless', level: 'low', re: /\b(can'?t (take|do) (it|this) anymore|there'?s no way out|nothing matters|i feel empty|hit rock bottom)\b/ },
  { id: 'en_burden', level: 'low', re: /\b(i'?m a burden|nobody would miss me)\b/ },
  { id: 'en_alone', level: 'low', re: /\b(i have no one|nobody listens|completely alone)\b/ },
]

const ALL_PATTERNS: readonly CrisisPattern[] = [
  ...CRITICAL_PATTERNS,
  ...HIGH_PATTERNS,
  ...LOW_PATTERNS,
]

/**
 * Normalización para el matcher: minúsculas, sin tildes, puntuación a espacio.
 *
 * Se conserva el punto como separador de frase (los patrones críticos usan
 * `[^.]{0,40}` para exigir que las dos partes estén en la MISMA frase: sin eso,
 * "hoy he ido al médico. Un amigo tuvo que quitarme el coche" dispararía
 * 'es_plan_tonight').
 */
function normalizeForCrisis(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Negación / tercera persona ──────────────────────────────────────────────
// Un post que dice "mi hermana quiere morirse y no sé cómo ayudarla" es una
// petición de ayuda PARA OTRA PERSONA. Sigue mereciendo recursos (por eso no lo
// descartamos), pero no es la misma urgencia que la primera persona.
//
// ⚠️ ESTE ES EL ÚNICO SITIO DEL MÓDULO QUE PODRÍA BAJAR UN NIVEL, Y NO LO HACE:
// solo evita SUBIR de 'high' a 'critical' cuando toda la señal está en tercera
// persona. Se resistió la tentación de bajar a 'low' porque quien pregunta por
// un tercero a menudo está hablando de sí mismo, y ese es exactamente el falso
// negativo que no nos podemos permitir.
const THIRD_PERSON = /\b(mi (hermana|hermano|madre|padre|amiga|amigo|hija|hijo|pareja|prima|primo|companera|companero)|un amigo|una amiga|my (sister|brother|mom|mother|dad|father|friend|daughter|son|partner))\b/

/**
 * Marca FUERTE de primera persona.
 *
 * Deliberadamente NO incluye "me" ni "mi" sueltos: aparecen en cualquier frase
 * que hable de un familiar ("mi hermana me dijo") y harían que la marca de
 * primera persona estuviera siempre activa, dejando la modulación muerta. Se
 * queda con verbos conjugados en primera persona y posesivos inequívocos.
 */
const FIRST_PERSON = /\b(yo|conmigo|estoy|quiero|siento|tengo|puedo|aguanto|mi vida|i|i'?m|myself|my life)\b/

export interface CrisisSignal {
  /** Id del patrón, estable para analítica y para depurar. */
  id: string
  level: RiskLevel
  /** Fragmento que casó, para la cola de moderación. NUNCA para la UI de la
   *  persona: subrayarle sus propias palabras de crisis es revictimizante. */
  match: string
}

export interface CrisisAssessment {
  risk_level: RiskLevel
  /** Todas las señales encontradas, ordenadas de más grave a menos. */
  signals: CrisisSignal[]
  /** ¿Hay que mostrar recursos y mandar a revisión? (riesgo >= high) */
  requiresIntervention: boolean
  /** ¿La señal parece referirse a un tercero? Solo modula critical→high. */
  thirdPartyContext: boolean
}

/**
 * Evalúa un texto. PURA y determinista: sin red, sin reloj.
 *
 * El resultado es el MÁXIMO de los niveles que casan (nunca la suma).
 */
export function assessCrisisRisk(text: string): CrisisAssessment {
  const normalized = normalizeForCrisis(text)
  const signals: CrisisSignal[] = []

  for (const p of ALL_PATTERNS) {
    const m = p.re.exec(normalized)
    if (m) signals.push({ id: p.id, level: p.level, match: m[0] })
  }

  let level: RiskLevel = 'none'
  for (const s of signals) level = escalate(level, s.level)

  // Modulación por tercera persona: solo critical → high, y solo si NO hay
  // ninguna marca de primera persona en el texto.
  const thirdPartyContext = THIRD_PERSON.test(normalized) && !FIRST_PERSON.test(normalized)
  if (thirdPartyContext && level === 'critical') level = 'high'

  signals.sort((a, b) => RISK_ORDER[b.level] - RISK_ORDER[a.level])

  return {
    risk_level: level,
    signals,
    requiresIntervention: requiresIntervention(level),
    thirdPartyContext,
  }
}

// ============================================================================
// Recursos de ayuda — LA TABLA NO VIVE AQUÍ
//
// La tabla de teléfonos es `i18n/recursosCrisis.ts` y es la ÚNICA. Aquí hubo una
// segunda, escrita de memoria: sin `fuente` contra la que verificar, sin idiomas
// de atención, con la fecha en que se escribió haciéndose pasar por fecha de
// verificación, y sin número de emergencias en PE, US ni GB. Dos tablas de
// teléfonos de crisis en un repositorio significa exactamente una cosa: el día
// que se corrija un número, se corregirá en una de las dos.
//
// Lo que queda en este archivo es la DETECCIÓN (`assessCrisisRisk`, `escalate`).
// Lo de abajo es un ADAPTADOR de forma —`RecursoCrisis` → `HelpResource`— para
// no romper a quien ya importa `helpResourcesFor()` desde aquí. Datos, cero.
//
// ⚠️ Si vas a añadir, corregir o verificar un número: `i18n/recursosCrisis.ts`.
// Ningún dato de contacto puede volver a escribirse en este archivo.
//
// ── EL PAÍS Y EL IDIOMA SON DOS EJES DISTINTOS ─────────────────────────────
// El JSDoc que había aquí decía que el país sale de
// `identity_vault.country_code` «o, en su defecto, del locale del navegador».
// Nadie llegó a implementarlo, pero la frase invitaba a hacerlo, y hacerlo es el
// fallo que `i18n/pais.ts` existe para impedir: con `Accept-Language: es-ES`,
// alguien en Estados Unidos recibiría el 024 —una línea española a la que no
// puede llamar— en vez del 988.
//
// El idioma decide en QUÉ SE LEE la pantalla. El país decide QUÉ NÚMERO se
// marca. Que una línea atienda en español (el 988 lo hace) no la convierte en la
// línea de un hispanohablante en Madrid: el teléfono es una infraestructura
// nacional, no un atributo del idioma. Por eso el país solo puede salir de
// `resolverPais()` (cookie explícita → cabecera del edge → `null`), y `null`
// significa DIRECTORIO INTERNACIONAL, nunca "el país que sugiere el idioma".
// ============================================================================

/**
 * Forma histórica de un recurso, la que consumen el composer, las rutas de API y
 * la tarjeta del refugio. Se mantiene por compatibilidad; el dato bueno —con su
 * `fuente`, su tipo y sus idiomas de atención— es `RecursoCrisis` de
 * `i18n/recursosCrisis.ts`, y quien pueda debería consumir aquel directamente.
 */
export interface HelpResource {
  name: string
  /** Teléfono en formato marcable. Solo en líneas y emergencias. */
  phone?: string
  /** URL, o `sms:` en las líneas de texto: un `tel:` a un número de SMS no llama a nadie. */
  url?: string
  /** Horario tal y como está en la tabla. Es DATO, no copy: ver `hoursKey`. */
  hours: string
  /**
   * Clave del catálogo con la que traducir `hours`, o `null` si el horario no
   * está en la lista cerrada y hay que pintarlo tal cual.
   */
  hoursKey: string | null
  /** Fecha (ISO) de la última REVISIÓN. No implica verificación: eso es `verifiedBy`. */
  verifiedAt: string
  /** Quién confirmó el dato contra `source`. `null` = NADIE todavía. */
  verifiedBy: string | null
  /** URL oficial contra la que se verifica el número. */
  source: string
  /** Idiomas en los que ATIENDE la línea. Nada que ver con el idioma de la UI. */
  languages: readonly string[]
  free: boolean
  type: TipoRecurso
}

/**
 * Los horarios de la tabla son cadenas en español dentro de pantallas que se
 * leen en dos idiomas. Traducirlos en la tabla rompería la indexación por país
 * (el dato dejaría de ser comparable entre entradas), así que aquí solo se
 * ofrece la CLAVE con la que traducirlos, contra una lista cerrada: lo que no
 * esté en la lista devuelve `null` y se pinta literal, porque un horario en
 * español delante de alguien que busca un teléfono es mejor que una clave sin
 * resolver.
 *
 * `/ayuda` hace hoy esta misma traducción con su propio mapa; que la clave salga
 * de aquí permite que la tarjeta del refugio (que hoy pinta el horario en crudo)
 * haga lo mismo sin duplicar la lista otra vez.
 */
const CLAVE_POR_HORARIO: ReadonlyMap<string, string> = new Map([
  ['24/7', 'crisis.horario.veinticuatroSiete'],
  ['Según el país', 'crisis.horario.segunPais'],
])

export function helpHoursKey(hours: string): string | null {
  return CLAVE_POR_HORARIO.get(hours) ?? null
}

/** `RecursoCrisis` (el dato bueno) → `HelpResource` (la forma histórica). */
function adaptar(recurso: RecursoCrisis): HelpResource {
  const comun = {
    name: recurso.nombre,
    hours: recurso.horario,
    hoursKey: helpHoursKey(recurso.horario),
    verifiedAt: recurso.verificadoEn,
    verifiedBy: recurso.verificadoPor,
    source: recurso.fuente,
    languages: recurso.idiomasAtencion,
    free: recurso.gratuito,
    type: recurso.tipo,
  }

  if (recurso.tipo === 'telefono' || recurso.tipo === 'emergencias') {
    return Object.freeze({ ...comun, phone: recurso.valor })
  }
  // Las de SMS viajan como `url` con esquema `sms:`: quien las pinte como
  // `tel:` abriría el marcador sobre un número que no atiende llamadas.
  if (recurso.tipo === 'sms') return Object.freeze({ ...comun, url: `sms:${recurso.valor}` })
  return Object.freeze({ ...comun, url: recurso.valor })
}

/** Vista adaptada de la tabla, calculada una vez. Incluye `INTERNACIONAL`. */
const ADAPTADOS: Readonly<Record<string, readonly HelpResource[]>> = (() => {
  const mapa = Object.create(null) as Record<string, readonly HelpResource[]>
  for (const clave of Object.keys(RECURSOS_POR_PAIS)) {
    mapa[clave] = Object.freeze(RECURSOS_POR_PAIS[clave]!.recursos.map(adaptar))
  }
  return Object.freeze(mapa)
})()

/**
 * Red de seguridad para países sin lista propia: un directorio internacional, no
 * un teléfono. Dar el número de otro país sería inútil o peligroso.
 *
 * Es la vista adaptada del bloque `INTERNACIONAL` de `i18n/recursosCrisis.ts`;
 * no hay datos aquí.
 */
export const INTERNATIONAL_FALLBACK: readonly HelpResource[] = ADAPTADOS.INTERNACIONAL!

/** Vista adaptada por país, sin el bloque internacional. Compatibilidad. */
export const HELP_RESOURCES: Readonly<Record<string, readonly HelpResource[]>> = Object.freeze(
  Object.fromEntries(
    Object.keys(ADAPTADOS)
      .filter((clave) => clave !== 'INTERNACIONAL')
      .map((clave) => [clave, ADAPTADOS[clave]!]),
  ),
)

/**
 * Valida un candidato a código de país. Espejo de `normalizarPais()`
 * (`i18n/pais.ts`), reescrito aquí en cuatro líneas y no importado a propósito:
 * este módulo lo consume también un componente de cliente, y `i18n/pais.ts`
 * arrastra `next/headers`.
 *
 * Un locale en minúsculas (`'es'`, `'en'`) se rechaza EXPLÍCITAMENTE. Antes se
 * hacía `toUpperCase()` sin más, de modo que `helpResourcesFor('es')` —el idioma
 * español— devolvía los teléfonos de España. Ese es el eje equivocado, y el
 * precio de equivocarse no es simétrico: quien pasa un código legítimo en
 * minúsculas se lleva el directorio internacional (correcto, aunque menos
 * concreto), y quien pasa un idioma ya no se lleva el número de un país en el
 * que no está.
 */
function codigoDePais(valor: string | null | undefined): CodigoPais | null {
  if (typeof valor !== 'string') return null
  const limpio = valor.trim()
  if (!/^[A-Za-z]{2}$/.test(limpio)) return null
  if (esLocale(limpio)) return null
  const mayus = limpio.toUpperCase()
  // `ZZ` es el "desconocido" de ISO-3166 y lo que devuelve el edge cuando no
  // sabe. Como país daría una tarjeta vacía; se prefiere el fallback.
  return mayus === 'ZZ' ? null : mayus
}

/**
 * Recursos para un país. NUNCA devuelve una lista vacía.
 *
 * Quien decide es `recursosParaPais()`: aquí solo se valida la entrada y se
 * adapta la forma de la salida.
 *
 * @param countryCode ISO 3166-1 alfa-2; `null`/desconocido → directorio
 *                    internacional. NO le pases un locale: no es lo mismo.
 */
export function helpResourcesFor(countryCode: string | null | undefined): readonly HelpResource[] {
  return ADAPTADOS[recursosParaPais(codigoDePais(countryCode)).pais]!
}

/**
 * Mensaje que acompaña a los recursos.
 *
 * Escrito con tres reglas: (1) no alarmar ni dramatizar —el susto empuja a
 * cerrar la app—, (2) no prometer lo que Darma no es —no somos terapia ni
 * emergencias—, (3) dejar claro que sigue teniendo el control de lo que
 * escribió. Nada de "hemos detectado que…": suena a vigilancia, y la persona
 * que se siente vigilada deja de contar la verdad.
 */
export function crisisMessage(level: RiskLevel): string {
  if (level === 'critical') {
    return 'Lo que has escrito nos preocupa y no queremos pasarlo por alto. ' +
      'Si estás en peligro ahora mismo, llama. Aquí en Darma nos vamos a quedar contigo, ' +
      'pero no somos profesionales y hay ayuda que sí puede llegar a donde nosotros no llegamos.'
  }
  if (level === 'high') {
    return 'Gracias por contarlo. Te dejamos aquí gente preparada para escucharte ' +
      'a cualquier hora, por si en algún momento la quieres. Darma no sustituye ' +
      'a un profesional, y no pasa nada por buscar uno.'
  }
  return 'Si en algún momento lo necesitas, esto está aquí. Sin prisa.'
}
