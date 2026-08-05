// ============================================================================
// B08 · Todo el acceso a base de datos del bloque, detrás de UN puerto.
//
// POR QUÉ UN PUERTO Y NO LLAMADAS SUELTAS: el orquestador tiene que ser
// testeable sin base de datos —los diez casos exigidos por la ficha incluyen
// idempotencia y reanudación, que son propiedades del ORDEN de las operaciones,
// no de Postgres—. Con una interfaz, el test inyecta un doble en memoria y
// comprueba justo eso.
//
// ⛔ SOLO service_role. `content_items` no tiene política de escritura y así se
// queda: es la barrera que impide que el feed de bienestar se convierta en un
// vector de contenido pro-autolesión (CONTRATOS.md §6 exige justificar por
// escrito el uso del cliente admin, y esta es la justificación). Las cuatro
// tablas de 0108 tienen RLS activada y CERO políticas: ni siquiera existen para
// `authenticated`.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '../supabase/admin.ts'
import { logger } from '../logger.ts'
import type {
  CandidatoContenido,
  DecisionRegistrada,
  EstadoContenido,
  FuenteIngesta,
  SemillaFuente,
  TipoFuente,
} from './tipos.ts'
import { MAX_LLAMADAS_MODELO_DIA } from './seguridad.ts'

/** Clave del cursor del barrido de reverificación en `ingest_state`. */
export const CLAVE_CURSOR_REVERIFICACION = 'reverify:cursor'

/** Un ítem aprobado, tal como lo necesita el barrido de reverificación. */
export interface ItemAprobado {
  id: string
  platform: string
  externalId: string
}

/** El puerto. Todo lo que el orquestador necesita de la base de datos. */
export interface AlmacenIngesta {
  /** Fuentes trabajables: habilitadas, fuera de cooldown, la menos reciente primero. */
  fuentesPendientes(kinds: readonly TipoFuente[], limite: number): Promise<FuenteIngesta[]>
  /** Éxito: pone `consecutive_failures` a 0, limpia el cooldown y guarda el cursor. */
  registrarExitoFuente(key: string, cursor: string | null): Promise<void>
  /** Fallo reintentable: incrementa el contador y fija `cooldown_until`. */
  registrarFalloFuente(key: string, cooldownHasta: Date, motivo: string): Promise<void>
  /** Fallo definitivo (4xx que no es 429): apaga la fuente y deja el motivo escrito. */
  deshabilitarFuente(key: string, motivo: string): Promise<void>

  /** ¿Ya se decidió sobre este candidato alguna vez? Sonda por `uq_ingest_log_seen`. */
  yaVisto(platform: string, externalId: string): Promise<boolean>
  registrarDecision(entrada: {
    sourceKey: string
    platform: string
    externalId: string
    decision: DecisionRegistrada
    reason: string | null
  }): Promise<void>

  /** Insert idempotente. `false` = ya existía (conflicto sobre la restricción única). */
  insertarContenido(c: CandidatoContenido, state: EstadoContenido): Promise<boolean>

  /** Keyset por `id` sobre los `approved` de una plataforma. */
  aprobadosDesde(cursor: string | null, limite: number): Promise<ItemAprobado[]>
  marcarRechazado(id: string): Promise<void>
  leerEstado(key: string): Promise<string | null>
  escribirEstado(key: string, value: string | null): Promise<void>

  /** Consume una llamada del cupo diario del modelo. `false` = sin cupo. */
  consumirCupoModelo(): Promise<boolean>
  /**
   * Reserva unidades del cupo diario PERSISTENTE de la Data API (B21 §1,
   * migración 0214). Devuelve cuántas se concedieron: `min(pedidas, restantes)`,
   * y 0 —fail-closed— si el contador no responde. La corrida crea su contador
   * en memoria con lo concedido y devuelve el sobrante al terminar.
   */
  reservarCuotaYoutube(unidades: number, tope: number): Promise<number>
  /** Devuelve al cupo diario lo reservado y NO gastado. Best-effort: si falla,
   *  las unidades quedan como gastadas, que es el lado seguro del error. */
  devolverCuotaYoutube(unidades: number): Promise<void>
  /** Purga de `ingest_log`. Devuelve cuántas filas se borraron. */
  purgarLog(diasRetencion: number, maxFilas: number): Promise<number>

  /** Vídeos de YouTube sin `duration_seconds`, keyset por `id`. Para el backfill. */
  videosSinDuracion(cursor: string | null, limite: number): Promise<Array<{ id: string; externalId: string }>>
  /** Escribe la duración SOLO si sigue NULL: el backfill jamás pisa un dato ya escrito. */
  guardarDuracion(id: string, segundos: number): Promise<void>

  /** Upsert de la semilla. No pisa `enabled`, `cursor` ni `cooldown_until`. */
  sembrarFuentes(semilla: readonly SemillaFuente[]): Promise<number>
  /** Cola de curación humana: `state = 'pending'` más antiguos primero. */
  pendientesDeCuracion(limite: number): Promise<Array<{ id: string; title: string; url: string; createdAt: string }>>
}

// ── Formas de fila ──────────────────────────────────────────────────────────
// CONTRATOS.md §3 pide derivar de `Database` (lib/supabase/database.types.ts).
// Ese archivo lo genera B15 y todavía no existe, así que estas interfaces son un
// stub LOCAL y acotado, anotado en PEDIDOS.md. Cuando exista, se sustituyen por
// `Database['public']['Tables']['ingest_sources']['Row']` y el compilador
// avisará de cualquier deriva.
interface FilaFuente {
  key: string
  kind: string
  handle: string
  language: string
  topic: string | null
  cursor: string | null
  consecutive_failures: number | null
}

interface FilaContenido {
  id: string
  platform: string
  external_id: string
}

function aFuente(fila: FilaFuente): FuenteIngesta {
  return {
    key: fila.key,
    kind: fila.kind as TipoFuente,
    handle: fila.handle,
    language: fila.language,
    topic: fila.topic,
    cursor: fila.cursor,
    fallosConsecutivos: typeof fila.consecutive_failures === 'number' ? fila.consecutive_failures : 0,
  }
}

/**
 * Implementación real sobre Supabase con service_role.
 *
 * Ningún error de esta capa lleva al cliente el mensaje del proveedor: se
 * registra `source_key` y poco más (la ficha lo exige, y un `console.error(err)`
 * de un fallo HTTP puede arrastrar una URL con la clave en la query).
 */
export function crearAlmacenSupabase(cliente?: SupabaseClient): AlmacenIngesta {
  const db = cliente ?? createAdminClient()

  return {
    async fuentesPendientes(kinds, limite) {
      const ahora = new Date().toISOString()
      const { data, error } = await db
        .from('ingest_sources')
        .select('key, kind, handle, language, topic, cursor, consecutive_failures')
        .eq('enabled', true)
        .in('kind', [...kinds])
        // `or` en vez de dos consultas: una fuente nunca llamada tiene
        // cooldown_until nulo y debe entrar igual que una ya enfriada.
        .or(`cooldown_until.is.null,cooldown_until.lte.${ahora}`)
        // `nullsFirst`: la fuente que nunca ha corrido es la que más urge.
        .order('last_run_at', { ascending: true, nullsFirst: true })
        .limit(limite)

      if (error) throw new Error(`ingest_sources_select_failed`)
      return ((data ?? []) as FilaFuente[]).map(aFuente)
    },

    async registrarExitoFuente(key, cursor) {
      const ahora = new Date().toISOString()
      const parche: Record<string, string | number | null> = {
        last_run_at: ahora,
        last_ok_at: ahora,
        consecutive_failures: 0,
        cooldown_until: null,
      }
      // El cursor solo AVANZA. Escribir null borraría el progreso de una fuente
      // que esta vez no trajo nada nuevo y provocaría una reingesta completa.
      if (cursor != null) parche.cursor = cursor

      const { error } = await db.from('ingest_sources').update(parche).eq('key', key)
      if (error) logger.warn('ingest_source_update_fallo', { source_key: key })
    },

    async registrarFalloFuente(key, cooldownHasta, motivo) {
      // Se lee el contador para incrementarlo: no hay carrera real porque solo
      // el cron escribe aquí y las fuentes se reparten por `last_run_at`. Un
      // incremento atómico exigiría una RPC más para un contador de reintentos.
      const { data } = await db.from('ingest_sources').select('consecutive_failures').eq('key', key).maybeSingle()
      const previos = typeof data?.consecutive_failures === 'number' ? data.consecutive_failures : 0

      const { error } = await db
        .from('ingest_sources')
        .update({
          last_run_at: new Date().toISOString(),
          consecutive_failures: Math.min(previos + 1, 32_000),
          cooldown_until: cooldownHasta.toISOString(),
          disabled_reason: motivo,
        })
        .eq('key', key)
      if (error) logger.warn('ingest_source_fallo_no_registrado', { source_key: key })
    },

    async deshabilitarFuente(key, motivo) {
      const { error } = await db
        .from('ingest_sources')
        .update({ enabled: false, disabled_reason: motivo, last_run_at: new Date().toISOString() })
        .eq('key', key)
      if (error) logger.warn('ingest_source_no_deshabilitada', { source_key: key })
      else logger.warn('ingest_source_deshabilitada', { source_key: key, motivo })
    },

    async yaVisto(platform, externalId) {
      const { data } = await db
        .from('ingest_log')
        .select('id')
        .eq('platform', platform)
        .eq('external_id', externalId)
        .limit(1)
        .maybeSingle()
      return data != null
    },

    async registrarDecision(entrada) {
      // `ignoreDuplicates`: dos ejecuciones solapadas pueden decidir sobre el
      // mismo candidato a la vez. La segunda no debe reventar por el unique.
      const { error } = await db.from('ingest_log').upsert(
        {
          source_key: entrada.sourceKey,
          platform: entrada.platform,
          external_id: entrada.externalId,
          decision: entrada.decision,
          reason: entrada.reason,
        },
        { onConflict: 'platform,external_id', ignoreDuplicates: true },
      )
      if (error) logger.warn('ingest_log_no_escrito', { source_key: entrada.sourceKey })
    },

    async insertarContenido(c, state) {
      // UNA sola sentencia, sin `select` previo. Comprobar antes sería una
      // carrera: dos ejecuciones solapadas del cron —que Vercel puede provocar
      // si una tarda más que su intervalo— leerían «no existe» a la vez. La
      // restricción única es la que lo resuelve, no el código.
      const { data, error } = await db
        .from('content_items')
        .upsert(
          {
            source: c.source,
            platform: c.platform,
            external_id: c.externalId,
            title: c.title,
            summary: c.summary,
            url: c.url,
            thumbnail_url: c.thumbnailUrl,
            language: c.language,
            duration_seconds: c.durationSeconds,
            topic: c.topic,
            tags: c.tags,
            state,
            published_at: c.publishedAt,
          },
          { onConflict: 'platform,external_id', ignoreDuplicates: true },
        )
        .select('id')

      if (error) throw new Error('content_items_insert_failed')
      // Cero filas devueltas = duplicado.
      return (data?.length ?? 0) > 0
    },

    async aprobadosDesde(cursor, limite) {
      let consulta = db
        .from('content_items')
        .select('id, platform, external_id')
        .eq('state', 'approved')
        .eq('platform', 'youtube')
        .order('id', { ascending: true })
        .limit(limite)
      if (cursor) consulta = consulta.gt('id', cursor)

      const { data, error } = await consulta
      if (error) throw new Error('content_items_select_failed')
      return ((data ?? []) as FilaContenido[]).map((f) => ({
        id: f.id,
        platform: f.platform,
        externalId: f.external_id,
      }))
    },

    async marcarRechazado(id) {
      // `reviewed_at` sí; `reviewed_by` NO: esa columna referencia a un perfil y
      // aquí no hay ninguna persona. La ingesta no lee ni escribe `profiles`.
      const { error } = await db
        .from('content_items')
        .update({ state: 'rejected', reviewed_at: new Date().toISOString() })
        .eq('id', id)
      if (error) logger.warn('content_item_no_rechazado', { content_id: id })
    },

    async leerEstado(key) {
      const { data } = await db.from('ingest_state').select('value').eq('key', key).maybeSingle()
      return typeof data?.value === 'string' ? data.value : null
    },

    async escribirEstado(key, value) {
      const { error } = await db
        .from('ingest_state')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
      if (error) logger.warn('ingest_state_no_escrito', { estado_key: key })
    },

    async consumirCupoModelo() {
      const { data, error } = await db.rpc('ingest_consume_model_budget', { p_max: MAX_LLAMADAS_MODELO_DIA })
      // Fail-closed: si el contador no responde, NO hay cupo. Lo contrario
      // convertiría una caída de la base de datos en gasto ilimitado.
      if (error) return false
      return data === true
    },

    async reservarCuotaYoutube(unidades, tope) {
      const { data, error } = await db.rpc('ingest_reservar_cuota_youtube', {
        p_unidades: unidades,
        p_tope: tope,
      })
      // Fail-closed, igual que el cupo del modelo: sin respuesta no hay cuota.
      // La corrida NO se queda muda por eso — el descubrimiento cae al feed
      // Atom, que no necesita cuota; solo pierde la mejora de la Data API.
      if (error) {
        logger.warn('ingest_cuota_no_reservada', { unidades })
        return 0
      }
      return typeof data === 'number' && Number.isFinite(data) && data > 0 ? Math.floor(data) : 0
    },

    async devolverCuotaYoutube(unidades) {
      if (!Number.isFinite(unidades) || unidades <= 0) return
      const { error } = await db.rpc('ingest_devolver_cuota_youtube', { p_unidades: Math.floor(unidades) })
      // Best-effort: si falla, el día pierde esas unidades del cupo contable.
      // Es el lado seguro — nunca puede llevar a gastar de más.
      if (error) logger.warn('ingest_cuota_no_devuelta', { unidades: Math.floor(unidades) })
    },

    async purgarLog(diasRetencion, maxFilas) {
      const limite = new Date(Date.now() - diasRetencion * 24 * 60 * 60 * 1000).toISOString()
      // Se seleccionan los ids primero para poder ACOTAR el borrado: un `delete`
      // por rango de fecha sin límite puede tocar millones de filas y bloquear
      // la tabla dentro de una función con 60 s de techo.
      const { data } = await db
        .from('ingest_log')
        .select('id')
        .lt('created_at', limite)
        .order('id', { ascending: true })
        .limit(maxFilas)

      const ids = ((data ?? []) as Array<{ id: number }>).map((f) => f.id)
      if (ids.length === 0) return 0

      const { error } = await db.from('ingest_log').delete().in('id', ids)
      if (error) return 0
      return ids.length
    },

    async videosSinDuracion(cursor, limite) {
      // `approved` Y `pending`: los pendientes también acabarán delante de una
      // persona y su duración importa igual. Los `rejected` no — pagar cuota por
      // completar un dato que nadie va a leer sería gasto puro.
      let consulta = db
        .from('content_items')
        .select('id, external_id')
        .eq('platform', 'youtube')
        .in('state', ['approved', 'pending'])
        .is('duration_seconds', null)
        .order('id', { ascending: true })
        .limit(limite)
      if (cursor) consulta = consulta.gt('id', cursor)

      const { data, error } = await consulta
      if (error) throw new Error('content_items_sin_duracion_failed')
      return ((data ?? []) as Array<{ id: string; external_id: string }>).map((f) => ({
        id: f.id,
        externalId: f.external_id,
      }))
    },

    async guardarDuracion(id, segundos) {
      // Espejo del CHECK de content_items (`>= 0`) más la política propia: un 0
      // no se escribe nunca (un directo con `P0D` completaría al primer latido).
      if (!Number.isFinite(segundos) || segundos <= 0) return
      const { error } = await db
        .from('content_items')
        .update({ duration_seconds: Math.floor(segundos) })
        .eq('id', id)
        // Idempotencia: solo se rellena el hueco. Si alguien escribió una
        // duración a mano entre el select y este update, se respeta la suya.
        .is('duration_seconds', null)
      if (error) logger.warn('content_item_duracion_no_escrita', { content_id: id })
    },

    async sembrarFuentes(semilla) {
      let escritas = 0
      for (const f of semilla) {
        // Upsert campo a campo y NUNCA sobre `enabled`, `cursor`,
        // `cooldown_until` ni `consecutive_failures`: lo que un humano apagó a
        // mano sigue apagado tras el despliegue, y el cursor no retrocede.
        const { error } = await db
          .from('ingest_sources')
          .upsert(
            { key: f.key, kind: f.kind, handle: f.handle, language: f.language, topic: f.topic },
            { onConflict: 'key' },
          )
        if (!error) escritas++
        else logger.warn('ingest_source_semilla_fallo', { source_key: f.key })
      }
      return escritas
    },

    async pendientesDeCuracion(limite) {
      const { data, error } = await db
        .from('content_items')
        .select('id, title, url, created_at')
        .eq('state', 'pending')
        .order('created_at', { ascending: true })
        .limit(limite)
      if (error) throw new Error('content_items_pending_failed')
      return ((data ?? []) as Array<{ id: string; title: string; url: string; created_at: string }>).map((f) => ({
        id: f.id,
        title: f.title,
        url: f.url,
        createdAt: f.created_at,
      }))
    },
  }
}
