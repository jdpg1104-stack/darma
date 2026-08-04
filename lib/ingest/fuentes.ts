// ============================================================================
// B08 · Semilla del catálogo de orígenes.
//
// REGLA QUE NO SE NEGOCIA: ni una sola fuente sin `porQue` escrito. Este
// catálogo es lo que verá en el feed alguien que ha abierto Darma a las tres de
// la mañana. «Lo puso alguien hace seis meses» no es una respuesta aceptable
// cuando haya que explicar por qué apareció un vídeo concreto, y el campo
// obligatorio del tipo es lo que hace que la pregunta se conteste ANTES.
//
// CRITERIO DE ADMISIÓN aplicado a las cinco de abajo:
//   1. Organismo de salud pública o su oficina regional. Institución
//      identificable y responsable de lo que publica.
//   2. Licencia y derecho de incrustación claros: son canales pensados para ser
//      difundidos, no material de terceros resubido.
//   3. Sin monetización de la angustia: nada de coaching, «terapias
//      alternativas», suplementos ni cursos.
//
// Las cinco se comprobaron en vivo (HTTP 200 sobre el feed real) al escribir
// este archivo. `scripts/ingest/sembrar-fuentes.ts --verificar` repite esa
// comprobación cuando se añada cualquier otra.
//
// EL UPSERT NO PISA `enabled` NI `cooldown_until` NI `cursor`. Es deliberado:
// una fuente que un humano apagó a las tres de la mañana debe seguir apagada
// después del siguiente despliegue, y el cursor no puede retroceder o se
// reingeriría el archivo entero.
// ============================================================================

import type { SemillaFuente, FuenteIngesta, TipoFuente } from './tipos.ts'
import { urlFeedCanal, urlFeedPlaylist } from './feeds.ts'

// ⚠️ ESTAS FUENTES SON INSTITUCIONALMENTE IMPECABLES Y TOPICALMENTE DEMASIADO
// ANCHAS. Medido, no supuesto: la primera ingesta real trajo 80 piezas y CERO
// eran de salud mental. Lo que llegó fue seguridad vial, prevención de
// ahogamientos, seguridad del agua en Ghana, acuerdos de financiación y
// ceremonias de firma — porque la OMS y el CDC publican salud pública ENTERA,
// no salud mental, y aquí se apunta al canal completo con `topic: null`.
//
// `/animo` es la pantalla de quien dice «solo quiero ver contenido que me siente
// bien, sin escribir nada todavía»: el nivel de entrada, la gente que aún no se
// atreve a hablar. Un vídeo sobre ahogamientos ahí no es ruido, es daño.
//
// LO QUE FALTA, y es una decisión humana: apuntar a PLAYLISTS de salud mental en
// vez de a canales enteros. `urlFeedPlaylist()` existe en feeds.ts y no la usa
// nadie todavía. Elegir los IDs exige entrar en cada canal y mirarlos; un modelo
// que se los invente de memoria reproduce el problema de los teléfonos de crisis.
// Anotado en HANDOFF/PEDIDOS.md.
export const FUENTES_SEMILLA: readonly SemillaFuente[] = [
  {
    key: 'yt:who',
    kind: 'youtube_channel',
    handle: 'UC07-dOwgza1IguKA86jqxNA',
    language: 'en',
    topic: null,
    porQue:
      'Canal oficial de la Organización Mundial de la Salud. Publica psicoeducación y campañas de salud mental ' +
      'con respaldo institucional y sin interés comercial. Es la referencia con la que se compara cualquier otra fuente.',
  },
  {
    key: 'yt:cdc',
    kind: 'youtube_channel',
    handle: 'UCiMg06DjcUk5FRiM3g5sqoQ',
    language: 'en',
    topic: null,
    porQue:
      'Centers for Disease Control and Prevention. Material divulgativo de salud pública, incluida salud mental, ' +
      'producido por la agencia federal estadounidense. Mismo criterio institucional que la OMS.',
  },
  {
    key: 'yt:ops',
    kind: 'youtube_channel',
    handle: 'UCpNnv_kL4Jk8YG_VflnZpmg',
    language: 'es',
    topic: null,
    porQue:
      'PAHO TV — Organización Panamericana de la Salud, oficina regional de la OMS para las Américas. Es la fuente ' +
      'institucional EN ESPAÑOL del catálogo de vídeo. Sin ella, el feed en español dependería de traducciones.',
  },
  {
    key: 'rss:who_en',
    kind: 'rss',
    handle: 'https://www.who.int/rss-feeds/news-english.xml',
    language: 'en',
    topic: null,
    porQue:
      'Comunicados de la OMS en inglés. Alimenta las lecturas de bienestar con material verificable y fechado; ' +
      'el filtro de tema descarta lo que no encaje en la taxonomía dejándolo con topic = null.',
  },
  {
    key: 'rss:who_es',
    kind: 'rss',
    handle: 'https://www.who.int/rss-feeds/news-spanish.xml',
    language: 'es',
    topic: null,
    porQue:
      'El mismo canal de la OMS en español. Darma nace en español: que el catálogo de lectura dependiera de ' +
      'fuentes en inglés dejaría el feed en español permanentemente más pobre.',
  },
] as const

/** URL de la que se descarga una fuente, según su tipo. */
export function urlDeFuente(fuente: Pick<FuenteIngesta, 'kind' | 'handle'>): string {
  switch (fuente.kind) {
    case 'youtube_playlist':
      return urlFeedPlaylist(fuente.handle)
    case 'youtube_channel':
      return urlFeedCanal(fuente.handle)
    case 'rss':
      return fuente.handle
  }
}

/** Qué tipos de fuente trabaja cada cron. */
export const TIPOS_POR_CRON: Readonly<Record<'videos' | 'articulos', readonly TipoFuente[]>> = {
  videos: ['youtube_playlist', 'youtube_channel'],
  articulos: ['rss'],
} as const

/**
 * Comprueba que la semilla es coherente ANTES de escribirla: claves únicas,
 * idiomas que cumplen el CHECK y justificación presente. Se ejecuta en el
 * script de siembra y en un test — una semilla con un idioma inválido reventaría
 * el insert a mitad y dejaría el catálogo a medias.
 */
export function validarSemilla(semilla: readonly SemillaFuente[] = FUENTES_SEMILLA): string[] {
  const problemas: string[] = []
  const claves = new Set<string>()

  for (const f of semilla) {
    if (claves.has(f.key)) problemas.push(`clave duplicada: ${f.key}`)
    claves.add(f.key)

    if (!/^[a-z]{2}$/.test(f.language)) problemas.push(`idioma inválido en ${f.key}: ${f.language}`)
    if (f.handle.trim().length === 0) problemas.push(`handle vacío en ${f.key}`)
    if (f.kind === 'rss' && !/^https:\/\//.test(f.handle)) problemas.push(`el feed de ${f.key} no es https`)
    if (f.porQue.trim().length < 40) problemas.push(`justificación insuficiente en ${f.key}`)
  }
  return problemas
}
