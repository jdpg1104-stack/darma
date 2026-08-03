// ============================================================================
// Contrato de /api/posts — lo único que comparten la ruta y el composer
//
// Vive en `components/composer/` y no en `app/api/posts/` porque un componente
// cliente NO puede importar nada de una ruta de API: arrastraría al bundle del
// navegador la cadena de imports del servidor (lib/supabase/admin.ts incluido).
// El tipo va donde puede leerlo el lado que menos privilegios tiene.
//
// REGLA QUE ESTE ARCHIVO HACE CUMPLIR POR TIPOS: `risk`, `hot_score`, `state` y
// `author_id` no aparecen en ninguna forma de respuesta. Lo que no está en el
// tipo no se puede filtrar por descuido. La persona ve recursos de ayuda, nunca
// una etiqueta de riesgo colgada de ella.
// ============================================================================

import type { TemaDarma, TipoPost } from './temas.ts'

/** Cuerpo de `POST /api/posts`. Nada más. En particular, NO hay `authorId`:
 *  el autor sale siempre de la sesión (CONTRATOS §6). */
export interface CrearPostBody {
  /** 20–5000 caracteres, igual que el CHECK de posts.body. */
  body: string
  kind: TipoPost
  topic: TemaDarma
}

/** Cuerpo de `PATCH /api/posts/[id]`. `authenticated` solo tiene concedido
 *  `update (body, topic, state)`, así que no hay nada más que editar. */
export interface EditarPostBody {
  body: string
  topic: TemaDarma
}

export interface PostCreado {
  id: string
  kind: TipoPost
  body: string
  topic: string | null
  /** ISO-8601. Siempre UTC; nunca una fecha local. */
  creadoEn: string
}

/** Una línea de ayuda concreta. `telefono` y `url` son opcionales porque hay
 *  países donde solo existe un directorio y no un número marcable. */
export interface LineaDeAyuda {
  nombre: string
  telefono?: string
  url?: string
  horario?: string
}

export interface TarjetaRecursosDatos {
  titulo: string
  mensaje: string
  lineas: LineaDeAyuda[]
  accionInmediata: { etiqueta: string; href: string }
}

export interface RespuestaPublicar {
  post: PostCreado
  /**
   * No `null` ⇒ píntalo YA, en esta misma pantalla.
   *
   * Viaja en el mismo JSON que confirma la publicación y no en «la siguiente
   * pantalla» porque CONTRATOS §9.1 lo exige: los recursos se muestran en la
   * misma respuesta, sin navegación intermedia y sin correo diferido. Que el
   * campo esté aquí y no en un endpoint aparte es lo que hace imposible
   * implementarlo mal sin darse cuenta.
   */
  recursos: TarjetaRecursosDatos | null
}

/** Respuesta de `PATCH`. Misma forma: editar puede revelar riesgo nuevo. */
export type RespuestaEditar = RespuestaPublicar

export interface RespuestaVoto {
  /** Estado del voto DESPUÉS de la operación. El contador no viaja: lo mantiene
   *  `trg_post_votes_sync` y leerlo aquí obligaría a una consulta de más. */
  votado: boolean
}
