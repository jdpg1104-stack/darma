// ============================================================================
// B08 · El orquestador.
//
// ── CONTRATO DE TIEMPO ──────────────────────────────────────────────────────
// `maxDuration = 60` en las rutas; presupuesto interno de 45 s. Los 15 s de
// margen no son prudencia genérica: son el tiempo que hace falta para GUARDAR
// EL CURSOR y salir limpiamente. Una función que se corta al agotar su techo no
// ejecuta nada más — ni el update del cursor —, así que la fuente quedaría a
// medias sin marca de por dónde iba y la siguiente ejecución repetiría el mismo
// trabajo para siempre.
//
// ── PROGRESO MÍNIMO GARANTIZADO ─────────────────────────────────────────────
// El reloj se comprueba DESPUÉS de cada ítem, no antes. Así, aunque el
// presupuesto ya esté agotado al arrancar, cada ejecución procesa al menos una
// fuente y un ítem, guarda el cursor y sale. Comprobando antes, un presupuesto
// mal configurado (o una máquina lenta) dejaría el pipeline en un bucle que no
// avanza jamás y que además parece sano en los logs: cero errores, cero ítems.
//
// ── LA REANUDACIÓN ES EL CURSOR ─────────────────────────────────────────────
// El cursor es el `published_at` del ítem más nuevo ya ingerido. Los feeds se
// recorren de MÁS ANTIGUO A MÁS NUEVO y se descarta lo que no sea estrictamente
// posterior al cursor. Al ser monótono creciente: un corte a mitad no repite lo
// hecho, y lo que se publique mañana sigue entrando por ser mayor.
//
// ── DESCUBRIMIENTO: DATA API PRIMERO, FEED ATOM COMO RESPALDO (B21 §1) ──────
// Las fuentes `youtube_playlist` y `youtube_channel` se leen con
// `playlistItems.list` (1 unidad de cuota; NUNCA `search.list`, que cuesta 100)
// a través de `descubrir.ts`. El feed Atom —gratis, sin clave, ~15 ítems— NO se
// retira: es el respaldo para CUALQUIER motivo por el que la API no conteste
// (sin clave, cuota cortada, HTTP roto, cuerpo ilegible). La API es una mejora,
// no una dependencia: quitarle la clave a este pipeline lo devuelve exactamente
// al comportamiento anterior, no lo apaga.
//
// La cuota se contabiliza con UN `crearContadorCuota()` por corrida, alimentado
// por el cupo diario PERSISTENTE de Postgres (`ingest_reservar_cuota_youtube`,
// 0214): se reserva al empezar, se corta ANTES de agotar y el sobrante se
// devuelve al terminar. El resumen del contador se emite con `ingesta_ejecutada`
// — los `cortes` son la alarma temprana de que la cuota se está agotando.
// ============================================================================

import { logger } from '../logger.ts'
import type {
  CandidatoContenido,
  EntradaCruda,
  EstadoContenido,
  FuenteIngesta,
  ResultadoEjecucion,
  TipoFuente,
} from './tipos.ts'
import { clasificarFalloHttp, siguienteCooldown } from './backoff.ts'
import { clasificar } from './clasificar.ts'
import { parsearFeedRss, parsearFeedYoutube } from './feeds.ts'
import { TIPOS_POR_CRON, urlDeFuente } from './fuentes.ts'
import { normalizar } from './normalizar.ts'
import { cribarSeguridad, MAX_LLAMADAS_MODELO, type OpcionesCribado } from './seguridad.ts'
import { verificarCanalDeEmbed, type OpcionesVerificacion } from './canalesPermitidos.ts'
import {
  clasificarCodigoIdioma,
  resolverIdiomaAudio,
  type OpcionesIdiomaAudio,
  type VeredictoIdiomaAudio,
} from './idiomaAudio.ts'
import { crearConsultaMetadatos, type ConsultaMetadatos, type MetadatosVideo, type OpcionesMetadatos } from './metadatosVideo.ts'
import { sondaEmbed, type OpcionesSonda } from './embebible.ts'
import { descubrirDeFuente, type OpcionesDescubrimiento } from './descubrir.ts'
import {
  crearContadorCuota,
  PRESUPUESTO_POR_CORRIDA,
  TOPE_DIARIO_PERSISTENTE,
  type ContadorCuota,
} from './cuota.ts'
import { crearAlmacenSupabase, CLAVE_CURSOR_REVERIFICACION, type AlmacenIngesta } from './almacen.ts'

/** Presupuesto de reloj por ejecución. Con `maxDuration = 60`, deja 15 s de margen. */
export const PRESUPUESTO_MS = 45_000

/** Tope de ítems por ejecución: que el presupuesto se agote por elección, no por sorpresa. */
export const MAX_ITEMS = 40

/** Fuentes por ejecución. Con 5 en el catálogo sobra; con 50, reparte en varias pasadas. */
export const MAX_FUENTES = 8

/** Ítems por barrido de reverificación (ficha: 200). */
export const MAX_REVERIFICACION = 200

/** Retención de `ingest_log` y tope de purga por ejecución. */
export const DIAS_RETENCION_LOG = 90
export const MAX_PURGA_LOG = 5_000

export type TipoEjecucion = 'videos' | 'articulos' | 'reverificar'

/** Todo lo inyectable. Los tests pasan dobles; producción no pasa nada. */
export interface DependenciasIngesta {
  almacen?: AlmacenIngesta
  fetchImpl?: typeof fetch
  ahora?: () => number
  cribado?: OpcionesCribado
  sonda?: OpcionesSonda
  /** Guarda de procedencia de canal (B21 §4). Inyectable para probar sin red. */
  canal?: OpcionesVerificacion
  /** Guarda de idioma de audio (B21 §2). Inyectable para probar sin red. */
  idioma?: OpcionesIdiomaAudio
  /** La consulta compartida a `videos.list` (B21). Inyectable para probar sin red. */
  metadatos?: OpcionesMetadatos
  /**
   * Descubrimiento por la Data API (B21 §1), SIN el contador: el contador lo
   * crea la corrida — uno solo para todas las fuentes, que es lo que hace que el
   * presupuesto signifique algo. Inyectable para probar sin red.
   */
  descubrir?: Omit<OpcionesDescubrimiento, 'cuota'>
  /**
   * Contador de cuota de la corrida. Los tests inyectan el suyo para afirmar
   * sobre el gasto; producción no pasa nada y la corrida reserva del cupo
   * diario persistente (`reservarCuotaYoutube`).
   */
  cuota?: ContadorCuota
}

export interface OpcionesIngesta {
  tipo: TipoEjecucion
  presupuestoMs?: number
  maxItems?: number
  maxFuentes?: number
  deps?: DependenciasIngesta
}

function resultadoVacio(): ResultadoEjecucion {
  return {
    completado: true,
    fuentesVistas: 0,
    insertados: 0,
    duplicados: 0,
    rechazados: { seguridad: 0, embed: 0, calidad: 0, canal: 0, idioma: 0 },
    pendientes: 0,
    errores: 0,
    msTranscurridos: 0,
  }
}

/**
 * Ejecuta una pasada de ingesta. NUNCA lanza por un fallo de una fuente: un
 * origen roto no puede impedir que los otros cuatro se ingieran.
 */
export async function ejecutarIngesta(opciones: OpcionesIngesta): Promise<ResultadoEjecucion> {
  const deps = opciones.deps ?? {}
  const almacen = deps.almacen ?? crearAlmacenSupabase()
  const ahora = deps.ahora ?? Date.now
  const presupuestoMs = opciones.presupuestoMs ?? PRESUPUESTO_MS
  const inicio = ahora()
  const agotado = (): boolean => ahora() - inicio >= presupuestoMs

  const r = resultadoVacio()

  if (opciones.tipo === 'reverificar') {
    const salida = await reverificar({ almacen, deps, agotado, r })
    salida.msTranscurridos = ahora() - inicio
    return salida
  }

  const kinds: readonly TipoFuente[] = TIPOS_POR_CRON[opciones.tipo]
  const maxItems = opciones.maxItems ?? MAX_ITEMS
  const maxFuentes = opciones.maxFuentes ?? MAX_FUENTES

  let fuentes: FuenteIngesta[] = []
  try {
    fuentes = await almacen.fuentesPendientes(kinds, maxFuentes)
  } catch {
    // Sin catálogo no hay nada que hacer, pero tampoco es una excepción que deba
    // llegar al cliente: se devuelve un resultado con el error contado.
    r.errores++
    r.completado = false
    r.msTranscurridos = ahora() - inicio
    return r
  }

  // Cupo del modelo POR EJECUCIÓN, además del cupo diario que vive en Postgres.
  let llamadasModelo = 0
  const consumirCupo = async (): Promise<boolean> => {
    if (llamadasModelo >= MAX_LLAMADAS_MODELO) return false
    llamadasModelo++
    return almacen.consumirCupoModelo()
  }

  // ── La cuota de la Data API: UN contador por corrida (B21 §1) ──
  //
  // Si NO hay clave, no se reserva nada: la reserva costaría un round-trip para
  // un presupuesto que ninguna llamada va a tocar (sin clave, `descubrir.ts` y
  // `metadatosVideo.ts` salen ANTES de cobrar). Es el caso real de hoy.
  //
  // Con clave y sin contador inyectado, se reserva del cupo diario persistente.
  // `reservarCuotaYoutube` es fail-closed: si el contador de Postgres no
  // responde, concede 0, la corrida no puede gastar y el descubrimiento cae al
  // feed Atom — el feed NO se apaga, solo pierde la mejora de la API.
  const hayClaveMetadatos = ((deps.metadatos?.apiKey ?? process.env.YOUTUBE_API_KEY) ?? '').trim().length > 0
  const hayClaveDescubrir = ((deps.descubrir?.claveApi ?? process.env.YOUTUBE_API_KEY) ?? '').trim().length > 0

  let cuota: ContadorCuota
  let reservadas = 0
  if (deps.cuota) {
    cuota = deps.cuota
  } else if (opciones.tipo === 'videos' && (hayClaveMetadatos || hayClaveDescubrir)) {
    reservadas = await almacen.reservarCuotaYoutube(PRESUPUESTO_POR_CORRIDA, TOPE_DIARIO_PERSISTENTE)
    cuota = crearContadorCuota({ presupuesto: reservadas })
  } else {
    cuota = crearContadorCuota({ presupuesto: 0 })
  }

  // UNA por corrida: su caché evita que dos fuentes con el mismo vídeo paguen
  // dos veces. Se envuelve para que cada `videos.list` REAL pase por el
  // contador: sin clave la consulta base no toca la red y no se cobra nada, y
  // un corte de cuota se convierte en `null` («no lo sé»), nunca en excepción.
  const consultaBase = crearConsultaMetadatos(deps.metadatos)
  const cobrados = new Set<string>()
  const consultaMetadatos: ConsultaMetadatos = async (videoId) => {
    if (!hayClaveMetadatos) return consultaBase(videoId)
    if (!cobrados.has(videoId)) {
      if (cuota.intentarGastar('videos.list') !== null) return null
      cobrados.add(videoId)
    }
    return consultaBase(videoId)
  }

  let itemsProcesados = 0

  for (const fuente of fuentes) {
    r.fuentesVistas++

    const resultado = await procesarFuente({
      fuente,
      almacen,
      deps,
      r,
      agotado,
      consumirCupo,
      restantes: () => maxItems - itemsProcesados,
      consultaMetadatos,
      cuota,
      hayClaveMetadatos,
    })
    itemsProcesados += resultado.procesados

    if (!resultado.completa) {
      r.completado = false
      break
    }
    // El tope de ítems y el reloj se comprueban ENTRE fuentes; dentro de una
    // fuente ya los comprueba `procesarFuente` tras cada ítem.
    if (itemsProcesados >= maxItems || agotado()) {
      // Solo es «incompleto» si quedaban fuentes por mirar.
      r.completado = fuente === fuentes[fuentes.length - 1]
      break
    }
  }

  // Lo reservado y no gastado vuelve al cupo del día: así el gasto contable se
  // pega al real y seis corridas no «consumen» 2.400 unidades para gastar 200.
  // Best-effort: si la devolución falla, el día pierde cupo contable — el lado
  // seguro del error.
  if (reservadas > 0 && cuota.restantes() > 0) {
    await almacen.devolverCuotaYoutube(cuota.restantes())
  }

  r.msTranscurridos = ahora() - inicio
  const resumenCuota = cuota.resumen()
  logger.info('ingesta_ejecutada', {
    tipo: opciones.tipo,
    completado: r.completado,
    fuentes: r.fuentesVistas,
    insertados: r.insertados,
    duplicados: r.duplicados,
    pendientes: r.pendientes,
    errores: r.errores,
    ms: r.msTranscurridos,
    // El resumen del contador viaja con el evento (pedido de PEDIDOS.md): los
    // `cortes` que suben de corrida en corrida son la alarma de cuota, y verla
    // aquí evita enterarse por un 403 del proveedor, que es enterarse tarde.
    cuota: {
      presupuesto: resumenCuota.presupuesto,
      gastadas: resumenCuota.gastadas,
      restantes: resumenCuota.restantes,
      llamadas: { ...resumenCuota.llamadas },
      cortes: { ...resumenCuota.cortes },
    },
  })
  return r
}

// ── Una fuente ──────────────────────────────────────────────────────────────

interface ContextoFuente {
  fuente: FuenteIngesta
  almacen: AlmacenIngesta
  deps: DependenciasIngesta
  r: ResultadoEjecucion
  agotado: () => boolean
  consumirCupo: () => Promise<boolean>
  restantes: () => number
  /** Memoizada POR CORRIDA: dos guardas, una sola unidad de cuota. */
  consultaMetadatos?: ConsultaMetadatos
  /** EL contador de la corrida. Toda llamada a la Data API pasa por él. */
  cuota: ContadorCuota
  /**
   * ¿Hay clave para `videos.list`? Distingue «no está configurado» (se sigue
   * como antes de las guardas) de «pregunté y no hubo respuesta» (cola humana).
   */
  hayClaveMetadatos: boolean
}

async function procesarFuente(ctx: ContextoFuente): Promise<{ completa: boolean; procesados: number }> {
  const { fuente, almacen, deps, r } = ctx

  // ── Obtención de candidatos: Data API primero, feed Atom de respaldo ──
  //
  // `descubrirDeFuente` lee playlist y canal por `playlistItems.list` (1 unidad,
  // hasta 50 ítems) y devuelve además `channelId`, que el feed Atom no da y que
  // la allowlist necesita. CUALQUIER motivo de fallo —sin clave, corte del
  // contador, HTTP, cuerpo ilegible— cae al feed Atom en la MISMA pasada: el
  // camino de fallo de la fuente sigue siendo uno solo (el del feed), y la API
  // no puede dejar al catálogo peor de lo que estaba sin ella.
  let crudas: EntradaCruda[] | null = null
  if (fuente.kind !== 'rss') {
    const api = await descubrirDeFuente(fuente, { cuota: ctx.cuota, ...deps.descubrir })
    if (api.motivo === null) {
      // Lista vacía INCLUIDA: la API contestó bien y no hay nada en la ventana.
      // No se confunde con el «200 ilegible» del feed — aquí no hay fallo.
      crudas = api.items
    }
  }

  if (crudas === null) {
    // ── Descarga del feed (Atom para YouTube, RSS para artículos) ──
    const fetchFn = deps.fetchImpl ?? globalThis.fetch
    let xml: string | null = null
    let status: number | null = null
    try {
      const res = await fetchFn(urlDeFuente(fuente), { headers: { accept: 'application/xml, text/xml, */*' } })
      status = typeof res?.status === 'number' ? res.status : null
      if (status != null && status >= 200 && status < 300) xml = await res.text()
    } catch {
      // Sin detalle en el log: el mensaje de un fallo HTTP puede llevar la URL.
      status = null
    }

    if (xml == null) {
      await aplicarFallo(ctx, status)
      r.errores++
      return { completa: true, procesados: 0 }
    }

    const parseadas = fuente.kind === 'rss' ? parsearFeedRss(xml) : parsearFeedYoutube(xml)
    if (parseadas.length === 0) {
      // 200 con cuerpo ilegible: se trata como fallo reintentable (`clasificarFalloHttp`
      // devuelve 'reintentar' para 2xx) porque puede ser una página de error
      // servida con 200, que es un clásico de los proveedores bajo carga.
      await aplicarFallo(ctx, status)
      r.errores++
      return { completa: true, procesados: 0 }
    }
    crudas = parseadas
  }

  // ── Orden y cursor ──
  // De más antiguo a más nuevo: es lo que hace que el cursor sea monótono y que
  // un corte a mitad no repita nada. Los ítems sin fecha van al final (se
  // procesan siempre; la idempotencia los cubre).
  const ordenadas = [...crudas].sort((a, b) => valorFecha(a.publishedAt) - valorFecha(b.publishedAt))
  const cursorPrevio = fuente.cursor
  let cursorNuevo = cursorPrevio

  let procesados = 0
  let completa = true

  for (const cruda of ordenadas) {
    if (ctx.restantes() - procesados <= 0) {
      completa = false
      break
    }

    // Lo ya ingerido en pasadas anteriores no se vuelve a mirar.
    if (cursorPrevio && cruda.publishedAt && cruda.publishedAt <= cursorPrevio) continue

    const candidato = normalizar(cruda, fuente)
    if (!candidato) {
      r.rechazados.calidad++
      // No se registra en ingest_log: sin externalId válido no hay clave con la
      // que registrarlo, y con ella el CHECK de la tabla no se cumpliría.
      if (typeof cruda.externalId === 'string' && cruda.externalId.length > 0) {
        await almacen.registrarDecision({
          sourceKey: fuente.key,
          platform: fuente.kind === 'rss' ? 'article' : 'youtube',
          externalId: cruda.externalId,
          decision: 'rejected_quality',
          reason: 'normalizacion_fallida',
        })
      }
      continue
    }

    procesados++
    try {
      await procesarCandidato(ctx, candidato)
    } catch {
      r.errores++
      await almacen.registrarDecision({
        sourceKey: fuente.key,
        platform: candidato.platform,
        externalId: candidato.externalId,
        decision: 'error',
        reason: 'excepcion_pipeline',
      })
    }

    // El cursor avanza tras CADA ítem: si la siguiente comprobación de reloj
    // corta la ejecución, lo ya hecho queda registrado.
    if (candidato.publishedAt && (!cursorNuevo || candidato.publishedAt > cursorNuevo)) {
      cursorNuevo = candidato.publishedAt
    }

    // Reloj DESPUÉS del ítem: progreso mínimo garantizado (ver cabecera).
    if (ctx.agotado()) {
      completa = false
      break
    }
  }

  await ctx.almacen.registrarExitoFuente(fuente.key, cursorNuevo)
  return { completa, procesados }
}

async function aplicarFallo(ctx: ContextoFuente, status: number | null): Promise<void> {
  const { fuente, almacen } = ctx
  const accion = clasificarFalloHttp(status)
  const motivo = status == null ? 'sin_respuesta' : `http_${status}`

  if (accion === 'deshabilitar') {
    // Un feed que devuelve 404 no va a mejorar solo. Reintentarlo cada seis
    // horas durante meses es ruido que tapa los fallos que sí importan.
    await almacen.deshabilitarFuente(fuente.key, motivo)
  } else {
    // El backoff se calcula sobre el número de fallos que HABRÁ tras registrar
    // este, y se calcula AQUÍ y no en el almacén para que la curva exponencial
    // con jitter se pueda probar sin base de datos.
    await almacen.registrarFalloFuente(fuente.key, siguienteCooldown(fuente.fallosConsecutivos + 1), motivo)
  }
  logger.warn('ingesta_fuente_fallo', { source_key: fuente.key, status: status ?? -1, accion })
}

// ── Un candidato ────────────────────────────────────────────────────────────

async function procesarCandidato(ctx: ContextoFuente, candidato: CandidatoContenido): Promise<void> {
  const { almacen, deps, r, fuente } = ctx

  // Idempotencia de segundo nivel: si ya se decidió sobre él, no se vuelve a
  // clasificar ni —sobre todo— a pagar al modelo de moderación.
  if (await almacen.yaVisto(candidato.platform, candidato.externalId)) {
    r.duplicados++
    return
  }

  // ── El ORDEN de las guardas de vídeo: embed → canal → idioma → clasificar ──
  //
  // Está elegido por lo que cuesta cada una, de gratis a caro:
  //   1. sonda de embed — oEmbed, CERO cuota de la Data API.
  //   2. canal + idioma — UNA llamada a `videos.list` (1 unidad) para las dos.
  //   3. clasificar     — determinista, gratis, pero abre paso al cribado.
  //   4. cribado        — el modelo de moderación, el recurso más caro.
  // Un vídeo que el dueño no deja incrustar muere en (1) sin gastar cuota; uno
  // de un canal ajeno muere en (2) sin pagar al modelo.
  let meta: MetadatosVideo | null = null
  if (candidato.platform === 'youtube') {
    // (1) Reproducibilidad, lo primero porque es gratis.
    const embed = await sondaEmbed(candidato.externalId, { ...deps.sonda })

    if (embed === 'no_embebible' || embed === 'ausente_o_privado') {
      if (await guardar(ctx, candidato, 'rejected', 'rejected_embed', embed)) r.rechazados.embed++
      return
    }
    if (embed === 'desconocido') {
      // «No sé» NO es «no». Se queda pendiente y el barrido diario lo reintenta.
      // Confundirlo con un rechazo archivaría contenido bueno en silencio.
      if (await guardar(ctx, candidato, 'pending', 'inserted', 'embed_desconocido')) r.pendientes++
      return
    }

    // (2) UNA sola consulta a `videos.list` para las dos guardas — y de paso la
    // duración (`contentDetails` viaja gratis en la misma unidad de cuota).
    meta = ctx.consultaMetadatos ? await ctx.consultaMetadatos(candidato.externalId) : null
    const parada = await guardasDeVideo(ctx, candidato, meta)
    if (parada) return
  }

  const clasificacion = clasificar(candidato, fuente.language)
  let item: CandidatoContenido = { ...candidato, ...clasificacion }

  // La duración real. El feed Atom no la trae y sin ella la acreditación de
  // escucha asume 60 s: el +1 se concedería a los ~54 s de cualquier vídeo.
  if (item.durationSeconds == null && meta?.durationSeconds != null) {
    item = { ...item, durationSeconds: meta.durationSeconds }
  }

  // ── Filtro de seguridad ──
  const veredicto = await cribarSeguridad(item, {
    ...deps.cribado,
    consumirCupo: deps.cribado?.consumirCupo ?? ctx.consumirCupo,
  })

  if (veredicto.decision === 'peligroso') {
    // Se guarda como 'rejected' —no se descarta en silencio— para que quede
    // rastro auditable de qué se rechazó y por qué. RLS impide que el cliente
    // lo lea: `content_items_read_approved` solo abre `state = 'approved'`.
    if (await guardar(ctx, item, 'rejected', 'rejected_safety', veredicto.motivo)) r.rechazados.seguridad++
    return
  }

  if (veredicto.decision === 'incierto') {
    // La cola humana de `idx_content_pending`. Ni aprobado ni perdido.
    if (await guardar(ctx, item, 'pending', 'inserted', veredicto.motivo ?? 'seguridad_incierta')) r.pendientes++
    return
  }

  // 'approved' solo aquí: embed 'embebible' (comprobado arriba para vídeo),
  // guardas de canal e idioma pasadas Y cribado 'seguro' (o artículo).
  if (await guardar(ctx, item, 'approved', 'inserted', null)) r.insertados++
}

/**
 * Traduce los campos crudos de `videos.list` al veredicto de idioma, sin volver
 * a la red. Replica la política de `idiomaAudio.ts` —`defaultAudioLanguage`
 * primero, `defaultLanguage` como respaldo— y conserva sus MOTIVOS separados,
 * que es lo que permite medir en `ingest_log` cuántos rechazos dependen del
 * respaldo. Ese respaldo está en revisión: DataLaps lo retiró porque
 * `defaultLanguage` describe el título, no el audio (ver B21 §2).
 */
function veredictoDeMetadatos(meta: MetadatosVideo): VeredictoIdiomaAudio {
  const porAudio = clasificarCodigoIdioma(meta.defaultAudioLanguage)
  if (porAudio !== 'desconocido') {
    return {
      decision: porAudio,
      motivo: porAudio === 'es_espanol' ? 'audio_declarado_espanol' : 'audio_declarado_no_espanol',
      codigoDeclarado: meta.defaultAudioLanguage,
      campo: 'defaultAudioLanguage',
    }
  }

  const porMetadato = clasificarCodigoIdioma(meta.defaultLanguage)
  if (porMetadato !== 'desconocido') {
    return {
      decision: porMetadato,
      motivo: porMetadato === 'es_espanol' ? 'metadato_espanol' : 'metadato_no_espanol',
      codigoDeclarado: meta.defaultLanguage,
      campo: 'defaultLanguage',
    }
  }

  // El caso más frecuente con diferencia: YouTube no rellena ninguno de los dos.
  return { decision: 'desconocido', motivo: 'sin_declarar', codigoDeclarado: null, campo: null }
}

/**
 * Veredicto de idioma cuando la consulta compartida a `videos.list` no trajo
 * nada. NO se pregunta otra vez (ver el comentario en `guardasDeVideo`); lo que
 * se decide es CÓMO leer la ausencia, y esa lectura es la política que ya
 * aplica este orquestador en las dos guardas:
 *   · sin clave      → `sin_clave_api`  — configuración, el pipeline sigue.
 *   · con clave      → `sin_respuesta`  — «pregunté y no hubo respuesta», cola.
 */
function sinConsultaDeIdioma(hayClave: boolean): VeredictoIdiomaAudio {
  return {
    decision: 'desconocido',
    motivo: hayClave ? 'sin_respuesta' : 'sin_clave_api',
    codigoDeclarado: null,
    campo: null,
  }
}

/**
 * Las dos guardas de vídeo de B21: procedencia del canal e idioma del audio.
 *
 * Devuelve `true` si el candidato NO debe seguir el pipeline — porque se rechazó
 * o porque se dejó en la cola humana.
 *
 * ── EL CONTRATO DE LOS ESTADOS INCIERTOS ───────────────────────────────────
 * Las dos guardas tienen TRES salidas, no dos, y la del medio es la que importa:
 *
 *   · rechazo firme      → `rejected`, con su motivo propio en `ingest_log`.
 *   · «no lo sé»         → `pending`. NUNCA rechazo, NUNCA aprobación.
 *   · vía libre          → sigue el pipeline.
 *
 * Un resolutor caído, una clave ausente o un `defaultAudioLanguage` que YouTube
 * no rellenó —lo más frecuente— caen todos en el medio. Tratar ese caso como
 * rechazo archivaría contenido bueno en silencio cada vez que la red hipa;
 * tratarlo como aprobación publicaría lo que nadie ha comprobado. Es la misma
 * disciplina que ya aplica `embebible.ts` con su `desconocido`, y por la que ese
 * tipo tiene cuatro valores y no un booleano.
 */
async function guardasDeVideo(
  ctx: ContextoFuente,
  candidato: CandidatoContenido,
  meta: MetadatosVideo | null,
): Promise<boolean> {
  const { deps, r } = ctx

  // (1) Procedencia.
  //
  // De dónde sale el channelId, por orden de autoridad: `videos.list` primero
  // (habla del vídeo, hoy), y si esa consulta no está —sin clave, cuota
  // cortada, red caída—, el `videoOwnerChannelId` que trajo el descubrimiento
  // (`candidato.channelId`, que sobrevive a `normalizar()` a propósito). Ninguno
  // se deduce ni se inventa: si ninguno consta, NO hay resolutor.
  //
  // El resolutor SOLO se pasa si hay de dónde sacar la respuesta. Pasar uno que
  // siempre devuelve `null` sería mentir: el módulo lo leería como «pregunté y
  // no hubo respuesta» —«no pude»— y mandaría todo a la cola humana. Sin él, el
  // veredicto es `sin_resolutor`, que es la verdad: no hay forma de comprobarlo.
  const canalConocido = meta?.channelId ?? candidato.channelId ?? null
  const resolutor = canalConocido !== null ? async (): Promise<string | null> => canalConocido : undefined
  const canal = await verificarCanalDeEmbed(candidato.url, {
    ...(resolutor ? { resolutor } : {}),
    ...deps.canal,
  })

  if (canal.decision === 'rechazado') {
    if (await guardar(ctx, candidato, 'rejected', 'rejected_channel', canal.motivo)) {
      r.rechazados.canal++
    }
    return true
  }
  // 🔴 «NO ESTÁ CONFIGURADO» NO ES «NO PUDE COMPROBARLO», y confundirlos aquí
  // apagaría el pipeline entero. Sin `YOUTUBE_API_KEY` no hay resolutor, así que
  // TODOS los vídeos caerían a la cola humana y la ingesta dejaría de aprobar
  // nada — un cambio de comportamiento enorme a cambio de cero seguridad real,
  // porque `ingest_sources` ya es una lista curada a mano.
  //
  // `sin_resolutor` es un estado de CONFIGURACIÓN: se sigue como se seguía antes
  // de que existiera esta guarda. Cualquier otro `pendiente_revision` —resolutor
  // caído, respuesta ilegible, canal sin `UC` confirmado— sí es un «no pude», y
  // ese sí manda el ítem a revisión.
  //
  // Los módulos distinguen los dos casos con motivos separados a propósito;
  // reportan hechos y dejan la política a quien llama, que es aquí.
  if (canal.decision === 'pendiente_revision' && canal.motivo !== 'sin_resolutor') {
    if (await guardar(ctx, candidato, 'pending', 'inserted', canal.motivo)) r.pendientes++
    return true
  }

  // (2) Idioma del audio.
  //
  // Si la consulta compartida trajo datos, se reutilizan: `resolverIdiomaAudio`
  // haría su propia llamada para leer los mismos dos campos. Solo se cae a la
  // consulta independiente cuando un test inyecta `deps.idioma` a propósito.
  //
  // Y si NO trajo datos, TAMPOCO se hace una segunda llamada (antes sí se
  // hacía): repetir la consulta que acaba de fallar gastaría cuota fuera del
  // contador para obtener casi siempre el mismo fallo. El veredicto se deriva
  // del hecho: sin clave es `sin_clave_api` (configuración → se sigue como
  // antes de la guarda); con clave y sin respuesta es `sin_respuesta` («no
  // pude» → cola humana). La distinción es la misma que la de `sin_resolutor`.
  const idioma =
    deps.idioma !== undefined
      ? await resolverIdiomaAudio(canal.videoId ?? candidato.externalId, { ...deps.idioma })
      : meta !== null
        ? veredictoDeMetadatos(meta)
        : sinConsultaDeIdioma(ctx.hayClaveMetadatos)

  if (idioma.decision === 'no_es_espanol') {
    if (await guardar(ctx, candidato, 'rejected', 'rejected_language', idioma.motivo)) {
      r.rechazados.idioma++
    }
    return true
  }
  // Misma distinción que arriba: `sin_clave_api` es configuración, no fallo.
  // `sin_declarar` —YouTube no rellenó ninguno de los dos campos, que es el caso
  // más frecuente— SÍ manda a revisión: ahí sí se preguntó y no hubo respuesta.
  if (idioma.decision === 'desconocido' && idioma.motivo !== 'sin_clave_api') {
    if (await guardar(ctx, candidato, 'pending', 'inserted', idioma.motivo)) r.pendientes++
    return true
  }

  return false
}

/**
 * Escribe el ítem y su decisión. Devuelve `false` si la restricción única lo
 * rechazó por duplicado —otra ejecución solapada llegó primero—, en cuyo caso
 * el contador que suma es `duplicados` y no el de la decisión.
 */
async function guardar(
  ctx: ContextoFuente,
  item: CandidatoContenido,
  state: EstadoContenido,
  decision: 'inserted' | 'rejected_safety' | 'rejected_embed' | 'rejected_language' | 'rejected_channel',
  motivo: string | null,
): Promise<boolean> {
  const insertado = await ctx.almacen.insertarContenido(item, state)
  await ctx.almacen.registrarDecision({
    sourceKey: ctx.fuente.key,
    platform: item.platform,
    externalId: item.externalId,
    decision: insertado ? decision : 'duplicate',
    reason: motivo,
  })
  if (!insertado) ctx.r.duplicados++
  return insertado
}

function valorFecha(iso: string | null | undefined): number {
  if (!iso) return Number.MAX_SAFE_INTEGER
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER
}

// ── Reverificación ──────────────────────────────────────────────────────────

/**
 * Barrido diario. Sin él, el feed acumula vídeos muertos: el embed que hoy
 * funciona puede dejar de funcionar mañana porque el dueño lo bloquea, lo pone
 * en privado o lo borra, y nadie nos avisa.
 *
 * 🔴 Un timeout NO retira nada. Si «desconocido» retirase contenido, cada hipo
 * de red vaciaría un poco más el feed y la degradación sería invisible.
 */
async function reverificar(args: {
  almacen: AlmacenIngesta
  deps: DependenciasIngesta
  agotado: () => boolean
  r: ResultadoEjecucion
}): Promise<ResultadoEjecucion> {
  const { almacen, deps, agotado, r } = args

  let cursor: string | null = null
  try {
    cursor = await almacen.leerEstado(CLAVE_CURSOR_REVERIFICACION)
  } catch {
    cursor = null
  }

  let items: Awaited<ReturnType<AlmacenIngesta['aprobadosDesde']>> = []
  try {
    items = await almacen.aprobadosDesde(cursor, MAX_REVERIFICACION)
  } catch {
    r.errores++
    r.completado = false
    return r
  }

  let ultimo: string | null = null
  for (const item of items) {
    r.fuentesVistas++
    const embed = await sondaEmbed(item.externalId, { ...deps.sonda })

    if (embed === 'no_embebible' || embed === 'ausente_o_privado') {
      await almacen.marcarRechazado(item.id)
      r.rechazados.embed++
    } else if (embed === 'desconocido') {
      // Sigue `approved`. Se contabiliza como error de sondeo para que el panel
      // vea si un día TODO da desconocido (que sería un bloqueo, no un hipo).
      r.errores++
    }
    ultimo = item.id

    if (agotado()) {
      r.completado = false
      break
    }
  }

  // El cursor solo se guarda si hubo progreso. Si la página venía incompleta,
  // se vuelve al principio: el barrido es circular y así el catálogo entero se
  // revisa cada pocos días sin llevar más estado que un uuid.
  if (ultimo) await almacen.escribirEstado(CLAVE_CURSOR_REVERIFICACION, ultimo)
  if (items.length < MAX_REVERIFICACION && r.completado) {
    await almacen.escribirEstado(CLAVE_CURSOR_REVERIFICACION, null)
  }

  // Purga acotada de `ingest_log`. Va aquí y no en un cron propio porque este
  // barrido ya es diario y de baja concurrencia. El número se registra pero no
  // se mezcla con los contadores del resultado: son cosas distintas.
  try {
    const purgadas = await almacen.purgarLog(DIAS_RETENCION_LOG, MAX_PURGA_LOG)
    if (purgadas > 0) logger.info('ingest_log_purgado', { filas: purgadas })
  } catch {
    /* La purga es mantenimiento: que falle no invalida el barrido. */
  }

  return r
}
