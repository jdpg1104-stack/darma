// ============================================================================
// Proyecciones — de fila de Postgres a forma de API. Funciones PURAS.
//
// POR QUÉ FUNCIONES Y NO UN `select` CON LAS COLUMNAS JUSTAS:
// las dos cosas hacen falta, pero solo una se puede auditar de un vistazo. El
// `select` deja el filtro repartido por cada ruta que consulta; aquí se ve, en
// un archivo, que no hay ningún camino por el que un campo nuevo del esquema se
// cuele en una respuesta por el mero hecho de existir. Además son testeables sin
// base de datos, que es lo que permite tener una prueba que recorre el JSON
// serializado del perfil ajeno buscando literalmente `karma_spendable`.
// ============================================================================

import {
  DAILY_KARMA_CAP,
  KARMA_WEIGHTS,
  levelLabel,
  progressToNextLevel,
  type KarmaKind,
} from '../../lib/karma.ts'
import { insigniasPublicas } from './insignias.ts'
import type {
  CambiosPerfil,
  DesgloseKarma,
  EditarPerfilInput,
  EventoKarma,
  FilaEventoKarma,
  FilaPerfilPublica,
  FilaResumenKarma,
  PerfilAjeno,
  PerfilPublico,
  ResumenKarma,
} from './tipos.ts'

/** ¿Es una clase de karma que conocemos? El ledger tiene FK a `karma_weights`,
 *  así que en la práctica siempre lo es; la guarda protege del día en que
 *  alguien añada una fila a esa tabla y todavía no esté en `lib/karma.ts`. Ese
 *  evento se OMITE del desglose en vez de romper la pantalla entera. */
export function esKarmaKind(valor: string): valor is KarmaKind {
  return Object.prototype.hasOwnProperty.call(KARMA_WEIGHTS, valor)
}

/** Fila pública de `profiles` → `PerfilPublico` de CONTRATOS §2. */
export function perfilPublicoDesdeFila(fila: FilaPerfilPublica): PerfilPublico {
  return {
    id: fila.id,
    alias: fila.alias,
    avatarSeed: fila.avatar_seed,
    nivel: fila.level,
    karmaReputacion: fila.karma_reputation,
    disponibilidad: fila.availability,
    esMentor: fila.level === 'mentor',
  }
}

/**
 * Perfil de otra persona. UNA consulta, y de ella salen estos campos y ninguno
 * más.
 *
 * `bio`, `created_at` y `last_seen_at` llegan en la fila (son legibles por
 * privilegio) y se DESCARTAN aquí a propósito. `last_seen_at` es el que
 * importa: con precisión de minuto es el dato que permite correlacionar dos
 * cuentas anónimas de la misma persona por su patrón de conexión, y en una app
 * donde el anonimato es la promesa central eso pesa más que "saber si está
 * activo".
 */
export function perfilAjenoDesdeFila(fila: FilaPerfilPublica): PerfilAjeno {
  return {
    perfil: perfilPublicoDesdeFila(fila),
    insignias: insigniasPublicas(fila.karma_reputation),
  }
}

/**
 * Una fila del ledger → una línea del historial.
 *
 * La descripción se resuelve con `KARMA_WEIGHTS[kind].description` EN
 * TypeScript. Nada de un `join` a `karma_weights` por fila: son seis filas
 * constantes que ya están importadas, y el join sería un N+1 con buena
 * presencia. El `id` bigint no aparece en la salida: va solo dentro del cursor.
 */
export function eventoKarmaDesdeFila(fila: FilaEventoKarma): EventoKarma | null {
  if (!esKarmaKind(fila.kind)) return null

  return {
    kind: fila.kind,
    deltaReputacion: fila.delta_reputation,
    deltaGastable: fila.delta_spendable,
    descripcion: KARMA_WEIGHTS[fila.kind].description,
    refTipo: fila.ref_type,
    refId: fila.ref_id,
    ocurridoEn: fila.created_at,
  }
}

/** El `desglose_30d` llega como `jsonb`. Se valida elemento a elemento: es un
 *  `unknown` de la base de datos y tratarlo como si tuviera forma es cómo un
 *  cambio de esquema se convierte en un `undefined is not a function`. */
export function desgloseDesdeJsonb(bruto: unknown): DesgloseKarma[] {
  if (!Array.isArray(bruto)) return []

  const salida: DesgloseKarma[] = []
  for (const item of bruto) {
    if (typeof item !== 'object' || item === null) continue
    const { kind, total, veces } = item as { kind?: unknown; total?: unknown; veces?: unknown }
    if (typeof kind !== 'string' || !esKarmaKind(kind)) continue
    if (typeof total !== 'number' || typeof veces !== 'number') continue

    salida.push({ kind, total, veces, descripcion: KARMA_WEIGHTS[kind].description })
  }

  // Orden estable por aportación descendente: quien mira su desglose quiere
  // saber de dónde viene su karma, no en qué orden lo agrupó Postgres.
  return salida.sort((a, b) => b.total - a.total || a.kind.localeCompare(b.kind))
}

/**
 * Fila de `mi_resumen_karma()` → `ResumenKarma`.
 *
 * `progreso` sale TAL CUAL de `progressToNextLevel()`. No se recalcula ningún
 * ratio: con 2 400 de karma la barra debe marcar 400/3 000 = 13 %, no
 * 2 400/5 000 = 48 %, y esa cuenta ya está hecha —y explicada— en lib/karma.ts.
 *
 * @param hoyISO fecha de hoy en formato `YYYY-MM-DD`, inyectable para tests.
 *               Se compara contra `streak_last_date`, que Postgres devuelve en
 *               ese mismo formato y en la zona del servidor: comparar cadenas
 *               evita que `new Date('2026-08-03')` se interprete como UTC y que
 *               la racha parezca inactiva durante las primeras horas del día.
 */
export function resumenDesdeFila(fila: FilaResumenKarma, hoyISO: string): ResumenKarma {
  const progreso = progressToNextLevel(fila.reputacion)
  const ganado = Math.max(0, fila.ganado_hoy)

  return {
    nivel: progreso.level,
    etiquetaNivel: levelLabel(progreso.level),
    reputacion: fila.reputacion,
    progreso,
    hoy: {
      ganado,
      tope: DAILY_KARMA_CAP,
      restante: Math.max(0, DAILY_KARMA_CAP - ganado),
    },
    racha: {
      dias: fila.streak_days,
      activaHoy: fila.streak_last_date === hoyISO,
    },
    desglose30d: desgloseDesdeJsonb(fila.desglose_30d),
  }
}

/** `YYYY-MM-DD` de hoy en la zona horaria local del servidor. */
export function fechaHoyISO(ahora: Date = new Date()): string {
  const y = ahora.getFullYear()
  const m = String(ahora.getMonth() + 1).padStart(2, '0')
  const d = String(ahora.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Entrada validada del formulario → objeto del `UPDATE`.
 *
 * Vive aquí, y no en el archivo `'use server'` de la acción, por dos razones:
 * en un módulo de Server Actions TODA exportación se publica como endpoint
 * invocable —y esto no tiene por qué serlo—, y desde aquí se puede probar sin
 * el runtime de Next. El test que importa es el que afirma que de esta función
 * no sale nunca `karma_reputation` ni `crystals`, entren como entren.
 */
export function cambiosPerfilDesdeEntrada(entrada: EditarPerfilInput): CambiosPerfil {
  const cambios: CambiosPerfil = {}

  if (entrada.alias !== undefined) cambios.alias = entrada.alias
  if (entrada.avatarSeed !== undefined) cambios.avatar_seed = entrada.avatarSeed
  // Una bio vacía se guarda como NULL, no como ''. La columna admite null y su
  // CHECK es solo de longitud; dejar '' obligaría a que cada lectura tratase
  // los dos casos como "sin bio", y tarde o temprano una de ellas se olvidaría.
  if (entrada.bio !== undefined) cambios.bio = entrada.bio.length > 0 ? entrada.bio : null
  if (entrada.disponibilidad !== undefined) cambios.availability = entrada.disponibilidad

  return cambios
}

/** Cuántos «me ayudó» hay en el desglose. Alimenta la insignia `corazon_util`
 *  SIN una consulta nueva: es el mismo agregado que ya pinta el resumen. */
export function vecesMeAyudo(desglose: DesgloseKarma[]): number {
  return desglose.find((d) => d.kind === 'marked_helpful')?.veces ?? 0
}
