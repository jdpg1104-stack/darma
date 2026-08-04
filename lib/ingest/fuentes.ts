// ============================================================================
// B08 · Semilla del catálogo de orígenes.
//
// REGLA QUE NO SE NEGOCIA: ni una sola fuente sin `porQue` escrito. Este
// catálogo es lo que verá en el feed alguien que ha abierto Darma a las tres de
// la mañana. «Lo puso alguien hace seis meses» no es una respuesta aceptable
// cuando haya que explicar por qué apareció un vídeo concreto, y el campo
// obligatorio del tipo es lo que hace que la pregunta se conteste ANTES.
//
// ── CRITERIO DE ADMISIÓN (revisado el 2026-08-04) ─────────────────────────
//
// La versión anterior exigía «organismo de salud pública». Se abrió a petición
// de producto: `/animo` debe poder ofrecer contenido que levante el ánimo, y
// medido contra la realidad ese contenido no existe en canales institucionales
// (ver «Lo que se buscó» abajo). Lo que NO se abre es nada de lo que protege a
// la persona que está mirando ni al proyecto.
//
//   1. AUTORÍA IDENTIFICABLE. Organismo, ONG, medio o creador con nombre y
//      responsable detrás. Un canal anónimo no entra: si mañana hay que
//      explicar por qué apareció un vídeo, tiene que haber a quién preguntar.
//
//   2. ⛔ EL CANAL PUBLICA LO SUYO. NO NEGOCIABLE, y no es una cuestión de
//      gusto: las recopilaciones de clips ajenos —el formato habitual del
//      «hopecore»— son material de terceros resubido. Incrustarlas expone a
//      Darma a una reclamación de derechos, y este es un proyecto que ya carga
//      con `identity_vault` y con una pantalla de teléfonos de crisis. El
//      primer aviso de copyright llegaría a un producto cuya promesa entera es
//      el cuidado.
//
//   3. SIN MONETIZAR LA ANGUSTIA. Nada de coaching, «terapias alternativas»,
//      suplementos, cursos ni embudos de venta. Un canal que termina sus vídeos
//      mandándote a un enlace de pago no entra, por muy bien que se sienta uno
//      al verlo.
//
//   4. ACOMPAÑAR, NO ARENGAR. El criterio nuevo, y el que más cuesta aplicar.
//      `/animo` es el nivel de entrada: gente que todavía no se atreve a
//      escribir, muchas veces de madrugada. A quien está en un episodio
//      depresivo, el motivacional insistente —«todo depende de tu actitud»,
//      «solo tienes que quererlo»— no le levanta el ánimo: le añade la culpa de
//      no ser capaz. Entra lo que dice «esto que te pasa le pasa a más gente y
//      se puede sostener»; no entra lo que dice «si no sales de esto es por ti».
//
//   5. La curación humana sigue siendo obligatoria. Nada llega al feed sin
//      `state = 'approved'` puesto por una persona. Ampliar quién puede ser
//      fuente amplía lo que se revisa, no lo que se publica a ciegas.
//
// ── LO QUE SE BUSCÓ, PARA QUE NADIE LO REPITA ──────────────────────────────
// Se resolvieron las 58 playlists de OMS y OPS contra su feed RSS real:
//   · OMS  — 30 playlists, CERO de salud mental. Lo más cercano es
//            «The Social Connection Series» (PL9S6xGsoqIBUqjIzsow3VxmDXj77JrkyT),
//            13 historias personales sobre soledad. En inglés.
//   · OPS  — 28 playlists, casi todas formación técnica (CIE-11, comités). Su
//            podcast en formato corto va sobre la rabia y las mordeduras de
//            perro. Lo único aprovechable: «Mirar al Futuro»
//            (PL6hS8Moik7ku0qViOb3LIYWrjqUelnt5c), que abre con salud mental
//            y está en español.
//   · Confederación SALUD MENTAL ESPAÑA (UC8GDMGailENHNdbUyWKatdw, feed 200):
//            institucional — congresos, campañas, audiencias. No sirve para
//            `/animo`.
//
// CONCLUSIÓN: no se encontró ninguna fuente que sea a la vez motivadora, en
// español, limpia de derechos y sin vender nada. El criterio ya no lo impide;
// lo impide que no exista. La salida realista es contenido PROPIO, producido
// para Darma, o curación vídeo a vídeo en vez de por feed. Anotado en PEDIDOS.
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
    key: 'yt:ops_mirar_al_futuro',
    kind: 'youtube_playlist',
    handle: 'PL6hS8Moik7ku0qViOb3LIYWrjqUelnt5c',
    language: 'es',
    topic: null,
    porQue:
      'OPS · «Mirar al Futuro». La ÚNICA playlist en español con respaldo institucional que se encontró abriendo ' +
      'las 58 de OMS y OPS una por una: su primer vídeo es literalmente «Mirar al Futuro: Salud mental». Apuntar a ' +
      'la playlist y no al canal entero es lo que impide que vuelvan a colarse la rabia y las mordeduras de perro, ' +
      'que es lo que trajo el canal de la OPS en la primera ingesta real.',
  },
  {
    key: 'yt:aj_historias_que_inspiran',
    kind: 'youtube_playlist',
    handle: 'PLWCXX8tjkPYteJASyU0yqEoGnongCN9IZ',
    language: 'es',
    topic: null,
    porQue:
      'AprendemosJuntos (BBVA) · «Historias que inspiran». Es lo más cercano al hopecore que existe EN ESPAÑOL cumpliendo ' +
      'el criterio de admisión: producción propia con productor identificable —no recopilación de clips ajenos, que es lo ' +
      'que descalifica al género tal y como circula—, sin cursos ni embudo de venta detrás. Y el tono es el correcto: ' +
      '«Cómo convertir tus heridas en propósito», «Aprendizajes de vida» — personas contando lo que les pasó, que es ' +
      'acompañar, no arengar. Se apunta a la PLAYLIST y no al canal, que también publica inteligencia artificial y ' +
      'arqueología: la lección que dejó la primera ingesta real de los canales de la OMS.',
  },
  {
    key: 'yt:aj_salud_y_bienestar',
    kind: 'youtube_playlist',
    handle: 'PLWCXX8tjkPYtZtKMpnSlv8K8bjedyENSs',
    language: 'es',
    topic: null,
    porQue:
      'AprendemosJuntos (BBVA) · «Salud y Bienestar». Divulgación en español con especialistas identificados, y con ' +
      'bastante material de sueño y descanso — un tema propio de la taxonomía que hoy no tiene ni una pieza. ' +
      '⚠️ Vigilar en la curación: la playlist mezcla salud física (cardiología, longevidad) con bienestar emocional, así ' +
      'que NO todo lo que entre por aquí sirve para /animo.',
  },
  {
    key: 'yt:who_social_connection',
    kind: 'youtube_playlist',
    handle: 'PL9S6xGsoqIBUqjIzsow3VxmDXj77JrkyT',
    language: 'en',
    topic: null,
    porQue:
      'OMS · «The Social Connection Series», de la Comisión sobre Conexión Social: 13 historias contadas en primera ' +
      'persona (Benny, Dave, Macy, Polina, María, Julio…) sobre soledad y aislamiento. Es lo más cercano al tono que ' +
      'necesita /animo que existe con respaldo institucional — personas contando lo que les pasó, no divulgación. ' +
      'Está en inglés y eso es una limitación real, no un descuido.',
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
