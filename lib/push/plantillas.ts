// ============================================================================
// B13 · Plantillas · lo que de verdad distingue a Darma de cualquier otra app
//
// ── TRES INVARIANTES, LAS TRES CON PRUEBA ──────────────────────────────────
//
// 1. EL CUERPO NUNCA CONTIENE EL TEXTO DE UN POST NI DE UN COMENTARIO.
//    Ni las primeras 60 palabras, ni un resumen, ni «…». Una notificación se
//    lee en una pantalla de bloqueo que puede estar mirando cualquiera: la
//    pareja de quien escribe, un compañero de piso, quien va al lado en el
//    metro. «Alguien te escuchó» dice lo suficiente para volver a la app y no
//    dice nada a quien pasa por delante. Por eso `construirCarga` NO recibe el
//    contenido: no es que se acuerde de no ponerlo, es que no lo tiene.
//
// 2. EL ALIAS SOLO APARECE SI EL EMISOR LO PERMITE.
//    `revelar_alias` es una preferencia DEL EMISOR, no del receptor. Si alguien
//    la desactiva, sus avisos llegan como «alguien» también a quien ya lo tenga
//    guardado como Alma Afín. La elección entre las dos variantes es una
//    decisión de SERVIDOR tomada con los datos del emisor: nunca del cliente y
//    nunca del receptor. Aquí eso se traduce en `aliasEmisor: string | null`,
//    donde `null` significa «no reveló» y es el valor por defecto de todo lo
//    que no se pudo confirmar.
//
// 3. NADA DE ENGANCHE VACÍO.
//    Ni rachas, ni «vuelve», ni «te echamos de menos», ni «tienes N sin leer»,
//    ni «hace X días». Cada plantilla describe algo que otra persona hizo por
//    quien lee. Hay una prueba tosca a propósito que recorre todas las
//    plantillas buscando ese vocabulario; existe para romperse el día que
//    alguien añada un gancho.
//
// ── SOBRE EL SANEADO DEL ALIAS ─────────────────────────────────────────────
// `aliasEmisor` llega de la base de datos, pero este módulo no se fía: valida
// contra la MISMA restricción que `profiles.alias` (0001_core.sql) y, si no
// encaja, lo trata como `null`. Es lo que hace que la invariante 1 se sostenga
// aunque alguien, algún día, pase por ese parámetro un texto que no debía —
// 500 caracteres de un desahogo no pasan el filtro y salen como «alguien».
// ============================================================================

import type { TipoNotificacion } from './preferencias.ts'
import type { CargaPush } from './tipos.ts'

/**
 * Misma expresión que el CHECK de `profiles.alias` en 0001_core.sql, y mismos
 * límites (3–24). Si el esquema cambia, esto tiene que cambiar con él; el
 * síntoma de la desincronización es benigno (alias válidos que salen como
 * «alguien»), que es el lado correcto en el que fallar.
 */
const ALIAS_VALIDO = /^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]{3,24}$/

/**
 * Ruta interna: empieza por `/`, sin `//` (que sería un origen ajeno) y sin
 * caracteres que permitan salirse. Un `url` inválido cae a `/feed` en vez de
 * lanzar: un aviso que no se puede entregar por una URL mal formada es un aviso
 * perdido, y aquí el aviso importa más que la precisión del destino.
 */
const RUTA_INTERNA = /^\/(?!\/)[A-Za-z0-9\-._~/]*$/

const RUTA_POR_DEFECTO = '/feed'

/** Alias utilizable, o `null`. Lo dudoso es `null`. */
function aliasSeguro(alias: string | null | undefined): string | null {
  if (typeof alias !== 'string') return null
  const limpio = alias.trim()
  return ALIAS_VALIDO.test(limpio) ? limpio : null
}

function rutaSegura(url: unknown): string {
  return typeof url === 'string' && RUTA_INTERNA.test(url) && url.length <= 200
    ? url
    : RUTA_POR_DEFECTO
}

/** Cuántos eventos se agrupan en este aviso. Siempre ≥ 1. */
function cantidad(agregados: number | undefined): number {
  return typeof agregados === 'number' && Number.isFinite(agregados) && agregados > 1
    ? Math.floor(agregados)
    : 1
}

interface Variante {
  /** Con alias confirmado del emisor. */
  conAlias(alias: string): { titulo: string; cuerpo: string }
  /** Sin alias: la persona no lo revela, o no se pudo confirmar. */
  sinAlias(): { titulo: string; cuerpo: string }
  /** Varios eventos del mismo tipo agrupados. Nunca lleva alias: en un grupo,
   *  nombrar a uno de los emisores expone a esa persona y no a las otras. */
  agrupado(n: number): { titulo: string; cuerpo: string }
}

/**
 * Las seis plantillas, con sus dos (tres) variantes.
 *
 * Todo el texto está en español directo, sin sistema de traducción: el catálogo
 * de `messages/` es de B17 y esta superficie todavía no está en él. Anotado
 * como deuda en HANDOFF/PEDIDOS.md.
 */
const PLANTILLAS: Readonly<Record<TipoNotificacion, Variante>> = {
  te_escucharon: {
    conAlias: (alias) => ({
      titulo: `${alias} te escuchó`,
      cuerpo: 'Ha respondido a lo que escribiste. Ábrelo cuando te vaya bien.',
    }),
    sinAlias: () => ({
      titulo: 'Alguien te escuchó',
      cuerpo: 'Han respondido a lo que escribiste. Ábrelo cuando te vaya bien.',
    }),
    agrupado: (n) => ({
      titulo: `${n} personas te escucharon`,
      cuerpo: 'Han respondido a lo que escribiste.',
    }),
  },

  te_ayudo: {
    conAlias: (alias) => ({
      titulo: `A ${alias} le ayudó lo que escribiste`,
      cuerpo: 'Ha marcado tu mensaje como el que le ayudó.',
    }),
    sinAlias: () => ({
      titulo: 'Le ayudó lo que escribiste',
      cuerpo: 'Alguien ha marcado tu mensaje como el que le ayudó.',
    }),
    agrupado: (n) => ({
      titulo: `A ${n} personas les ayudó lo que escribiste`,
      cuerpo: 'Han marcado tus mensajes como los que les ayudaron.',
    }),
  },

  // El aviso más importante del bloque. Directo, sin adornos y sin detalle:
  // quien lo recibe solo necesita saber que puede escribir ahora.
  alma_afin_en_crisis: {
    conAlias: (alias) => ({
      titulo: `${alias} necesita hablar`,
      cuerpo: 'Ha marcado que necesita hablar ahora. Puedes escribirle.',
    }),
    sinAlias: () => ({
      titulo: 'Un Alma Afín necesita hablar',
      cuerpo: 'Ha marcado que necesita hablar ahora. Puedes escribirle.',
    }),
    agrupado: (n) => ({
      titulo: `${n} Almas Afines necesitan hablar`,
      cuerpo: 'Han marcado que necesitan hablar ahora.',
    }),
  },

  mensaje_refugio: {
    // Ni con alias se dice de qué refugio ni qué pone: los mensajes de refugio
    // van cifrados de extremo a extremo (0002) y el servidor NO puede leerlos.
    // Que aquí no haya contenido no es una decisión de producto, es un hecho
    // del esquema — y así debe seguir.
    conAlias: (alias) => ({
      titulo: `${alias} te ha escrito`,
      cuerpo: 'Tienes un mensaje nuevo en un refugio.',
    }),
    sinAlias: () => ({
      titulo: 'Tienes un mensaje en un refugio',
      cuerpo: 'Te han escrito. El contenido solo se ve dentro.',
    }),
    agrupado: (n) => ({
      titulo: `${n} mensajes nuevos en tus refugios`,
      cuerpo: 'El contenido solo se ve dentro.',
    }),
  },

  respuesta_hilo: {
    conAlias: (alias) => ({
      titulo: `${alias} ha escrito en un hilo tuyo`,
      cuerpo: 'Hay una respuesta nueva donde tú participaste.',
    }),
    sinAlias: () => ({
      titulo: 'Hay una respuesta nueva',
      cuerpo: 'Alguien ha escrito en un hilo donde tú participaste.',
    }),
    agrupado: (n) => ({
      titulo: `${n} respuestas nuevas`,
      cuerpo: 'Han escrito en un hilo donde tú participaste.',
    }),
  },

  // El único que no viene de otra persona. Sin cifras, sin comparación con
  // nadie y sin invitación a seguir acumulando: enterarse basta.
  nivel_alcanzado: {
    conAlias: () => ({
      titulo: 'Has llegado a un nivel nuevo',
      cuerpo: 'Lo que has acompañado te ha traído hasta aquí.',
    }),
    sinAlias: () => ({
      titulo: 'Has llegado a un nivel nuevo',
      cuerpo: 'Lo que has acompañado te ha traído hasta aquí.',
    }),
    agrupado: () => ({
      titulo: 'Has llegado a un nivel nuevo',
      cuerpo: 'Lo que has acompañado te ha traído hasta aquí.',
    }),
  },
}

export interface ArgumentosCarga {
  tipo: TipoNotificacion
  /** `null` ⇒ el emisor NO revela su alias. Es el valor seguro por defecto. */
  aliasEmisor: string | null
  /** Eventos agrupados en este aviso. `undefined` o 1 ⇒ aviso individual. */
  agregados?: number
  /** Ruta interna a la que lleva el aviso. */
  url: string
}

/**
 * Construye la carga que sale por la red.
 *
 * Lo que NO hace, y es lo importante: no acepta el texto del post ni del
 * comentario, no acepta ids de contenido y no acepta HTML. La firma es la
 * barrera — lo que no se puede pasar no se puede filtrar.
 */
export function construirCarga(args: ArgumentosCarga): CargaPush {
  const plantilla = PLANTILLAS[args.tipo]
  if (!plantilla) {
    // Tipo desconocido: no se inventa un texto. Quien llame ya tiene el tipo
    // validado, así que llegar aquí es un bug y debe verse.
    throw new Error(`[darma][b13] tipo de notificación desconocido`)
  }

  const n = cantidad(args.agregados)
  const alias = aliasSeguro(args.aliasEmisor)

  const { titulo, cuerpo } =
    n > 1 ? plantilla.agrupado(n) : alias ? plantilla.conAlias(alias) : plantilla.sinAlias()

  return { tipo: args.tipo, titulo, cuerpo, url: rutaSegura(args.url) }
}

/**
 * Todas las variantes de todas las plantillas, en texto plano.
 *
 * Existe SOLO para la prueba antiadicción y para la de anonimato: sin esto, el
 * test tendría que conocer la forma interna de `PLANTILLAS` y dejaría de
 * comprobar lo que de verdad importa el día que la estructura cambie.
 */
export function todosLosTextos(): string[] {
  const textos: string[] = []
  for (const tipo of Object.keys(PLANTILLAS) as TipoNotificacion[]) {
    const v = PLANTILLAS[tipo]
    for (const variante of [v.conAlias('Alguien_'), v.sinAlias(), v.agrupado(3)]) {
      textos.push(variante.titulo, variante.cuerpo)
    }
  }
  return textos
}
