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
// ============================================================================

import { logger } from '../logger.ts'
import type {
  CandidatoContenido,
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
import { resolverIdiomaAudio, type OpcionesIdiomaAudio } from './idiomaAudio.ts'
import { sondaEmbed, type OpcionesSonda } from './embebible.ts'
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

  r.msTranscurridos = ahora() - inicio
  logger.info('ingesta_ejecutada', {
    tipo: opciones.tipo,
    completado: r.completado,
    fuentes: r.fuentesVistas,
    insertados: r.insertados,
    duplicados: r.duplicados,
    pendientes: r.pendientes,
    errores: r.errores,
    ms: r.msTranscurridos,
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
}

async function procesarFuente(ctx: ContextoFuente): Promise<{ completa: boolean; procesados: number }> {
  const { fuente, almacen, deps, r } = ctx
  const fetchFn = deps.fetchImpl ?? globalThis.fetch

  // ── Descarga ──
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

  const crudas = fuente.kind === 'rss' ? parsearFeedRss(xml) : parsearFeedYoutube(xml)
  if (crudas.length === 0) {
    // 200 con cuerpo ilegible: se trata como fallo reintentable (`clasificarFalloHttp`
    // devuelve 'reintentar' para 2xx) porque puede ser una página de error
    // servida con 200, que es un clásico de los proveedores bajo carga.
    await aplicarFallo(ctx, status)
    r.errores++
    return { completa: true, procesados: 0 }
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

  // ── Procedencia e idioma (solo vídeo), ANTES que nada que cueste ──
  //
  // Va delante del cribado de seguridad a propósito: ese llama al modelo y
  // consume cupo. Descartar aquí un vídeo de un canal ajeno o con audio en otro
  // idioma ahorra esa llamada entera, y son las dos guardas más baratas del
  // pipeline (1 unidad de cuota de YouTube cada una, y hoy ninguna se llama si
  // falta `YOUTUBE_API_KEY`).
  if (candidato.platform === 'youtube') {
    const parada = await guardasDeVideo(ctx, candidato)
    if (parada) return
  }

  const clasificacion = clasificar(candidato, fuente.language)
  const item: CandidatoContenido = { ...candidato, ...clasificacion }

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

  // ── Reproducibilidad (solo vídeo) ──
  if (item.platform === 'youtube') {
    const embed = await sondaEmbed(item.externalId, { ...deps.sonda })

    if (embed === 'no_embebible' || embed === 'ausente_o_privado') {
      if (await guardar(ctx, item, 'rejected', 'rejected_embed', embed)) r.rechazados.embed++
      return
    }
    if (embed === 'desconocido') {
      // «No sé» NO es «no». Se queda pendiente y el barrido diario lo reintenta.
      // Confundirlo con un rechazo archivaría contenido bueno en silencio.
      if (await guardar(ctx, item, 'pending', 'inserted', 'embed_desconocido')) r.pendientes++
      return
    }
  }

  // 'approved' solo aquí: cribado 'seguro' Y embed 'embebible' (o artículo).
  if (await guardar(ctx, item, 'approved', 'inserted', null)) r.insertados++
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
async function guardasDeVideo(ctx: ContextoFuente, candidato: CandidatoContenido): Promise<boolean> {
  const { deps, r } = ctx

  // (1) Procedencia. Sin resolutor de canal configurado, `verificarCanalDeEmbed`
  //     devuelve `pendiente_revision` y el ítem cae a la cola humana: es
  //     exactamente lo que debe pasar mientras no haya forma de comprobarlo.
  const canal = await verificarCanalDeEmbed(candidato.url, { ...deps.canal })

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

  // (2) Idioma del audio. `canal.videoId` ya viene validado por la guarda
  //     anterior, así que no se vuelve a extraer de la URL.
  const idioma = await resolverIdiomaAudio(canal.videoId ?? candidato.externalId, { ...deps.idioma })

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
