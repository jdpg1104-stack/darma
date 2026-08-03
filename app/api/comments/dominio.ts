// ============================================================================
// Dominio del hilo — la parte PURA de B04
//
// Aquí vive todo lo que se puede decidir sin base de datos y sin red: la
// proyección de una fila a su forma pública, la lectura del karma realmente
// concedido y la traducción de los errores de Postgres que este bloque sabe
// interpretar.
//
// Está separado de las rutas por una razón muy concreta: son las reglas que
// más caro sale equivocar (qué campos salen, cuánto karma se anuncia) y son
// justo las que un test puede fijar sin levantar nada. Este archivo no importa
// nada en tiempo de ejecución —solo tipos, que el compilador borra—, así que
// `node --test --experimental-strip-types` lo carga tal cual.
// ============================================================================

import type { PerfilPublico } from '@/lib/auth/perfil'
import type { KarmaLevel } from '@/lib/karma'
import type { Disponibilidad } from '@/lib/auth/session'
import type { ComentarioHilo, ResultadoValidacion } from './tipos.ts'

/**
 * Perfil embebido en la consulta del hilo. Son EXACTAMENTE las columnas sobre
 * las que `authenticated` conserva el privilegio de SELECT tras 0001; pedir una
 * más (`karma_spendable`, `shadow_banned`…) devuelve `permission denied for
 * column`, no una fila con un null.
 */
export interface FilaAutor {
  id: string
  alias: string
  avatar_seed: string
  level: KarmaLevel
  karma_reputation: number
  availability: Disponibilidad
}

/** Fila de `comments` con su autor ya unido por PK. Cero N+1. */
export interface FilaComentario {
  id: string
  author_id: string
  body: string
  is_validated: boolean
  is_helpful: boolean
  upvote_count: number
  created_at: string
  /** PostgREST devuelve el embed como objeto (o array si la relación es
   *  ambigua); `normalizarAutor` cubre los dos casos. */
  autor: FilaAutor | FilaAutor[] | null
}

/** El embed de PostgREST llega como objeto o como array de uno. */
export function normalizarAutor(autor: FilaComentario['autor']): FilaAutor | null {
  if (!autor) return null
  return Array.isArray(autor) ? (autor[0] ?? null) : autor
}

/**
 * Proyección de una fila de autor a `PerfilPublico` (CONTRATOS §2).
 *
 * Es una función y no un `select` con las columnas justas por el mismo motivo
 * que `perfilPublicoDesde` de B01: el filtro tiene que poder auditarse de un
 * vistazo, y un campo nuevo del esquema no debe colarse en una respuesta por el
 * simple hecho de existir.
 */
export function perfilDeAutor(fila: FilaAutor): PerfilPublico {
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

/** Autor de reserva cuando el embed no llegó (perfil borrado a media consulta). */
const AUTOR_DESCONOCIDO: PerfilPublico = {
  id: '00000000-0000-0000-0000-000000000000',
  alias: 'Alguien',
  avatarSeed: '0000000000000000',
  nivel: 'semilla',
  karmaReputacion: 0,
  disponibilidad: 'ausente',
  esMentor: false,
}

/**
 * Fila → comentario del hilo.
 *
 * `validado` solo dice la verdad sobre los comentarios PROPIOS. En los ajenos
 * se fuerza a `true` porque la consulta ya filtra a validados o propios: si
 * algún día ese filtro se relajara, este `||` impide que la UI revele que otra
 * persona tiene un comentario pendiente de validar — que es una de las cosas
 * que la ficha prohíbe expresamente que salgan.
 */
export function aComentarioHilo(fila: FilaComentario, userId: string): ComentarioHilo {
  const autor = normalizarAutor(fila.autor)
  const esMio = fila.author_id === userId

  return {
    id: fila.id,
    autor: autor ? perfilDeAutor(autor) : AUTOR_DESCONOCIDO,
    body: fila.body,
    validado: esMio ? fila.is_validated : true,
    esUtil: fila.is_helpful,
    // upvote_count. Un apoyo NO da karma y NO cuenta como escucha: aquí es un
    // número que se pinta, y no entra en ningún cálculo de economía.
    apoyos: fila.upvote_count,
    creadoEn: fila.created_at,
    esMio,
  }
}

// ── Karma realmente concedido ───────────────────────────────────────────────

/**
 * `award_karma()` recorta al llegar al tope diario de 120 y, si el recorte deja
 * la concesión en 0, ni siquiera escribe en el ledger. Por eso el karma se LEE
 * de `karma_events` y no se asume: con `daily_karma_earned = 118`, un
 * comentario validado paga 2, y la respuesta tiene que decir 2.
 *
 * @param filas resultado de consultar `karma_events` por `idempotency_key`.
 *              Cero filas = el tope lo dejó en 0.
 */
export function karmaConcedido(filas: readonly { delta_reputation: number }[] | null): number {
  if (!filas || filas.length === 0) return 0
  return Math.max(0, filas[0]?.delta_reputation ?? 0)
}

// ── Errores de Postgres que este bloque sabe interpretar ────────────────────

/** Código SQL de `unique_violation`. */
export const SQLSTATE_UNIQUE = '23505'

/**
 * ¿El UPDATE de validación chocó con `uq_comments_one_listen_per_post`?
 *
 * Ese índice único parcial `(post_id, author_id) where is_validated` es lo que
 * impide ganar 3 créditos comentando 3 veces el mismo post. Cuando salta NO es
 * un error del sistema: es la regla funcionando. Traducirlo a un 500 le diría a
 * alguien que ha escrito algo bueno que la app está rota.
 *
 * Se mira el `code` y no el mensaje: el texto trae el nombre del índice, y ese
 * nombre le cuenta a quien lo lea la mecánica antifarmeo entera.
 */
export function esEscuchaDuplicada(causa: unknown): boolean {
  if (typeof causa !== 'object' || causa === null) return false
  const codigo = (causa as { code?: unknown }).code
  return String(codigo ?? '') === SQLSTATE_UNIQUE
}

/**
 * Copy de la escucha repetida. Ni «error», ni «duplicado», ni el nombre del
 * índice: la persona ha vuelto a escribirle a alguien a quien ya acompañó, que
 * es algo bueno, y su comentario se publica igual. Lo único que no se repite es
 * el crédito.
 */
export const MENSAJE_ESCUCHA_REPETIDA =
  'Ya habías acompañado a esta persona antes. Tu mensaje se publica igual, ' +
  'pero cada persona cuenta una sola vez como escucha.'

/** Estado de validación cuando la escucha ya estaba contada en este post. */
export function validacionRepetida(): ResultadoValidacion {
  return { estado: 'valido', motivo: MENSAJE_ESCUCHA_REPETIDA }
}
