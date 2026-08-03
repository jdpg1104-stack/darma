// ============================================================================
// B11 · EL PIPELINE — único punto de entrada para el resto de bloques
//
// Orden fijo, sin excepciones:
//   1. REGLAS (`lib/crisis.ts`). Síncronas, microsegundos, sin cuota y sin red.
//      Su `none` NO significa "seguro": significa "las reglas no vieron nada".
//   2. Si las reglas dan high/critical → se escribe `crisis_events` y se
//      construye la tarjeta ANTES de tocar la red. La crisis no espera al LLM.
//   3. Llamada al clasificador: calidad y riesgo en UNA sola llamada.
//   4. Riesgo final = max(reglas, LLM). La escalada es UNIDIRECCIONAL.
//   5. Auditoría de la decisión. Siempre, también cuando todo sale bien.
//
// ── LA DEGRADACIÓN SEGURA (el corazón del bloque) ──────────────────────────
// Si el clasificador no responde —sin clave, timeout, 429, refusal, JSON roto,
// presupuesto agotado—:
//   · El contenido SÍ SE PUBLICA. Silenciar a alguien porque nuestra factura
//     de IA falló es lo contrario del producto.
//   · El contenido NO se valida ⇒ no hay karma ni crédito de reciprocidad.
//     Desde la migración 0004, `comments.is_validated` solo se puede marcar con
//     el cliente admin: este clasificador es literalmente la única puerta por
//     la que se otorga karma por escuchar. Cerrada la puerta, no pasa nadie.
//   · Se abre un flag `ai_unavailable` (severidad 3) para revisión humana.
//   · Si el texto tenía CUALQUIER señal de riesgo, se escribe `crisis_events`
//     y se muestra la tarjeta.
//
// Cerrado en la economía, abierto en la voz. Nadie se queda sin ser escuchado
// porque un proveedor tenga un mal día.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { assessCrisisRisk, escalate, requiresIntervention, type RiskLevel } from '../crisis.ts'
import { validateComment } from '../moderation.ts'
import { clasificarDetallado, type ClasificacionDetallada } from './clasificarComentario.ts'
import { indeterminado, type NivelRiesgo } from './esquemas.ts'
import { USO_CERO } from './modelo.ts'
import { limitarUsuario, reservarLlamada, type DepsPresupuesto } from './presupuesto.ts'
import { abrirFlag, registrarDecision, type RefTipo } from './auditoria.ts'
import {
  construirTarjeta,
  recursosMostrados,
  resolverPaisDeUsuario,
  type TarjetaAyuda,
} from './recursos.ts'
import type { ClienteIA } from './cliente.ts'

export type TipoContenido = 'post' | 'comment' | 'refuge_message' | 'poll_answer'

export interface EntradaModeracion {
  texto: string
  tipo: TipoContenido
  /** SIEMPRE de la sesión, JAMÁS del body. Es la vulnerabilidad clásica. */
  autorId: string
  refId?: string
}

export interface SalidaModeracion {
  /** false ⇒ el contenido no se publica en absoluto (spam/tóxico evidente). */
  publicable: boolean
  /** true ⇒ acredita karma y crédito de reciprocidad. */
  validado: boolean
  riesgo: NivelRiesgo
  /** No nulo EXACTAMENTE cuando el riesgo es 'high' | 'critical'. */
  tarjetaAyuda: TarjetaAyuda | null
  degradado: boolean
}

export interface DepsPipeline extends DepsPresupuesto {
  /** Cliente del clasificador. Los tests lo inyectan siempre. */
  cliente?: ClienteIA
  /** Cliente ADMIN: crisis_events, moderation_flags e identity_vault. */
  admin?: SupabaseClient
  /** País ya resuelto. Evita el viaje a identity_vault. */
  paisConocido?: string | null
  ahora?: () => number
  /** Saltarse el límite por usuario (crons de reproceso). */
  omitirLimiteUsuario?: boolean
}

/** `moderation_flags.ref_type` no acepta 'poll_answer'; se registra como post. */
function aRefTipo(tipo: TipoContenido): RefTipo {
  if (tipo === 'comment') return 'comment'
  if (tipo === 'refuge_message') return 'refuge_message'
  return 'post'
}

/** `crisis_events.ref_type` acepta solo tres valores (CHECK de la columna). */
function aRefTipoCrisis(tipo: TipoContenido): 'post' | 'comment' | 'refuge_message' {
  if (tipo === 'comment') return 'comment'
  if (tipo === 'refuge_message') return 'refuge_message'
  return 'post'
}

/**
 * Escribe el evento de crisis. NUNCA lanza.
 *
 * Guarda QUÉ se mostró y en qué país: esa fila es la respuesta a la pregunta
 * "¿qué hizo el sistema cuando esta persona dijo eso?".
 */
export async function registrarCrisis(
  entrada: {
    userId: string
    tipo: TipoContenido
    refId?: string
    riesgo: NivelRiesgo
    recursos: string[]
    pais: string | null
  },
  deps: { admin?: SupabaseClient } = {},
): Promise<void> {
  if (!deps.admin) return
  try {
    await deps.admin.from('crisis_events').insert({
      user_id: entrada.userId,
      ref_type: aRefTipoCrisis(entrada.tipo),
      ref_id: entrada.refId ?? null,
      risk: entrada.riesgo,
      resources_shown: entrada.recursos,
      country_code: entrada.pais,
    })
  } catch (causa) {
    // Que no se pueda anotar el evento no puede impedir que la persona vea la
    // tarjeta. Se grita en el log y se sigue.
    console.error('[darma][b11] crisis_events no escrito', {
      motivo: causa instanceof Error ? causa.name : 'desconocido',
    })
  }
}

/**
 * Evalúa un texto de principio a fin.
 *
 * NUNCA lanza. Un fallo de infraestructura sale por la puerta de la
 * degradación, no por una excepción que reviente la petición de alguien.
 */
export async function evaluarContenido(
  entrada: EntradaModeracion,
  deps: DepsPipeline = {},
): Promise<SalidaModeracion> {
  // ── 1. Reglas. Gratis, instantáneas, siempre disponibles. ────────────────
  const reglas = assessCrisisRisk(entrada.texto)
  const riesgoReglas = reglas.risk_level as NivelRiesgo

  // ── 2. La crisis no espera a la red ──────────────────────────────────────
  // Si las reglas ya exigen intervención, la tarjeta se construye y el evento
  // se escribe AQUÍ, antes de cualquier llamada. Si el clasificador se cuelga
  // después, la persona ya tiene sus recursos y la cola humana ya tiene su
  // fila. Nada de lo que venga a continuación puede retrasarlo ni ocultarlo.
  let tarjeta: TarjetaAyuda | null = null
  let pais: string | null = null
  let crisisRegistrada: NivelRiesgo | null = null

  if (requiresIntervention(riesgoReglas as RiskLevel)) {
    pais = await resolverPaisDeUsuario(entrada.autorId, {
      admin: deps.admin,
      paisConocido: deps.paisConocido,
    })
    tarjeta = construirTarjeta(riesgoReglas, pais)
    await registrarCrisis(
      {
        userId: entrada.autorId,
        tipo: entrada.tipo,
        refId: entrada.refId,
        riesgo: riesgoReglas,
        recursos: recursosMostrados(tarjeta, pais),
        pais,
      },
      { admin: deps.admin },
    )
    crisisRegistrada = riesgoReglas
  }

  // ── 2b. Criba barata antes de gastar ─────────────────────────────────────
  // `lib/moderation.ts` es puro y determinista y filtra el grueso del relleno
  // sin una sola llamada de pago. Solo se aplica a comentarios: los posts no
  // tienen umbral de calidad (un desahogo de dos líneas es un desahogo).
  if (entrada.tipo === 'comment') {
    const calidadReglas = validateComment({ body: entrada.texto })
    if (!calidadReglas.valid) {
      const largoInvalido = calidadReglas.reason === 'too_short' || calidadReglas.reason === 'too_long'
      await registrarDecision(
        {
          refTipo: aRefTipo(entrada.tipo),
          refId: entrada.refId,
          sujetoId: entrada.autorId,
          calidad: 'relleno',
          puntuacion: calidadReglas.score,
          riesgo: riesgoReglas,
          motivo: `Rechazado por reglas: ${calidadReglas.reason}.`,
          degradado: false,
          causa: null,
          uso: USO_CERO,
          latenciaMs: 0,
          cacheAcertada: false,
        },
        { admin: deps.admin },
      )
      return {
        // El largo lo rechaza además el CHECK de la columna: dejarlo pasar solo
        // produciría un 500 de Postgres más adelante. Lo demás SÍ se publica:
        // que un comentario no acredite karma no es motivo para silenciarlo.
        publicable: !largoInvalido,
        validado: false,
        riesgo: riesgoReglas,
        tarjetaAyuda: tarjeta,
        degradado: false,
      }
    }
  }

  // ── 3. Presupuesto y rate limit, ANTES de la red ─────────────────────────
  const depsCupo: DepsPresupuesto = {
    admin: deps.admin,
    leerContador: deps.leerContador,
    incrementar: deps.incrementar,
  }

  const limiteOk =
    deps.omitirLimiteUsuario === true || (await limitarUsuario(entrada.autorId, depsCupo))

  const presupuesto = limiteOk
    ? await reservarLlamada(depsCupo)
    : { permitido: false, aviso: false, fraccion: 1, agotado: false, usadas: 0, maximo: 1, gastoEstimadoUsd: 0 }

  if (presupuesto.aviso && presupuesto.permitido) {
    // Aviso al 80 %. console.warn está permitido por el eslint del repo; aquí
    // no viaja ni un carácter del texto de la persona.
    console.warn('[darma][b11] presupuesto de IA al 80 %', {
      usadas: presupuesto.usadas,
      maximo: presupuesto.maximo,
      gasto_usd: presupuesto.gastoEstimadoUsd,
    })
    await abrirFlag(
      {
        refTipo: 'profile',
        senal: 'ai_budget_warning',
        severidad: 3,
        detalle: JSON.stringify({ usadas: presupuesto.usadas, maximo: presupuesto.maximo }),
      },
      { admin: deps.admin },
    )
  }

  // ── 3b. Clasificación ────────────────────────────────────────────────────
  // Con el cupo agotado o el límite por usuario superado NO se toca la red:
  // se fabrica el mismo `indeterminado` que produciría un fallo. Ese es el
  // punto — el resultado de quedarse sin presupuesto es idéntico al de una
  // caída, así que solo hay UN camino de degradación que mantener y probar.
  const detalle: ClasificacionDetallada = presupuesto.permitido
    ? await clasificarDetallado(entrada.texto, {
        cliente: deps.cliente,
        riesgoSuelo: riesgoReglas,
        tipo: entrada.tipo,
        ahora: deps.ahora,
      })
    : {
        resultado: indeterminado(
          limiteOk ? 'Presupuesto de clasificación agotado; revisión pendiente.' : 'Demasiadas clasificaciones seguidas; revisión pendiente.',
          riesgoReglas === 'none' ? 'low' : (escalate(riesgoReglas as RiskLevel, 'high') as NivelRiesgo),
        ),
        uso: USO_CERO,
        latenciaMs: 0,
        causa: 'sin_presupuesto',
        cacheAcertada: false,
      }

  const resultado = detalle.resultado

  // ── 4. Riesgo final = max(reglas, LLM). Unidireccional. ──────────────────
  const riesgoFinal = escalate(riesgoReglas as RiskLevel, resultado.riesgo as RiskLevel) as NivelRiesgo

  // Si el riesgo subió por encima de lo que ya se registró, se registra otra
  // vez con el nivel nuevo. Nunca se "corrige a la baja" una fila existente:
  // bajar un riesgo es una decisión humana que se anota en moderación.
  if (requiresIntervention(riesgoFinal as RiskLevel) && crisisRegistrada !== riesgoFinal) {
    if (pais === null && tarjeta === null) {
      pais = await resolverPaisDeUsuario(entrada.autorId, {
        admin: deps.admin,
        paisConocido: deps.paisConocido,
      })
    }
    tarjeta = construirTarjeta(riesgoFinal, pais)
    await registrarCrisis(
      {
        userId: entrada.autorId,
        tipo: entrada.tipo,
        refId: entrada.refId,
        riesgo: riesgoFinal,
        recursos: recursosMostrados(tarjeta, pais),
        pais,
      },
      { admin: deps.admin },
    )
    crisisRegistrada = riesgoFinal
  } else if (requiresIntervention(riesgoFinal as RiskLevel) && tarjeta === null) {
    tarjeta = construirTarjeta(riesgoFinal, pais)
  }

  // ── 5. Auditoría. Siempre. ───────────────────────────────────────────────
  await registrarDecision(
    {
      refTipo: aRefTipo(entrada.tipo),
      refId: entrada.refId,
      sujetoId: entrada.autorId,
      calidad: resultado.calidad,
      puntuacion: resultado.puntuacion,
      riesgo: riesgoFinal,
      motivo: resultado.motivo,
      degradado: resultado.degradado,
      causa: detalle.causa,
      uso: detalle.uso,
      latenciaMs: detalle.latenciaMs,
      cacheAcertada: detalle.cacheAcertada,
    },
    { admin: deps.admin },
  )

  return {
    // Lo tóxico evidente NO se publica. Todo lo demás sí, incluida la
    // degradación: la voz falla abierta.
    publicable: resultado.calidad !== 'toxico',
    // La economía falla CERRADA: solo un 'valido' explícito acredita karma.
    validado: resultado.calidad === 'valido' && entrada.tipo === 'comment',
    riesgo: riesgoFinal,
    tarjetaAyuda: requiresIntervention(riesgoFinal as RiskLevel) ? tarjeta : null,
    degradado: resultado.degradado,
  }
}
