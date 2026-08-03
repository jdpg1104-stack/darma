// ============================================================================
// Contrato público del feed (ficha B02, §Contrato que debes cumplir)
//
// LA REGLA DE ESTE ARCHIVO: lo que no está declarado aquí NO SALE de la API.
// El tipo es la barrera, no una sugerencia — por eso el mapeo de una fila de
// Postgres a un `PostFeed` se hace campo a campo en `consulta.ts` y nunca con un
// spread de la fila, que dejaría entrar cualquier columna nueva del esquema por
// el mero hecho de existir.
//
// Lo que se queda dentro del servidor, y por qué:
//   · `hot_score`  — publicarlo es publicar la fórmula del ranking; el primero
//                    que lo lea la ingenieriza en reversa y empieza a farmear.
//   · `boost_until`— lo que sale es `impulsado`, ya resuelto por
//                    `isBoostEligible()`. La fecha cruda invita a que la UI
//                    reimplemente la condición y se olvide de la regla de crisis.
//   · `risk`       — sale como `enRiesgo`, y SOLO para poner un pie discreto con
//                    los recursos de ayuda. El nivel exacto etiquetaría a una
//                    persona vulnerable delante de la comunidad (CONTRATOS §9).
//   · `state`, `shadow_banned` — mecánica de moderación. Si el usuario supiera
//                    que está silenciado, se crearía otra cuenta.
//   · `author_id`  — no como campo suelto. La identidad pública de alguien es
//                    `autor: PerfilPublico`, y ahí `id` existe para enlazar.
// ============================================================================

import type { PerfilPublico } from '../../../lib/auth/perfil.ts'

/**
 * Carriles del feed.
 *
 * `para_ti` ordena por `hot_score` (idx_posts_hot) y `nuevo` por `created_at`
 * (idx_posts_new). Es un enum CERRADO y validado con zod: cada valor nuevo es un
 * índice nuevo que alguien tiene que crear, así que aceptar un carril arbitrario
 * del cliente sería aceptar un seq scan a petición.
 */
export type Carril = 'para_ti' | 'nuevo'

export const CARRILES: readonly Carril[] = ['para_ti', 'nuevo']

/** Tipos de post, espejo del enum `public.post_kind`. */
export type TipoPost = 'desahogo' | 'pregunta' | 'gratitud'

/** Un post de la comunidad tal y como lo ve quien lee el feed. */
export interface PostFeed {
  id: string
  /** CONTRATOS §2. Ni un campo más que los siete de `PerfilPublico`. */
  autor: PerfilPublico
  kind: TipoPost
  body: string
  topic: string | null
  upvotes: number
  /** = `posts.reply_count`, que el trigger solo incrementa con escuchas VALIDADAS. */
  respuestas: number
  /** Resultado de `isBoostEligible()`, nunca `boost_until` crudo. */
  impulsado: boolean
  /** `risk` alto o crítico → la tarjeta añade un pie con recursos de ayuda. */
  enRiesgo: boolean
  /** ISO-8601. */
  creadoEn: string
  heVotado: boolean
}

/** Una pieza de contenido curado de bienestar. */
export interface ContenidoFeed {
  id: string
  titulo: string
  resumen: string | null
  url: string
  miniatura: string | null
  plataforma: string
  duracionSegundos: number | null
}

/**
 * Un elemento del feed.
 *
 * La encuesta viaja como un id pelado a propósito: la tarjeta la pinta B09 y
 * traer aquí la pregunta y las opciones serían dos consultas más por página para
 * alimentar un componente que todavía no existe. El hueco y el tipo están; el
 * relleno es de otro bloque.
 */
export type ElementoFeed =
  | { tipo: 'post'; post: PostFeed }
  | { tipo: 'contenido'; contenido: ContenidoFeed }
  | { tipo: 'encuesta'; encuestaId: string }

/**
 * Página con cursor opaco (CONTRATOS §5).
 *
 * `siguienteCursor` es `null` cuando no hay más. NUNCA se acompaña de un total:
 * un `count(*)` sobre `posts` con un millón de filas es un seq scan en cada
 * scroll, y nadie necesita saber cuántos posts hay en el mundo.
 */
export interface PaginaCursor<T> {
  items: T[]
  /** Opaco. El cliente lo devuelve tal cual; no lo interpreta jamás. */
  siguienteCursor: string | null
}

/** Respuesta de `GET /api/feed`. */
export type PaginaFeed = PaginaCursor<ElementoFeed>
