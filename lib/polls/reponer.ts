// ============================================================================
// Reposición del banco — el ÚNICO punto de B09 que usa `service_role`.
//
// ── POR QUÉ HACE FALTA EL CLIENTE ADMIN AQUÍ Y SOLO AQUÍ ────────────────────
// `polls_insert_own` exige `author_id = auth.uid()`, y el cron no tiene sesión:
// `auth.uid()` es NULL. Con el cliente RLS la inserción no falla con un error
// obvio — falla con CERO FILAS y un `ok`, que es la peor forma de fallar
// (trampa nº 4 de la ficha B09). Las encuestas del banco las firma el perfil de
// sistema `Darma`, y escribir en nombre de otro es exactamente lo que RLS
// impide y lo que `service_role` puede.
//
// La cautela que compensa el privilegio: este módulo NO hace consultas. Llama a
// `reponer_encuestas()`, una función `security definer` cuyo `execute` está
// concedido SOLO a `service_role`, y que es la que contiene toda la lógica.
// Así el cliente admin no toca ni una tabla directamente y la superficie que
// salta RLS cabe en una línea.
//
// ── POR QUÉ LA LÓGICA ESTÁ EN SQL Y NO AQUÍ ────────────────────────────────
//  1. Atomicidad: cerrar las gastadas y activar las nuevas en la misma
//     transacción evita el hueco en el que el feed se queda sin encuestas.
//  2. Carrera: dos disparos simultáneos chocan en `uq_polls_bank_key` y el
//     segundo no duplica nada. Con la lógica repartida entre app y base, la
//     ventana entre el `select` y el `insert` la abre la propia app.
//
// Banco agotado ⇒ `{ activadas: 0 }` SIN error. Un cron que falla por quedarse
// sin preguntas es un cron que alguien acaba silenciando, y entonces tampoco
// avisa el día que falla de verdad.
// ============================================================================

import { createAdminClient } from '../supabase/admin.ts'
import { ErrorApi } from '../auth/errores.ts'
import type { ResultadoReposicion } from './tipos.ts'

/** Idiomas con banco propio. Cerrado a propósito: cada uno es un pool nuevo. */
export const IDIOMAS_BANCO = ['es', 'en'] as const
export type IdiomaBanco = (typeof IDIOMAS_BANCO)[number]

/** Mínimo de encuestas activas por idioma. */
export const MINIMO_ACTIVAS = 3
/** Edad máxima de una encuesta del banco antes de rotarla. */
export const MAX_DIAS_ACTIVA = 14

export interface OpcionesReposicion {
  idiomas?: readonly string[]
  minimo?: number
  maxDias?: number
}

/**
 * Repone el banco en todos los idiomas y devuelve el total.
 *
 * Por idioma y no de una vez porque el pool es por idioma: un banco español
 * lleno no impide que el feed en inglés se quede vacío, y una sola llamada
 * global no podría distinguirlo.
 */
export async function reponerBanco(
  opciones: OpcionesReposicion = {},
): Promise<ResultadoReposicion> {
  const idiomas = opciones.idiomas ?? IDIOMAS_BANCO
  const admin = createAdminClient()

  let activadas = 0
  let cerradas = 0

  for (const idioma of idiomas) {
    const { data, error } = await admin.rpc('reponer_encuestas', {
      p_idioma: idioma,
      p_minimo: opciones.minimo ?? MINIMO_ACTIVAS,
      p_max_dias: opciones.maxDias ?? MAX_DIAS_ACTIVA,
    })

    if (error) {
      throw new ErrorApi('error_interno', { causa: error })
    }

    const parcial = normalizar(data)
    activadas += parcial.activadas
    cerradas += parcial.cerradas
  }

  return { activadas, cerradas }
}

/**
 * El `jsonb` llega como `unknown`. Se normaliza en vez de castear: un cambio en
 * la función SQL debe producir ceros, no un `NaN` en un contador de operación.
 */
export function normalizar(valor: unknown): ResultadoReposicion {
  if (typeof valor !== 'object' || valor === null) return { activadas: 0, cerradas: 0 }
  const v = valor as Record<string, unknown>
  return {
    activadas: entero(v.activadas),
    cerradas: entero(v.cerradas),
  }
}

function entero(valor: unknown): number {
  return typeof valor === 'number' && Number.isFinite(valor) ? Math.trunc(valor) : 0
}
