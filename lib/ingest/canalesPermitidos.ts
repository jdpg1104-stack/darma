// ============================================================================
// B21 §4 · Allowlist de canal para el vídeo incrustado de /animo.
//
// ── DOS CONTROLES, NO UNO ───────────────────────────────────────────────────
// Portado del patrón de `C:\DataLaps\Pod_PilotSimulator\lib\videoEmbedAllowlist.ts`
// (leído, no copiado). La distinción es lo único que importa entender aquí:
//
//   (A) HOST — DURO Y SIEMPRE APLICABLE. Solo se aceptan URLs https de
//       youtube.com / youtube-nocookie.com / youtu.be. Esto SÍ es verificable
//       desde la URL, así que se aplica sin excepción y sin depender de nada
//       externo. Es puro, síncrono y no toca la red.
//
//   (B) IDENTIDAD DE CANAL — NO VERIFICABLE DESDE LA URL. La URL de embed
//       (`/embed/VIDEO_ID`) no lleva el channelId por ninguna parte. Saber si un
//       vídeo pertenece a la OMS exige un lookup externo videoId → channelId
//       (`videos.list`, 1 unidad de cuota) que ESTE MÓDULO NO IMPLEMENTA: aquí
//       viven la costura (`ResolutorCanal`, inyectable) y el REGISTRO contra el
//       que se comprueba. La llamada de verdad la hace §1 (`descubrir.ts`).
//
// ── POR QUÉ EN CÓDIGO SI YA ESTÁ EN LA CSP ──────────────────────────────────
// `next.config.ts` ya declara `frame-src 'self' https://www.youtube-nocookie.com`.
// Eso protege AL NAVEGADOR de un usuario que carga nuestro HTML. No protege al
// INSERT: una fila de `content_items` con una URL de otro host se escribe igual,
// sobrevive a la CSP y se sirve por API a cualquier cliente que no la comparta
// (una app nativa futura, un correo, un lector RSS, un test). Una CSP además se
// afloja en una línea y en un despliegue; una fila mala se queda en la base.
// El control tiene que existir ANTES de escribir, y por eso vive aquí.
//
// ── ALTERNATIVAS DESCARTADAS (para que no se vuelvan a evaluar) ─────────────
//
//   1. Regex sobre la cadena de la URL (`/youtube\.com/.test(url)`). Descartado:
//      pasan `https://youtube.com.evil.tld/watch?v=…` y
//      `https://evil.com/youtube.com/watch?v=…`. Se parsea con `new URL()` y se
//      mira el `hostname`, que es el único campo que el navegador usa para
//      decidir a quién conecta.
//
//   2. `hostname.endsWith('youtube.com')`. Descartado por lo mismo, y peor:
//      `evilyoutube.com` termina en `youtube.com`. La comparación es de igualdad
//      contra un conjunto cerrado y escrito a mano.
//
//   3. Aceptar cualquier subdominio de youtube.com (`*.youtube.com`). Descartado:
//      no aporta nada —el pipeline solo produce `www.youtube.com`, `youtu.be` y
//      `www.youtube-nocookie.com`— y abre la puerta a subdominios de contenido
//      subido por terceros. `m.youtube.com` tampoco está: no lo produce ninguna
//      fuente actual y la CSP no lo contempla. Si algún día hace falta, se añade
//      al array CON su prueba, no «por si acaso».
//
//   4. Deducir el canal raspando la página del vídeo con `/UC[\w-]{22}/`.
//      Descartado con dato medido: el original documenta que ese regex engancha
//      un UC incidental de la página —con pinta legítima y EQUIVOCADO—. Un
//      channelId mal atribuido es peor que no tener ninguno, porque parece
//      verificación.
//
//   5. Un booleano permitido/no permitido. Descartado por la misma razón que
//      `embebible.ts` tiene cuatro valores y `seguridad.ts` tres: «no pude
//      comprobarlo» no es «es de otro canal». Con dos salidas, un fallo de red
//      del resolutor archivaría contenido bueno en silencio, o —peor— alguien
//      aflojaría el fallo a «permitido» para que el feed no se vacíe. Aquí hay
//      tres: `permitido`, `pendiente_revision` y `rechazado`.
//
// ── FAIL-CLOSED ─────────────────────────────────────────────────────────────
// Solo `permitido` autoriza a publicar. Sin resolutor, con el resolutor caído o
// contestando algo que no es un channelId, la decisión es `pendiente_revision`:
// el ítem se queda en la cola humana (`state = 'pending'`), que es incómodo y
// reversible. Ninguna rama de este archivo devuelve `permitido` sin un channelId
// que haya casado con el registro.
//
// Ninguna función de este archivo LANZA ni toca la RED.
//
// ── LA DISCIPLINA HEREDADA: `channelId: string | null` ──────────────────────
// Ver el comentario del campo. Es la misma regla que los 24 teléfonos de crisis
// de `i18n/recursosCrisis.ts`: un dato que no consta se declara ausente, no se
// rellena con algo verosímil.
// ============================================================================

// ── (A) Control de HOST ─────────────────────────────────────────────────────

/**
 * Los ÚNICOS hosts de los que se acepta una URL de vídeo. Lista cerrada,
 * comparación por igualdad exacta, nunca por sufijo ni por comodín.
 *
 * `youtu.be` está porque es lo que devuelven los enlaces cortos de YouTube y
 * porque de él SÍ se puede extraer el videoId; no se usa nunca para renderizar
 * (para eso está `urlEmbedSinCookies`).
 */
export const HOSTS_EMBED_PERMITIDOS: readonly string[] = [
  'youtube.com',
  'www.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
] as const

const CONJUNTO_HOSTS: ReadonlySet<string> = new Set(HOSTS_EMBED_PERMITIDOS)

/** Un videoId de YouTube: exactamente 11 caracteres del alfabeto base64url. */
const RE_VIDEO_ID = /^[A-Za-z0-9_-]{11}$/

/**
 * Un channelId de YouTube: prefijo `UC` + 22 caracteres base64url.
 *
 * Exigir el prefijo tiene un efecto secundario útil: un playlistId (`PL…`) no
 * puede colarse jamás donde se espera un canal.
 */
const RE_CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/

/**
 * Parsea y valida el host de una URL. Devuelve el `URL` ya parseado solo si el
 * host está permitido; `null` en cualquier otro caso.
 *
 * Se exige `https:` explícitamente: `http://` es degradable por un intermediario
 * y `javascript:`, `data:` y `blob:` son vectores directos de inyección que un
 * chequeo basado solo en el host no vería (`javascript:…//www.youtube.com`).
 */
function urlPermitida(urlCruda: string): URL | null {
  // Los feeds mienten (ver `EntradaCruda` en tipos.ts): esto es una frontera, y
  // en una frontera el tipo declarado no es garantía de nada.
  if (typeof urlCruda !== 'string' || urlCruda.length === 0) return null

  let u: URL
  try {
    u = new URL(urlCruda)
  } catch {
    // URL relativa, protocolo ausente (`//www.youtube.com/…`) o basura.
    return null
  }

  if (u.protocol !== 'https:') return null
  // `URL` ya normaliza el host a minúsculas y convierte a punycode los homógrafos
  // (`youtubе.com` con «е» cirílica → `xn--youtub-9we.com`), así que ninguno de
  // los dos trucos sobrevive a la comparación de igualdad. El `toLowerCase()` es
  // cinturón además del tirante.
  if (!CONJUNTO_HOSTS.has(u.hostname.toLowerCase())) return null

  return u
}

/** ¿El host de esta URL es uno de los permitidos, y va por https? */
export function esHostEmbedPermitido(urlCruda: string): boolean {
  return urlPermitida(urlCruda) !== null
}

/** ¿Tiene esta cadena la forma exacta de un videoId de YouTube? */
export function esVideoIdValido(videoId: string): boolean {
  return typeof videoId === 'string' && RE_VIDEO_ID.test(videoId)
}

/** ¿Tiene esta cadena la forma exacta de un channelId de YouTube (`UC…`)? */
export function esChannelIdValido(channelId: string): boolean {
  return typeof channelId === 'string' && RE_CHANNEL_ID.test(channelId)
}

/**
 * Extrae el videoId de una URL de YouTube. `null` si el host no está permitido
 * o si lo que hay donde debería estar el id no tiene su forma exacta.
 *
 * Formatos reconocidos, y solo estos tres:
 *   · `https://www.youtube.com/watch?v=VIDEO_ID`
 *   · `https://www.youtube[-nocookie].com/embed/VIDEO_ID`
 *   · `https://youtu.be/VIDEO_ID`
 *
 * ⚠️ `/shorts/VIDEO_ID` NO se reconoce, y es deliberado, no un descuido: ninguna
 * fuente del catálogo produce esa forma (los feeds RSS de canal y playlist dan
 * URLs `watch`). Admitirla es una decisión de producto con su prueba, no un
 * `||` más. Mientras tanto, fail-closed.
 */
export function extraerVideoIdYouTube(urlCruda: string): string | null {
  const u = urlPermitida(urlCruda)
  if (u === null) return null

  let bruto: string | null = null
  if (u.hostname.toLowerCase() === 'youtu.be') {
    bruto = u.pathname.slice(1)
  } else if (u.pathname.startsWith('/embed/')) {
    bruto = u.pathname.slice('/embed/'.length)
  } else if (u.pathname === '/watch') {
    bruto = u.searchParams.get('v')
  }
  if (!bruto) return null

  // `/embed/ID/loquesea` y `youtu.be/ID/loquesea`: solo el primer segmento. El
  // `..` de un intento de travesía ya lo ha resuelto `URL` al normalizar el
  // pathname, y un `/` codificado (`%2F`) sobrevive como texto y muere en el
  // regex de abajo.
  bruto = bruto.split('/')[0]

  return esVideoIdValido(bruto) ? bruto : null
}

/**
 * Construye la URL del reproductor a partir de un videoId ya validado.
 *
 * Es la ÚNICA forma admitida de construirla, y el host no es negociable:
 * `next.config.ts` declara `frame-src 'self' https://www.youtube-nocookie.com`,
 * así que cualquier otro origen daría un iframe EN BLANCO sin error visible.
 * `-nocookie` además no deja cookies de seguimiento a quien mira, que en una app
 * de salud emocional no es un detalle menor.
 */
export function urlEmbedSinCookies(videoId: string): string | null {
  return esVideoIdValido(videoId) ? `https://www.youtube-nocookie.com/embed/${videoId}` : null
}

// ── (B) Registro de canales ─────────────────────────────────────────────────

/** Un canal de YouTube cuya identidad institucional se acepta como fuente de /animo. */
export interface CanalPermitido {
  /** `key` de la fuente en `lib/ingest/fuentes.ts`. Es el anclaje: sin fuente, no hay canal. */
  fuenteKey: string
  /** Organismo tal y como se anuncia. No se traduce. */
  organismo: string
  /** Ámbito geográfico o institucional. Sirve para desambiguar. */
  ambito: string
  /** URL pública del canal. */
  urlCanal: string
  /**
   * ID canónico del canal (`UC…`), cuando CONSTA.
   *
   * 🔴 `null` significa «canal oficial verificado pero su ID canónico NO se pudo
   * confirmar». NO significa «todavía no lo hemos buscado» y JAMÁS se rellena
   * con un `UC` deducido, inferido o recordado: un channelId inventado tiene
   * exactamente el mismo aspecto que uno bueno, y su único efecto posible es
   * autorizar un vídeo que nadie autorizó.
   *
   * Es la misma regla que los 24 teléfonos de crisis (`i18n/recursosCrisis.ts`,
   * campo `verificadoPor`): un dato que no consta se declara ausente.
   *
   * Consecuencia operativa, y por eso el campo es nullable en vez de opcional:
   * una entrada con `null` NO puede verificarse por API —`buscarCanalPorId` no
   * la encontrará nunca— y solo puede publicarse por curación humana.
   */
  channelId: string | null
  /**
   * Quién confirmó `channelId` contra la fuente oficial. `null` = NADIE todavía.
   *
   * Mismo contrato que `RecursoCrisis.verificadoPor`. Sin este campo,
   * `verificadoEn` mentiría: una fecha reciente parece una comprobación
   * reciente, y lo que hubo fue una copia.
   */
  verificadoPor: string | null
  /** Fecha ISO de la última REVISIÓN de la entrada. No implica verificación humana. */
  verificadoEn: string
  /** Por qué este canal está aquí. Obligatorio, igual que en `SemillaFuente.porQue`. */
  porQue: string
}

/**
 * EL REGISTRO. Sembrado ÚNICAMENTE con los canales que ya constan verificados en
 * `lib/ingest/fuentes.ts`. Ni uno más: añadir aquí un canal «que seguro que es
 * este» reproduce el problema de los teléfonos de crisis.
 *
 * ⚠️ Las dos fuentes de tipo `youtube_playlist` (`yt:ops_mirar_al_futuro`,
 * `yt:who_social_connection`) NO tienen entrada propia, y es correcto: un
 * playlistId (`PL…`) no es un channelId, y deducir a qué canal pertenece una
 * playlist a partir de su descripción sería inventarse un `UC`. No hace falta:
 * sus vídeos resuelven por `videos.list` al channelId de la OMS y de la OPS, que
 * sí están abajo, así que quedan cubiertos sin afirmar nada que no conste.
 */
export const CANALES_PERMITIDOS: readonly CanalPermitido[] = [
  {
    // ── El primer canal NO institucional del registro ──────────────────────
    // Entra con el criterio ampliado el 2026-08-04 (ver la cabecera de
    // `fuentes.ts`): autoría identificable, publica lo suyo, no vende nada.
    //
    // Y entra porque HIZO FALTA: al añadir sus dos playlists como fuentes, la
    // guarda rechazó sus 30 vídeos con `canal_fuera_del_registro`. Eso es la
    // defensa en profundidad funcionando — que una FUENTE esté permitida no
    // basta si el canal que publica no está registrado, porque una playlist
    // curada puede llevar material de terceros. Registrarlo es la decisión
    // humana que la guarda estaba pidiendo, no un trámite para callarla.
    fuenteKey: 'yt:aj_historias_que_inspiran',
    organismo: 'AprendemosJuntos (BBVA)',
    ambito: 'España / Hispanoamérica',
    urlCanal: 'https://www.youtube.com/channel/UCI6QcXatdaEAaRTRjl3dc0w',
    channelId: 'UCI6QcXatdaEAaRTRjl3dc0w',
    verificadoPor: null,
    verificadoEn: '2026-08-04',
    porQue:
      'Productora identificable (BBVA) de contenido propio en español, sin cursos ni embudo de venta. El channelId se ' +
      'resolvió con `videos.list` sobre un vídeo real de sus playlists, no de memoria. Cubre las dos fuentes ' +
      '`yt:aj_*`, que apuntan a playlists distintas del mismo canal.',
  },
  {
    fuenteKey: 'yt:who',
    organismo: 'Organización Mundial de la Salud (OMS/WHO)',
    ambito: 'Global',
    urlCanal: 'https://www.youtube.com/channel/UC07-dOwgza1IguKA86jqxNA',
    channelId: 'UC07-dOwgza1IguKA86jqxNA',
    verificadoPor: null,
    verificadoEn: '2026-08-04',
    porQue:
      'Canal oficial de la OMS, ya presente como fuente `yt:who` del catálogo de ingesta. El channelId se toma de ' +
      'ahí, no de una búsqueda nueva: el registro de canales permitidos no puede ser más ancho que el catálogo de ' +
      'fuentes que ya pasó por criterio humano.',
  },
  {
    fuenteKey: 'yt:cdc',
    organismo: 'Centers for Disease Control and Prevention (CDC)',
    ambito: 'Estados Unidos',
    urlCanal: 'https://www.youtube.com/channel/UCiMg06DjcUk5FRiM3g5sqoQ',
    channelId: 'UCiMg06DjcUk5FRiM3g5sqoQ',
    verificadoPor: null,
    verificadoEn: '2026-08-04',
    porQue:
      'Agencia federal estadounidense de salud pública, ya presente como fuente `yt:cdc`. Mismo criterio ' +
      'institucional que la OMS y mismo origen del channelId: el catálogo de fuentes, no la memoria de nadie.',
  },
  {
    fuenteKey: 'yt:ops',
    organismo: 'Organización Panamericana de la Salud — PAHO TV',
    ambito: 'Región de las Américas (OPS/OMS)',
    urlCanal: 'https://www.youtube.com/channel/UCpNnv_kL4Jk8YG_VflnZpmg',
    channelId: 'UCpNnv_kL4Jk8YG_VflnZpmg',
    verificadoPor: null,
    verificadoEn: '2026-08-04',
    porQue:
      'Oficina regional de la OMS para las Américas, ya presente como fuente `yt:ops`. Es la fuente institucional ' +
      'EN ESPAÑOL del catálogo de vídeo: sin ella, /animo en español dependería de canales en inglés.',
  },
] as const

/**
 * Busca un canal por su ID canónico. `null` si no está en el registro.
 *
 * 🔴 Una entrada con `channelId: null` NO PUEDE CASAR NUNCA. La comprobación de
 * formato de abajo ya lo garantizaría (`null` no pasa el regex), pero la
 * condición explícita está escrita a propósito: es la línea que impide que un
 * resolutor que devuelva algo raro acabe emparejándose con una entrada cuyo ID
 * justamente no conocemos.
 */
export function buscarCanalPorId(
  channelId: string,
  registro: readonly CanalPermitido[] = CANALES_PERMITIDOS,
): CanalPermitido | null {
  if (!esChannelIdValido(channelId)) return null
  return registro.find((c) => c.channelId !== null && c.channelId === channelId) ?? null
}

/** Los canales cuyo `channelId` todavía no ha confirmado ninguna persona con nombre. */
export function canalesPendientesDeVerificacion(
  registro: readonly CanalPermitido[] = CANALES_PERMITIDOS,
): readonly CanalPermitido[] {
  return registro.filter((c) => c.verificadoPor === null)
}

/**
 * Comprueba que el registro es coherente ANTES de que lo use nadie: claves
 * únicas, IDs con forma válida y sin duplicar, y justificación presente. Mismo
 * patrón que `validarSemilla()` en `fuentes.ts`.
 */
export function validarRegistro(registro: readonly CanalPermitido[] = CANALES_PERMITIDOS): string[] {
  const problemas: string[] = []
  const claves = new Set<string>()
  const ids = new Set<string>()

  for (const c of registro) {
    if (claves.has(c.fuenteKey)) problemas.push(`fuenteKey duplicada: ${c.fuenteKey}`)
    claves.add(c.fuenteKey)

    if (c.channelId !== null) {
      if (!esChannelIdValido(c.channelId)) problemas.push(`channelId con forma inválida en ${c.fuenteKey}`)
      if (ids.has(c.channelId)) problemas.push(`channelId duplicado en ${c.fuenteKey}`)
      ids.add(c.channelId)
    }

    if (!/^https:\/\//.test(c.urlCanal)) problemas.push(`urlCanal no https en ${c.fuenteKey}`)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(c.verificadoEn)) problemas.push(`verificadoEn no es ISO en ${c.fuenteKey}`)
    if (c.porQue.trim().length < 40) problemas.push(`justificación insuficiente en ${c.fuenteKey}`)
  }
  return problemas
}

// ── La costura: videoId → channelId ─────────────────────────────────────────

/**
 * Lo único que hace falta para cerrar el control (B): dado un videoId, ¿de qué
 * canal es? `null` = no se pudo saber (sin clave, cuota agotada, red caída, el
 * vídeo ya no existe). NO significa «de ninguno».
 *
 * ⚠️ NO SE IMPLEMENTA AQUÍ, a propósito. La implementación real es
 * `videos.list?part=snippet&id=…` (1 unidad de cuota, ver §1 y `cuota.ts`) y
 * vive en `descubrir.ts`, que es quien tiene el presupuesto y la clave. Este
 * módulo se queda puro: se prueba entero sin red y sin variables de entorno.
 *
 * ⚠️ El TIMEOUT es responsabilidad de quien implemente el resolutor. Aquí no se
 * impone ninguno porque no se puede cancelar una promesa ajena; el patrón a
 * seguir es el `AbortController` de `embebible.ts` — sin él, en serverless una
 * petición colgada se come la invocación entera.
 */
export type ResolutorCanal = (videoId: string) => Promise<string | null>

/** Las TRES salidas del control de canal. Nunca dos: ver la cabecera. */
export type DecisionCanal = 'permitido' | 'pendiente_revision' | 'rechazado'

/** Identificador estable del motivo. Es lo que se guarda en `ingest_log.reason`. */
export type MotivoCanal =
  | 'host_no_permitido'
  | 'video_id_invalido'
  | 'sin_resolutor'
  | 'resolutor_sin_respuesta'
  | 'channel_id_malformado'
  | 'canal_fuera_del_registro'
  | 'canal_permitido'

export interface VeredictoCanal {
  decision: DecisionCanal
  motivo: MotivoCanal
  /** El videoId extraído, si el control (A) lo dejó pasar. */
  videoId: string | null
  /** Lo que contestó el resolutor, si contestó algo con forma de channelId. */
  channelId: string | null
  /** La entrada del registro que autorizó el vídeo. Solo con `permitido`. */
  canal: CanalPermitido | null
}

export interface OpcionesVerificacion {
  /** Inyectable: los tests NO hacen red. Ausente ⇒ `pendiente_revision`. */
  resolutor?: ResolutorCanal
  /** Inyectable para probar el registro sin depender del real. */
  registro?: readonly CanalPermitido[]
}

/**
 * EL CONTROL COMPLETO: (A) host y videoId, y si sobreviven, (B) identidad de canal.
 *
 * Es `async` solo por el resolutor. La parte pura y síncrona —la que de verdad
 * para a un atacante— es `esHostEmbedPermitido` / `extraerVideoIdYouTube`, y se
 * prueba caso a caso.
 *
 * NUNCA LANZA: cualquier excepción del resolutor se traduce a
 * `pendiente_revision`. Si esta función lanzara, el orquestador abortaría la
 * fuente a medias y dejaría la ingesta a medio camino.
 *
 * El resolutor NO se llama si el control (A) ya rechazó: gastar una unidad de
 * cuota en una URL de `evil.tld` sería pagar por confirmar lo que ya sabemos.
 */
export async function verificarCanalDeEmbed(
  urlCruda: string,
  opciones: OpcionesVerificacion = {},
): Promise<VeredictoCanal> {
  const base: VeredictoCanal = {
    decision: 'rechazado',
    motivo: 'host_no_permitido',
    videoId: null,
    channelId: null,
    canal: null,
  }

  // ── (A) Host y videoId ──
  const videoId = extraerVideoIdYouTube(urlCruda)
  if (videoId === null) {
    // Se distinguen los dos motivos porque significan cosas distintas en el log:
    // «host ajeno» es un intento (o una fuente que se torció); «id inválido» es
    // casi siempre una URL de YouTube con una forma que aún no reconocemos, y
    // eso es una señal de mantenimiento, no de ataque.
    return { ...base, motivo: esHostEmbedPermitido(urlCruda) ? 'video_id_invalido' : 'host_no_permitido' }
  }

  // ── (B) Identidad de canal ──
  if (!opciones.resolutor) {
    // No hay forma de saber de quién es el vídeo. No es un rechazo: es una cola.
    return { ...base, decision: 'pendiente_revision', motivo: 'sin_resolutor', videoId }
  }

  let respuesta: string | null = null
  try {
    respuesta = await opciones.resolutor(videoId)
  } catch {
    // Deliberadamente sin registrar: el mensaje de un fallo HTTP puede arrastrar
    // la URL con la clave de API en la query (mismo criterio que `embebible.ts`).
    respuesta = null
  }

  // `== null` cubre null y undefined de una vez: un resolutor implementado fuera
  // de TypeScript puede devolver `undefined` sin que el tipo lo impida.
  if (respuesta == null) {
    return { ...base, decision: 'pendiente_revision', motivo: 'resolutor_sin_respuesta', videoId }
  }
  if (!esChannelIdValido(respuesta)) {
    // Contestó, pero no un channelId. No se coacciona ni se normaliza: una
    // cadena rara que se «arregla» hasta parecer un UC es la vía más corta a una
    // atribución falsa.
    return { ...base, decision: 'pendiente_revision', motivo: 'channel_id_malformado', videoId }
  }

  const canal = buscarCanalPorId(respuesta, opciones.registro)
  if (canal === null) {
    // Aquí SÍ es un rechazo firme: el resolutor contestó, el canal es legible y
    // no es ninguno de los nuestros.
    return { ...base, decision: 'rechazado', motivo: 'canal_fuera_del_registro', videoId, channelId: respuesta }
  }

  return { decision: 'permitido', motivo: 'canal_permitido', videoId, channelId: respuesta, canal }
}
