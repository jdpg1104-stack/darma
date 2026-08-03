// ============================================================================
// Boosts — visibilidad temporal con CUPO GRATUITO
//
// ── 🔴 LA LÍNEA ROJA, QUE ESTE ARCHIVO ES EL ÚNICO QUE PUEDE ROMPER ─────────
// El dinero no compra karma, ni prioridad de escucha, ni adelanta la cola de
// crisis. Traducido a este archivo:
//
//  · **Todo boost tiene alternativa gratuita.** `CUPO_GRATIS_DIARIO` boosts al
//    día no cuestan nada: los financia el karma que la persona ya ganó
//    escuchando. Quien acompaña a otros puede ser escuchado sin pagar un
//    céntimo. El dinero NUNCA es la barrera para ser escuchado.
//  · **El orden de resolución es gratis → karma → cristales**, y la UI presenta
//    primero la opción de karma (`DialogoBoost`). El dinero es el último
//    recurso, no el primero.
//  · **El efecto es idéntico se pague como se pague.** El bono del feed es
//    `BOOST_BONUS = 1.0` de `lib/feedRanking.ts`, ADITIVO y acotado, y el mismo
//    techo de 3/día lo aplica `trg_boosts_daily_limit` sin mirar la moneda. Si
//    algún día el precio en cristales comprara más visibilidad que el precio en
//    karma, la regla estaría rota.
//  · **No resucita contenido moderado ni promociona una crisis.** Un post
//    `hidden`/`removed` o con riesgo `high`/`critical` se rechaza ANTES de
//    cobrar (`impulsar_post`, errcode DA004). Promocionar la angustia de
//    alguien sería convertirla en inventario.
//  · **La cola de crisis no se toca.** `crisis_events` se ordena por
//    `created_at` y por nada más. Aquí no hay una sola sentencia que la mire.
//
// ── POR QUÉ TODO OCURRE DENTRO DE POSTGRES ──────────────────────────────────
// `impulsar_post()` (`0121_1_b12_economia.sql`) hace comprobación de cupo,
// cobro, `insert into boosts` y `update posts.boost_until` en UNA transacción.
// Si `trg_boosts_daily_limit` rechaza el cuarto boost del día, el cobro se
// revierte con él. Un usuario al que se le cobran 50 de karma por un boost que
// nunca se aplicó no vuelve — y hay un test contra Postgres que lo comprueba
// leyendo el saldo antes y después.
//
// Hacerlo en tres llamadas desde Node dejaría una ventana entre el cobro y el
// registro, y `boosts` no tiene política de INSERT precisamente para que esa
// versión no sea escribible.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorApi } from '../auth/errores.ts'
import { KARMA_COSTS } from '../karma.ts'

/**
 * Boosts gratuitos al día. **Espejo de `v_cupo_gratis` en
 * `0121_1_b12_economia.sql`**, que es la autoridad. Hay un test
 * (`sincronia.test.ts`) que lee el .sql y compara literal a literal, igual que
 * `lib/economySync.test.ts` hace con los pesos de karma: la UI no puede
 * prometer un cupo distinto del que concede la base.
 */
export const CUPO_GRATIS_DIARIO = 1

/** Duración de la ventana de boost, en horas. Espejo de `v_horas`. */
export const BOOST_HORAS = 12

/** Techo antiabuso diario. Espejo de `v_max_dia` y de `boosts_enforce_daily_limit`. */
export const BOOST_MAX_DIA = 3

/**
 * Coste en CRISTALES. Se fija igual que el coste en karma (`KARMA_COSTS.boost`)
 * a propósito: si los cristales compraran el boost más barato, el dinero
 * compraría más visibilidad por unidad de esfuerzo, y eso es la línea roja con
 * una hoja de cálculo delante.
 */
export const BOOST_COSTE_CRISTALES = KARMA_COSTS.boost

/**
 * Los tres medios, **en el orden de la regla**: gratis, karma y solo al final
 * el dinero. Es una tupla y no un array suelto porque de ella se derivan a la
 * vez el tipo (`MedioPagoBoost`) y el `z.enum` de la validación: un medio nuevo
 * se declara UNA vez y aparece en los dos sitios.
 */
export const MEDIOS_PAGO = ['gratis', 'karma', 'cristales'] as const

export type MedioPagoBoost = (typeof MEDIOS_PAGO)[number]

export interface ResultadoBoost {
  aplicado: boolean
  medio: MedioPagoBoost
  /** ISO-8601. */
  expiraEn: string
  /** Cupo gratuito que le queda hoy, para que la UI ofrezca karma antes que dinero. */
  cupoGratisRestante: number
}

/** Lo que la UI necesita para presentar las opciones EN EL ORDEN correcto. */
export interface EstadoBoost {
  cupoGratisRestante: number
  boostsHoy: number
  karmaSpendable: number
  crystals: number
  costeKarma: number
  costeCristales: number
  maxDia: number
}

export function esMedioPagoBoost(valor: unknown): valor is MedioPagoBoost {
  return typeof valor === 'string' && (MEDIOS_PAGO as readonly string[]).includes(valor)
}

/**
 * Traduce el error de `impulsar_post()` al código público.
 *
 * Los SQLSTATE propios (`DA0xx`) existen para no tener que adivinar por el
 * texto del mensaje: un `raise` con un mensaje distinto mañana no debe cambiar
 * el código HTTP de hoy. El mensaje crudo de Postgres NO sale de aquí.
 */
export function errorDeBoost(causa: unknown): ErrorApi {
  const sqlstate =
    typeof causa === 'object' && causa !== null && 'code' in causa
      ? String((causa as { code?: unknown }).code ?? '')
      : ''

  switch (sqlstate) {
    case 'DA001':
      return new ErrorApi('saldo_insuficiente', { causa })
    case 'DA002':
      return new ErrorApi('no_encontrado', { causa })
    case 'DA004':
      return new ErrorApi('sin_permiso', {
        causa,
        // Se explica en términos de producto, sin decir qué señal disparó: el
        // autor de un post marcado por riesgo no debe deducir del mensaje que
        // está en una cola de revisión.
        mensaje: 'Este post no se puede impulsar ahora mismo.',
        // La clave viaja junto al mensaje para que la pantalla lo pinte en el
        // idioma de quien lee. `mensaje` se queda como respaldo y es lo que ve
        // el log.
        mensajeClave: 'karma.economia.boost.errorNoImpulsable',
      })
    case 'DA005':
      return new ErrorApi('demasiadas_peticiones', {
        causa,
        retryAfter: segundosHastaManana(),
        mensaje: `Ya has impulsado ${BOOST_MAX_DIA} veces hoy. Mañana vuelves a tener sitio.`,
        // Con la clave genérica de `demasiadas_peticiones` esto saldría como
        // «prueba otra vez en 40 000 segundos»: el cupo es diario y el
        // `retryAfter` son horas. El matiz se pierde sin una clave propia.
        mensajeClave: 'karma.economia.boost.errorCupoDiario',
        mensajeParams: { max: BOOST_MAX_DIA },
      })
    case 'DA006':
      return new ErrorApi('entrada_invalida', { causa })
    case '23514':
      // El trigger del techo diario, si llega por la vía del propio trigger.
      return new ErrorApi('demasiadas_peticiones', { causa, retryAfter: segundosHastaManana() })
    default:
      return new ErrorApi('error_interno', { causa })
  }
}

/** Segundos hasta el próximo `date_trunc('day', now())`, que es lo que mira el trigger. */
export function segundosHastaManana(ahora: Date = new Date()): number {
  const manana = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate() + 1))
  return Math.max(1, Math.ceil((manana.getTime() - ahora.getTime()) / 1000))
}

/**
 * Impulsa un post. Cobro y registro en la misma transacción de Postgres.
 *
 * @param supabase cliente **admin**: `impulsar_post` está concedida solo a
 *                 `service_role`, y con el cliente RLS devuelve 42501. Es
 *                 deliberado — ver la cabecera.
 * @param args.medioPreferido si se omite, resuelve gratis → karma → cristales.
 *                 Si se indica, se respeta y falla con `saldo_insuficiente` si
 *                 no alcanza: cuando la persona ha elegido pagar con karma, no
 *                 se le cobra dinero "por ayudar".
 * @param args.idempotencia clave del cliente. Un doble toque en un móvil con
 *                 red mala devuelve el MISMO boost, no dos cobros.
 */
export async function impulsarPost(
  supabase: SupabaseClient,
  args: {
    userId: string
    postId: string
    medioPreferido?: MedioPagoBoost
    idempotencia?: string | null
  },
): Promise<ResultadoBoost> {
  const { data, error } = await supabase.rpc('impulsar_post', {
    p_user: args.userId,
    p_post: args.postId,
    p_medio: args.medioPreferido ?? null,
    p_idem: args.idempotencia ?? null,
  })

  if (error) throw errorDeBoost(error)

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { aplicado: boolean; medio: MedioPagoBoost; expira_en: string; cupo_gratis_restante: number }
    | undefined

  if (!fila) throw new ErrorApi('error_interno', { causa: new Error('impulsar_post sin filas') })

  return {
    aplicado: fila.aplicado === true,
    medio: fila.medio,
    expiraEn: new Date(fila.expira_en).toISOString(),
    cupoGratisRestante: Number(fila.cupo_gratis_restante ?? 0),
  }
}

/**
 * Estado para pintar el diálogo. Usa `mi_cupo_boost()`, que filtra por
 * `auth.uid()` dentro: el saldo gastable y los cristales son privados
 * (CONTRATOS §2) y `authenticated` no tiene privilegio de columna sobre ellos.
 */
export async function estadoBoost(supabase: SupabaseClient): Promise<EstadoBoost> {
  const { data, error } = await supabase.rpc('mi_cupo_boost')
  if (error) throw new ErrorApi('error_interno', { causa: error })

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { cupo_gratis_restante: number; boosts_hoy: number; karma_spendable: number; crystals: number }
    | undefined

  return {
    cupoGratisRestante: Number(fila?.cupo_gratis_restante ?? 0),
    boostsHoy: Number(fila?.boosts_hoy ?? 0),
    karmaSpendable: Number(fila?.karma_spendable ?? 0),
    crystals: Number(fila?.crystals ?? 0),
    costeKarma: KARMA_COSTS.boost,
    costeCristales: BOOST_COSTE_CRISTALES,
    maxDia: BOOST_MAX_DIA,
  }
}

/**
 * Opciones que puede ofrecer la UI, YA ORDENADAS: primero lo gratuito, después
 * el karma, y solo al final el dinero. La función es pura para que el orden sea
 * un test y no una costumbre.
 *
 * Devuelve una CLAVE de catálogo y el número aparte, no una etiqueta armada.
 * `${coste} de karma` obliga a que la frase se construya en español y a que el
 * plural se resuelva concatenando, que es justo lo que rompe en inglés («1
 * crystals»). La vista hace `t(claveEtiqueta, { n: coste })` y el plural lo
 * decide el catálogo de cada idioma.
 */
export function opcionesDePago(estado: EstadoBoost): Array<{
  medio: MedioPagoBoost
  disponible: boolean
  coste: number
  claveEtiqueta: string
}> {
  return [
    {
      medio: 'gratis',
      disponible: estado.cupoGratisRestante > 0,
      coste: 0,
      claveEtiqueta: 'karma.economia.boost.opciones.gratis',
    },
    {
      medio: 'karma',
      disponible: estado.karmaSpendable >= estado.costeKarma,
      coste: estado.costeKarma,
      claveEtiqueta: 'karma.economia.boost.opciones.karma',
    },
    {
      medio: 'cristales',
      disponible: estado.crystals >= estado.costeCristales,
      coste: estado.costeCristales,
      claveEtiqueta: 'karma.economia.boost.opciones.cristales',
    },
  ]
}
