// ============================================================================
// /panel/activacion · Lógica pura del embudo por ventanas y del pilar 1
//
// Existe por el hallazgo del crítico: el dueño no podía ver si el embudo
// funciona — nada medía la activación de verdad ni el éxito del pilar 1
// (Ánimo). Este módulo lo deriva TODO de datos que ya existen, agregados por
// día, sin una sola fila por persona en la salida y sin añadir tracking nuevo.
//
// ── LAS DOS FUENTES ────────────────────────────────────────────────────────
//   · `admin_metrics_daily` (0191): registro, onboarding, primera lectura,
//     primera escucha validada, primera publicación. Llega ya cargada por la
//     página (que también pinta la serie de 90 días con ella).
//   · `admin_embudo_daily` (0218, de este bloque): vuelta al día siguiente y
//     pilar 1 (vídeos completados, personas distintas). `leerEmbudoDiario()`
//     es la ÚNICA consulta nueva de la página: 2 en total, bajo el presupuesto
//     de 3 de CONTRATOS §11 y con cero agregación en vivo — las dos leen una
//     fila por día de una tabla de rollup.
//
// ── LOS LÍMITES, DICHOS ANTES DE QUE LOS DESCUBRA NADIE ────────────────────
//   · «Cuenta creada» y «perfil completado» son EL MISMO acontecimiento
//     medible: la fila de `profiles` nace al terminar el onboarding (alias +
//     avatar) y el consentimiento `edad_minima` se registra en ese instante
//     (app/api/auth/perfil/route.ts). Las altas anónimas que nunca terminan
//     viven solo en `auth.users`, fuera del esquema público: no se miden y se
//     dice, en vez de inventar el número.
//   · «Volvió al día siguiente» son DOS cifras que acotan la verdad:
//     `actividad` (dejó una vista de contenido o un evento de karma en su
//     segundo día: subestima, quien solo lee no deja rastro) y `cota` (fue
//     visto en cualquier momento después de su primer día: sobreestima). No
//     hay tabla de sesiones; la vuelta real vive entre ambas.
//   · `personasCompletaronCota` SUMA las personas distintas de cada día, así
//     que sobrecuenta a quien completó vídeos dos días distintos. Es la misma
//     cota superior consciente que `compradores_unicos` en `getEconomia()`:
//     el cálculo exacto exigiría un count(distinct) en vivo sobre
//     `content_views`, la tabla más grande de la app.
//
// ── ANONIMATO (CONTRATOS §2) ───────────────────────────────────────────────
// Aquí solo entran y salen NÚMEROS agregados por día. El enmascarado («<20»)
// es de presentación y lo aplica la página, nunca este módulo: las tasas se
// calculan sobre los números reales.
//
// ── EL COPY VIVE EN EL CATÁLOGO, NO AQUÍ ───────────────────────────────────
// Todo el texto de la pantalla está en `messages/{es,en}.json` bajo
// `admin.activacion.*`. Este módulo sigue siendo PURO y sin traductor: lo que
// devuelve `escalonesDeVentana()` es la CLAVE de cada escalón (`etiquetaKey`),
// y la página la resuelve con `t()`. Mismo patrón que `_lib/navegacion.ts`.
//
// Devolver la clave y no el texto es además lo que mantiene las pruebas de
// este módulo independientes del idioma: comprueban el ORDEN del embudo, que
// es la decisión, no la redacción.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'
// Ruta relativa y no el alias `@/` (CONTRATOS §1): `node --test
// --experimental-strip-types` no resuelve el alias, y las pruebas de este
// módulo corren sin arrancar Next. Mismo criterio que `_lib/dashboard.ts`.
import { ratio, type FilaRollup, type Ventana, aDiaUtc } from '../../_lib/dashboard.ts'

// ── Contrato público ────────────────────────────────────────────────────────

/** Ventana de la consulta a `admin_embudo_daily`: cubre la mayor de las dos
 *  ventanas comparadas (7 y 30). */
export const DIAS_VENTANA_EMBUDO = 30

/** Las dos ventanas que la página compara, de la más corta a la más larga. */
export const VENTANAS_COMPARADAS: readonly number[] = [7, 30] as const

/**
 * Forma de `admin_embudo_daily.metricas` (0218). Todas las claves opcionales a
 * propósito, como `MetricasDia`: una fila de otra versión del rollup no puede
 * reventar el panel — `num()` rellena con 0.
 */
export interface MetricasEmbudoDia {
  act_registrados?: number
  act_vuelta_d1_actividad?: number
  act_vuelta_d1_cota?: number
  videos_completados?: number
  personas_completaron?: number
}

export interface FilaEmbudo {
  dia: string
  metricas: MetricasEmbudoDia
  calculadoEn: string
}

/** El embudo de una ventana, en números REALES (sin enmascarar). */
export interface EmbudoVentana {
  dias: number
  registrados: number
  onboardingCompleto: number
  primeraLectura: number
  primeraEscuchaValidada: number
  primeraPublicacion: number
  vueltaD1Actividad: number
  vueltaD1Cota: number
}

/** Un escalón listo para la tabla: personas y tasa sobre el registro. */
export interface EscalonVentana {
  /** CLAVE del catálogo (`admin.activacion.escalon*`), nunca el texto. */
  etiquetaKey: string
  personas: number
  /** 0..1, calculada sobre los números reales. */
  sobreRegistro: number
}

export interface ResumenPilar1 {
  dias: number
  /** Eventos (un completado por persona y vídeo), no personas. */
  videosCompletados: number
  /** Suma de las personas distintas de cada día: COTA SUPERIOR (ver cabecera). */
  personasCompletaronCota: number
  serie: Array<{ dia: string; videos: number; personas: number }>
}

// ── Helpers puros ───────────────────────────────────────────────────────────

function num(valor: unknown): number {
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : 0
}

/**
 * Las filas de los últimos `dias` días (inclusive) hasta `hoyUtc` (YYYY-MM-DD).
 *
 * Compara cadenas `YYYY-MM-DD`, que ordenan igual que las fechas: sin `Date`
 * por fila y sin depender del huso del servidor. `hoyUtc` entra por parámetro
 * para que las pruebas no dependan del reloj.
 */
export function filtrarUltimosDias<T extends { dia: string }>(
  filas: readonly T[],
  dias: number,
  hoyUtc: string,
): T[] {
  if (!Number.isInteger(dias) || dias <= 0) return []
  const corte = new Date(`${hoyUtc}T00:00:00.000Z`)
  if (Number.isNaN(corte.getTime())) return []
  corte.setUTCDate(corte.getUTCDate() - (dias - 1))
  const desde = corte.toISOString().slice(0, 10)
  return filas.filter((f) => f.dia >= desde && f.dia <= hoyUtc)
}

/**
 * El embudo de UNA ventana, sumando las dos fuentes YA FILTRADAS a esa
 * ventana. El denominador de todas las tasas es `act_registrados` de
 * `admin_metrics_daily` — la misma fuente que los escalones 2..5, para que
 * una tabla no discuta consigo misma. El `act_registrados` de
 * `admin_embudo_daily` existe para que esa tabla se lea sola, pero aquí no
 * se mezcla.
 */
export function embudoDeVentana(
  dias: number,
  filasRollup: readonly FilaRollup[],
  filasEmbudo: readonly FilaEmbudo[],
): EmbudoVentana {
  const embudo: EmbudoVentana = {
    dias,
    registrados: 0,
    onboardingCompleto: 0,
    primeraLectura: 0,
    primeraEscuchaValidada: 0,
    primeraPublicacion: 0,
    vueltaD1Actividad: 0,
    vueltaD1Cota: 0,
  }
  for (const fila of filasRollup) {
    const m = fila.metricas
    embudo.registrados += num(m.act_registrados)
    embudo.onboardingCompleto += num(m.act_onboarding)
    embudo.primeraLectura += num(m.act_primera_lectura)
    embudo.primeraEscuchaValidada += num(m.act_primer_comentario_validado)
    embudo.primeraPublicacion += num(m.act_primera_publicacion)
  }
  for (const fila of filasEmbudo) {
    const m = fila.metricas
    embudo.vueltaD1Actividad += num(m.act_vuelta_d1_actividad)
    embudo.vueltaD1Cota += num(m.act_vuelta_d1_cota)
  }
  return embudo
}

/**
 * Los escalones de la tabla comparada, en el orden del encargo. La vuelta D1
 * se pinta con la cifra de ACTIVIDAD (la conservadora); la cota superior va
 * en la nota de la página, no aquí, para que la tabla no tenga dos filas que
 * midan lo mismo.
 */
export function escalonesDeVentana(embudo: EmbudoVentana): EscalonVentana[] {
  const sobre = (n: number): number => ratio(n, embudo.registrados)
  return [
    { etiquetaKey: CLAVE_ESCALON.registro, personas: embudo.registrados, sobreRegistro: sobre(embudo.registrados) },
    { etiquetaKey: CLAVE_ESCALON.onboarding, personas: embudo.onboardingCompleto, sobreRegistro: sobre(embudo.onboardingCompleto) },
    { etiquetaKey: CLAVE_ESCALON.lectura, personas: embudo.primeraLectura, sobreRegistro: sobre(embudo.primeraLectura) },
    { etiquetaKey: CLAVE_ESCALON.escucha, personas: embudo.primeraEscuchaValidada, sobreRegistro: sobre(embudo.primeraEscuchaValidada) },
    { etiquetaKey: CLAVE_ESCALON.publicacion, personas: embudo.primeraPublicacion, sobreRegistro: sobre(embudo.primeraPublicacion) },
    { etiquetaKey: CLAVE_ESCALON.vueltaD1, personas: embudo.vueltaD1Actividad, sobreRegistro: sobre(embudo.vueltaD1Actividad) },
  ]
}

/** El pilar 1 de una ventana, a partir de filas YA FILTRADAS. */
export function resumenPilar1(dias: number, filasEmbudo: readonly FilaEmbudo[]): ResumenPilar1 {
  let videos = 0
  let personas = 0
  const serie: Array<{ dia: string; videos: number; personas: number }> = []
  for (const fila of filasEmbudo) {
    const v = num(fila.metricas.videos_completados)
    const p = num(fila.metricas.personas_completaron)
    videos += v
    personas += p
    serie.push({ dia: fila.dia, videos: v, personas: p })
  }
  return { dias, videosCompletados: videos, personasCompletaronCota: personas, serie }
}

// ── Acceso a la base ────────────────────────────────────────────────────────

/**
 * Lee la ventana de `admin_embudo_daily`. UNA consulta, espejo exacto de
 * `leerRollup()`: mismo contrato de error opaco (el código, jamás el mensaje
 * de Postgres) y misma tolerancia a filas raras.
 *
 * @param admin cliente `service_role`; la tabla tiene RLS activa y CERO
 *              políticas, ningún otro cliente la ve.
 */
export async function leerEmbudoDiario(
  admin: SupabaseClient,
  ventana: Ventana,
): Promise<FilaEmbudo[]> {
  const { data, error } = await admin.rpc('admin_embudo_ventana', {
    p_desde: aDiaUtc(ventana.desde),
    p_hasta: aDiaUtc(ventana.hasta),
  })

  if (error) throw new Error(`embudo: ${error.code ?? 'error'}`)
  if (!Array.isArray(data)) return []

  return data.map((fila) => {
    const f = fila as { dia: string; metricas: unknown; calculado_en: string }
    return {
      dia: String(f.dia),
      metricas: (typeof f.metricas === 'object' && f.metricas !== null
        ? f.metricas
        : {}) as MetricasEmbudoDia,
      calculadoEn: String(f.calculado_en),
    }
  })
}

// ── Claves de los escalones (el texto vive en el catálogo) ──────────────────

/**
 * Los seis escalones de la tabla comparada, por CLAVE. Numerados en el catálogo
 * como los de `admin.embudo.*` para que las dos tablas de la página se lean
 * como el mismo embudo.
 */
export const CLAVE_ESCALON = {
  registro: 'admin.activacion.escalonRegistro',
  onboarding: 'admin.activacion.escalonOnboarding',
  lectura: 'admin.activacion.escalonLectura',
  escucha: 'admin.activacion.escalonEscucha',
  publicacion: 'admin.activacion.escalonPublicacion',
  vueltaD1: 'admin.activacion.escalonVueltaD1',
} as const
