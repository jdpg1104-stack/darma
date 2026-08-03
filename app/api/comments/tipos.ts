// ============================================================================
// Contrato público de B04 — lo que sale por /api/comments
//
// Copia literal del apartado «Contrato que debes cumplir» de HANDOFF/B04.md.
// Vive aquí y no en un módulo compartido porque `lib/tipos.ts` todavía no
// existe (B01 dejó el mismo pedido abierto para `PerfilPublico`); está anotado
// en HANDOFF/PEDIDOS.md para que B00 lo suba cuando unifique.
//
// ── LO QUE NO ESTÁ EN NINGUNO DE ESTOS TIPOS, Y ES DELIBERADO ──────────────
//   · `quality_score` — es el número con el que se puede aprender a esquivar el
//     filtro. Sale traducido a una frase, nunca como cifra.
//   · `author_id` y `state` — el id de autor solo viaja dentro de `autor.id`
//     (que es el mismo uuid, pero llegando por la puerta del anonimato:
//     PerfilPublico y nada más).
//   · `risk` — el nivel de crisis de un texto es información sobre una persona
//     en su peor momento. Se actúa sobre él (recursos, cola de revisión), no se
//     publica.
//   · el `is_validated` crudo de OTRA persona: `validado` solo se pinta cuando
//     es true o cuando el comentario es tuyo. Ver `GET /api/comments`.
// ============================================================================

import type { PerfilPublico } from '@/lib/auth/perfil'
import type { HelpResource, RiskLevel } from '@/lib/crisis'

/** Cuerpo de `POST /api/comments`. Validado con zod `.strict()`. */
export interface CrearComentarioBody {
  postId: string
  /** 40–4000 caracteres. El 40 es el `CHECK` de 0001 y es producto: un
   *  comentario de 20 caracteres no acompaña a nadie. */
  body: string
}

/** Un comentario tal y como lo ve el hilo. */
export interface ComentarioHilo {
  id: string
  autor: PerfilPublico
  body: string
  validado: boolean
  /** Marcado «me ayudó» por el autor del post. */
  esUtil: boolean
  /** upvote_count — NO da karma y NO cuenta como escucha. */
  apoyos: number
  /** ISO-8601 */
  creadoEn: string
  esMio: boolean
}

/**
 * Tarjeta de recursos de crisis.
 *
 * Se devuelve EN LA MISMA RESPUESTA que provoca la detección (CONTRATOS §9):
 * ni en un email diferido, ni en la siguiente pantalla. La persona que acaba de
 * escribir eso está mirando esta pantalla ahora.
 */
export interface TarjetaRecursosDatos {
  /** Copy de `crisisMessage()`. Nunca dice «hemos detectado». */
  mensaje: string
  recursos: readonly HelpResource[]
  /** Solo para que la UI decida el énfasis. No se muestra como etiqueta. */
  nivel: Extract<RiskLevel, 'high' | 'critical'>
}

/** Resultado de la validación de calidad, ya resuelto de forma SÍNCRONA. */
export interface ResultadoValidacion {
  estado: 'valido' | 'no_valido'
  /** Motivo en lenguaje humano, o `null`. Nunca el score ni el id de la señal. */
  motivo: string | null
}

/** Respuesta de `POST /api/comments` (201). */
export interface RespuestaComentar {
  comentario: ComentarioHilo
  validacion: ResultadoValidacion
  /** Crédito de escucha ganado con este comentario (0 o 1). */
  creditoGanado: number
  /**
   * Karma REALMENTE otorgado. Se lee del ledger, no se asume 10: el tope diario
   * de `award_karma()` puede haberlo recortado, y prometer un número y pagar
   * otro es el bug que más rápido destruye la confianza en una economía.
   */
  karmaGanado: number
  /** No null ⇒ pinta la tarjeta de recursos en esta misma pantalla. */
  recursos: TarjetaRecursosDatos | null
}

/** Respuesta de `POST /api/comments/[id]/util`. */
export interface RespuestaUtil {
  comentarioId: string
  /** Lo que cobró QUIEN ESCUCHÓ (no el autor del post). Puede ser < 15. */
  karmaOtorgado: number
}

/** Página keyset. Espejo de `PaginaCursor<T>` de CONTRATOS §5. */
export interface PaginaCursor<T> {
  items: T[]
  /** Opaco (base64url). `null` cuando no hay más. No lo interpretes en cliente. */
  siguienteCursor: string | null
}

// ── El punto de extensión de B11 ────────────────────────────────────────────

/**
 * Contexto opcional del comentario. Existe porque dos de las señales reales de
 * `lib/moderation.ts` —copiar el post y repetirse a uno mismo— no se pueden
 * calcular mirando solo el texto.
 *
 * Es OPCIONAL a propósito: una implementación con la firma exacta del contrato
 * (`validar(texto: string)`) sigue siendo asignable a `ValidadorComentario`, así
 * que B11 puede enchufar su clasificador sin conocer este tipo.
 */
export interface ContextoValidacion {
  /** Cuerpo del post al que responde, para detectar el eco. */
  postBody?: string
  /** Comentarios anteriores del mismo autor, para detectar plantillas. */
  previosDelAutor?: readonly string[]
}

export interface VeredictoValidacion {
  valido: boolean
  /** [0, 1]. Va a `comments.quality_score` (numeric(4,3)) y NO sale por la API. */
  score: number
  /** Motivo en lenguaje humano, o `null` si es válido. */
  motivo: string | null
}

/**
 * Interfaz que B11 sustituirá. NO la cambies cuando llegue su clasificador:
 * la implementación por defecto (`ValidadorHeuristico`) se cambia por la suya
 * en `validador.ts` y ninguna ruta se toca.
 */
export interface ValidadorComentario {
  validar(texto: string, contexto?: ContextoValidacion): Promise<VeredictoValidacion>
}
