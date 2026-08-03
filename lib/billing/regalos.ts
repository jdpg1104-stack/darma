// ============================================================================
// Regalos simbólicos — comisión, reparto y por qué la aritmética es entera
//
// ── LA TRAMPA DEL REDONDEO, QUE NO ES TEÓRICA ───────────────────────────────
// `gifts` tiene tres restricciones que trabajan juntas:
//     check (cost_crystals > 0)
//     check (net_crystals >= 0)
//     check (cost_crystals = fee_crystals + net_crystals)
//
// Con comisión del 30 %, un regalo de 1 cristal da `fee = floor(0.3) = 0` y
// `net = 1`. La fila pasa. Pero si se redondea el fee AL ALZA se obtiene
// `fee = 1, net = 0`: la fila también pasa —cumple las tres— y sin embargo el
// receptor no recibe nada por un regalo que sí se cobró. Es un bug que ninguna
// restricción atrapa y que la persona sí nota.
//
// Dos decisiones, y ninguna es de estilo:
//  1. `Math.floor` en la comisión y **el resto al neto**. Así la suma cierra
//     siempre y el redondeo cae del lado de quien recibe, no del nuestro.
//  2. `PRECIO_MINIMO_REGALO` por ENCIMA de donde la aritmética entera se
//     degrada: con 10 cristales, `fee = 3` y `net = 7`, los dos > 0. Por debajo
//     de 4 la comisión sería 0 y el "regalo con comisión" dejaría de serlo.
//
// ── EL REGALO NO DA KARMA ───────────────────────────────────────────────────
// 🔴 Da cristales netos y un reconocimiento visible en el hilo. Si diera karma,
// comprar cristales compraría reputación por interpuesta persona: la línea roja
// con un rodeo. `enviar_regalo()` no llama a `award_karma()` y hay un test
// contra Postgres que comprueba que el receptor termina con los mismos
// `karma_events` y la misma `karma_reputation` que antes.
//
// ── SE GUARDAN LOS TRES NÚMEROS ─────────────────────────────────────────────
// coste, comisión y neto, no solo el coste. Cambiar la comisión mañana no debe
// reescribir el histórico: cada fila explica lo que pasó el día que pasó.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorApi } from '../auth/errores.ts'

/**
 * Comisión de los REGALOS, en tanto por uno. No tiene nada que ver con
 * `COMISION_TIENDA` de `catalogo.ts` (esa es la de Apple y Google): esta es la
 * parte del regalo que Darma retiene para sostener la infraestructura, y se
 * declara aparte para que un cambio de una no arrastre a la otra.
 */
export const COMISION_REGALO = 0.30

/**
 * Precio mínimo de un regalo. Por debajo de 4 cristales, `floor(coste * 0,30)`
 * es 0 y la comisión desaparece; se fija en 10 para estar cómodamente lejos del
 * borde y para que el catálogo tenga sentido como escala.
 */
export const PRECIO_MINIMO_REGALO = 10

/**
 * Tupla de tipos de regalo. De ella se derivan el tipo y el `z.enum` de la
 * validación: un regalo nuevo se declara una vez y aparece en los dos sitios.
 */
export const TIPOS_REGALO = ['vela', 'abrazo', 'faro', 'constelacion'] as const

export type TipoRegalo = (typeof TIPOS_REGALO)[number]

export interface DefinicionRegalo {
  kind: TipoRegalo
  costeCristales: number
  /**
   * CLAVE del catálogo i18n, no el nombre. «Una vela» es un dato de este módulo
   * que acaba LEÍDO en el selector de regalo y en el historial, dos pantallas
   * que ya están traducidas: guardar aquí el español dejaría media pantalla en
   * otro idioma. La resuelve la vista con su locale, igual que
   * `KARMA_WEIGHTS[kind].description` → `karma.tipos.<kind>`.
   *
   * 🔴 El guard de `regalos.test.ts` NO mira esta clave: mira el texto que sale
   * de los dos catálogos. Un regalo que prometiera karma en inglés no se vería
   * comprobando la clave.
   */
  claveEtiqueta: string
  /** Emoji o glifo. Puramente decorativo; nada que imite un nivel de karma. */
  simbolo: string
}

export const CATALOGO_REGALOS: Readonly<Record<TipoRegalo, DefinicionRegalo>> = {
  vela: { kind: 'vela', costeCristales: 10, claveEtiqueta: 'karma.economia.regalos.vela', simbolo: '🕯️' },
  abrazo: { kind: 'abrazo', costeCristales: 50, claveEtiqueta: 'karma.economia.regalos.abrazo', simbolo: '🫂' },
  faro: { kind: 'faro', costeCristales: 150, claveEtiqueta: 'karma.economia.regalos.faro', simbolo: '🗼' },
  constelacion: {
    kind: 'constelacion',
    costeCristales: 400,
    claveEtiqueta: 'karma.economia.regalos.constelacion',
    simbolo: '✨',
  },
} as const

export const REGALOS: readonly DefinicionRegalo[] = [
  CATALOGO_REGALOS.vela,
  CATALOGO_REGALOS.abrazo,
  CATALOGO_REGALOS.faro,
  CATALOGO_REGALOS.constelacion,
] as const

export function esTipoRegalo(valor: unknown): valor is TipoRegalo {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(CATALOGO_REGALOS, valor)
}

export interface Reparto {
  coste: number
  comision: number
  neto: number
}

/**
 * Reparto entero de un regalo. Función PURA y la única que decide números.
 *
 * INVARIANTE, y hay un test que lo recorre para TODO el catálogo y para los
 * precios que no dividen exacto: `coste === comision + neto`, con `neto >= 0`.
 * Es la misma igualdad que impone `gifts_amounts` en el motor; tenerla en los
 * dos sitios significa que un bug aquí se convierte en una excepción allí en
 * vez de en cristales creados de la nada.
 */
export function repartir(coste: number, comision: number = COMISION_REGALO): Reparto {
  if (!Number.isInteger(coste) || coste <= 0) {
    throw new ErrorApi('entrada_invalida', { causa: new Error(`coste de regalo inválido: ${coste}`) })
  }
  const fee = Math.floor(coste * comision)
  // El resto al neto: así la suma cierra SIEMPRE y el redondeo favorece a quien
  // recibe. Calcular el neto por separado con otro floor dejaría un cristal
  // huérfano en los precios que no dividen exacto.
  return { coste, comision: fee, neto: coste - fee }
}

export interface ResultadoRegalo {
  regaloId: string
  /** Saldo del EMISOR tras el cobro. El del receptor es privado suyo. */
  saldo: number
}

export type ReferenciaRegalo = 'post' | 'comment' | 'refuge'

/**
 * Envía un regalo. Cobro al emisor, abono al receptor y fila en `gifts`, todo
 * en la misma transacción de `enviar_regalo()`.
 *
 * @param supabase cliente **admin**: `enviar_regalo` está concedida solo a
 *                 `service_role`, y `gifts` no tiene política de INSERT.
 */
export async function enviarRegalo(
  supabase: SupabaseClient,
  args: {
    senderId: string
    recipientId: string
    giftKind: TipoRegalo
    refType?: ReferenciaRegalo | null
    refId?: string | null
    mensaje?: string | null
    idempotencia?: string | null
  },
): Promise<ResultadoRegalo> {
  if (args.senderId === args.recipientId) {
    // `gifts_no_self` lo impide igualmente; se para aquí para no gastar un
    // viaje a la base de datos en algo que ya sabemos.
    throw new ErrorApi('entrada_invalida', {
      mensaje: 'Un regalo es para otra persona.',
      causa: new Error('gifts_no_self'),
    })
  }

  const definicion = CATALOGO_REGALOS[args.giftKind]
  const reparto = repartir(definicion.costeCristales)

  const { data, error } = await supabase.rpc('enviar_regalo', {
    p_sender: args.senderId,
    p_recipient: args.recipientId,
    p_kind: args.giftKind,
    p_cost: reparto.coste,
    p_fee: reparto.comision,
    p_net: reparto.neto,
    p_ref_type: args.refType ?? null,
    p_ref_id: args.refId ?? null,
    p_message: args.mensaje ?? null,
    p_idem: args.idempotencia ?? null,
  })

  if (error) throw errorDeRegalo(error)

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { regalo_id: string; saldo: number }
    | undefined

  if (!fila) throw new ErrorApi('error_interno', { causa: new Error('enviar_regalo sin filas') })

  return { regaloId: fila.regalo_id, saldo: Number(fila.saldo ?? 0) }
}

/** SQLSTATE propio → código público. El mensaje de Postgres no sale de aquí. */
export function errorDeRegalo(causa: unknown): ErrorApi {
  const sqlstate =
    typeof causa === 'object' && causa !== null && 'code' in causa
      ? String((causa as { code?: unknown }).code ?? '')
      : ''

  switch (sqlstate) {
    case 'DA001':
      return new ErrorApi('saldo_insuficiente', { causa })
    case 'DA002':
      return new ErrorApi('no_encontrado', { causa })
    case 'DA003':
      return new ErrorApi('entrada_invalida', { causa, mensaje: 'Un regalo es para otra persona.' })
    case 'DA006':
      return new ErrorApi('entrada_invalida', { causa })
    case '23514':
      // `gifts_no_self` o `gifts_amounts` desde el propio motor.
      return new ErrorApi('entrada_invalida', { causa })
    default:
      return new ErrorApi('error_interno', { causa })
  }
}
