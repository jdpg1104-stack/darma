// ============================================================================
// Contrato público de las encuestas (ficha B09, §Contrato que debes cumplir).
//
// LA REGLA DE ESTE ARCHIVO: lo que no está declarado aquí NO SALE de la API.
// El tipo es la barrera, no una sugerencia — por eso la proyección de la fila
// de Postgres a `EncuestaFeed` se hace campo a campo en `resultados.ts` y nunca
// con un spread, que dejaría entrar cualquier columna nueva del esquema por el
// mero hecho de existir.
//
// Lo que se queda dentro del servidor, y por qué:
//   · `author_id`  — quién preguntó no forma parte de responder. Y para las
//                    encuestas del banco es el perfil de sistema, que no es
//                    una persona.
//   · `min_reveal` — publicarlo diría "faltan 2 votos para ver los resultados",
//                    que es una invitación a traer dos cuentas y observar el
//                    salto. Sale `revelado`, ya resuelto.
//   · `state`, `bank_key`, `language` — mecánica interna de rotación.
//   · CUALQUIER dato de `poll_votes` que no sea el voto PROPIO. Ni un
//     identificador de votante, ni un `created_at` ajeno: con pocos votantes,
//     la marca de tiempo cruzada con la actividad del feed identifica a la
//     persona.
// ============================================================================

export interface OpcionEncuesta {
  id: string
  ordinal: number
  label: string
  /** null mientras `revelado` sea false. */
  votos: number | null
  /** 0–100, redondeado. null mientras `revelado` sea false. */
  porcentaje: number | null
}

export interface EncuestaFeed {
  id: string
  pregunta: string
  opciones: OpcionEncuesta[]
  totalVotos: number
  /** ¿Se alcanzó el mínimo para publicar el agregado? */
  revelado: boolean
  /** La opción que eligió ESTA persona, o null si aún no votó. */
  miVoto: string | null
  cierraEn: string | null
  origen: OrigenEncuesta
}

export type OrigenEncuesta = 'usuario' | 'banco'

// ── Formas de fila que devuelve Postgres ────────────────────────────────────
// Se declaran a mano y no se derivan de `Database` (CONTRATOS §3) porque
// `lib/supabase/database.types.ts` se genera contra el esquema y todavía no
// contiene las funciones de `0109_1_b09_encuestas.sql`. En cuanto B15 lo
// regenere, se sustituyen por
// `Database['public']['Functions']['encuesta_resultados']['Returns']`.
// Anotado en HANDOFF/PEDIDOS.md.

/** Una opción tal y como la devuelven `encuesta_siguiente()` / `encuesta_resultados()`. */
export interface FilaOpcion {
  id: string
  ordinal: number
  label: string
  /**
   * `null` cuando Postgres ha decidido que el agregado todavía no se publica.
   * La decisión se toma DENTRO del motor: esta propiedad ya llega censurada,
   * no se censura aquí (ver la cabecera de `resultados.ts`).
   */
  vote_count: number | null
}

/** El `jsonb` de `encuesta_siguiente()` y `encuesta_resultados()`. */
export interface FilaEncuesta {
  id: string
  question: string
  total_votes: number
  min_reveal: number
  closes_at: string | null
  origin: OrigenEncuesta
  mi_voto: string | null
  options: FilaOpcion[]
}

/** La fila de `poll_cadence`, tal cual, para construir las señales. */
export interface FilaCadencia {
  last_shown_at: string | null
  shown_today: number
  /** `date` de Postgres, en formato `YYYY-MM-DD`. */
  day: string
}

/** Resultado de `reponer_encuestas()`. */
export interface ResultadoReposicion {
  activadas: number
  cerradas: number
}
