// ============================================================================
// Reciprocidad 3:1 — la regla que define Darma
//
// Escuchar a 3 personas desbloquea 1 publicación propia.
//
// ⚠️ ESTO NO ES EL GATE. El gate REAL es el trigger BEFORE INSERT
// `trg_posts_reciprocity` sobre public.posts (ver 0001_core.sql), que descuenta
// el crédito con un `UPDATE ... WHERE ... RETURNING`: si no hay crédito, la
// fila no llega a escribirse, y dos peticiones simultáneas no pueden gastar el
// mismo crédito porque el UPDATE toma el lock.
//
// Este módulo solo pinta la UI. VIVE AQUÍ PORQUE LA UI NO ES LA AUTORIDAD:
// cualquier persona con la anon key (que está en el bundle, por diseño) puede
// hablar con PostgREST directamente y saltarse todo lo que este archivo diga.
// Si alguna vez lees código de Darma que confía en `canPublish()` para DECIDIR
// si una publicación es legítima, eso es un bug de seguridad: la decisión la
// toma Postgres y esta función solo la ANTICIPA para poder mostrar el estado
// correcto sin esperar a un error del servidor.
//
// La consecuencia práctica es que este módulo puede equivocarse (saldo leído
// hace 3 segundos, otra pestaña publicando en paralelo) y eso es aceptable: el
// peor caso es enseñar un botón habilitado que el servidor rechaza. El caso
// contrario —el servidor acepta algo que la UI creía bloqueado— también es
// inofensivo. Lo único inaceptable sería que la UI fuera la única barrera.
//
// POR QUÉ 3:1 Y NO 1:1: con 1:1 la red sigue siendo un lugar donde se habla
// tanto como se escucha, y en apoyo emocional eso no basta — quien está mal
// necesita varias voces, no una. 3:1 garantiza estructuralmente que haya
// superávit de escucha. Y el primer post es GRATIS porque exigir escuchar antes
// de haber usado nunca la app deja a todo el mundo fuera en el minuto uno
// (ver la rama `posts_published = 0` del trigger).
// ============================================================================

/** Créditos de escucha que cuesta una publicación. */
export const LISTENS_PER_POST = 3

/**
 * Estado del perfil relevante para el gate. Espejo parcial de public.profiles;
 * son exactamente las columnas que mira `posts_consume_credit()`.
 *
 * DE DÓNDE SALEN ESTOS DATOS: de la RPC `mi_perfil_privado()`, NO de un select
 * sobre `profiles`. `authenticated` ya no tiene privilegio de SELECT sobre
 * listen_credits, posts_published ni banned_until (son campos privados: ver el
 * bloque de privilegios de columna en 0001_core.sql), así que no hay consulta
 * directa que los devuelva, ni siquiera sobre tu propia fila. La RPC filtra por
 * auth.uid() y es la única puerta.
 */
export interface ReciprocityState {
  /** profiles.listen_credits — escuchas validadas aún no canjeadas. */
  listenCredits: number
  /** profiles.posts_published — si es 0, el primer post es gratis. */
  postsPublished: number
  /** profiles.banned_until (ISO) o null. El trigger también lo comprueba. */
  bannedUntil?: string | null
}

/** Motivo por el que la UI bloquea el botón de publicar. */
export type BlockReason = 'need_listens' | 'banned'

export interface CanPublishResult {
  /** ¿La UI debe permitir intentarlo? (El servidor decide de verdad.) */
  allowed: boolean
  /** Motivo del bloqueo. `null` si está permitido. */
  reason: BlockReason | null
  /** Créditos que faltan (0 si no faltan). */
  creditsNeeded: number
  /** ¿Es el primer post, que va gratis? */
  isFirstPost: boolean
}

/**
 * ¿Puede esta persona publicar según lo que sabemos AHORA?
 *
 * Espejo del `WHERE` del UPDATE de posts_consume_credit():
 *   (posts_published = 0 or listen_credits >= 3) and not (banned_until > now())
 */
export function canPublish(state: ReciprocityState, now: Date = new Date()): CanPublishResult {
  const isFirstPost = state.postsPublished === 0

  if (state.bannedUntil) {
    const until = new Date(state.bannedUntil).getTime()
    // Una fecha corrupta se trata como baneo vigente: ante la duda, el lado
    // seguro es el restrictivo — y el servidor dará la respuesta definitiva.
    if (!Number.isFinite(until) || until > now.getTime()) {
      return { allowed: false, reason: 'banned', creditsNeeded: 0, isFirstPost }
    }
  }

  if (isFirstPost) {
    return { allowed: true, reason: null, creditsNeeded: 0, isFirstPost: true }
  }

  const needed = creditsNeeded(state)
  return {
    allowed: needed === 0,
    reason: needed === 0 ? null : 'need_listens',
    creditsNeeded: needed,
    isFirstPost: false,
  }
}

/**
 * Créditos que faltan para poder publicar. 0 si ya se puede (o si es el primer
 * post). No mira el baneo: eso es un bloqueo de otra naturaleza y mezclarlos
 * llevaría a decirle a alguien baneado "te faltan 3 escuchas", que es mentira.
 */
export function creditsNeeded(state: ReciprocityState): number {
  if (state.postsPublished === 0) return 0
  return Math.max(0, LISTENS_PER_POST - Math.max(0, state.listenCredits))
}

/**
 * Alias semántico de `creditsNeeded` para las superficies que hablan de
 * personas y no de fichas: "te faltan 2 personas por escuchar".
 *
 * Un crédito = una persona escuchada, no un comentario escrito: el índice único
 * `uq_comments_one_listen_per_post` impide ganar 3 créditos comentando 3 veces
 * el mismo post, así que la equivalencia se sostiene y el mensaje no engaña.
 */
export function listensRemaining(state: ReciprocityState): number {
  return creditsNeeded(state)
}

/**
 * Mensaje que ve la persona.
 *
 * El tono es una decisión de producto, no un detalle: quien llega aquí muchas
 * veces está mal y quiere desahogarse YA. Un "acceso denegado" en ese momento
 * es un portazo. Así que el copy (a) nunca culpa, (b) explica el porqué en una
 * frase, (c) dice exactamente cuánto falta y (d) ofrece la acción siguiente.
 *
 * Descartado: "Necesitas 3 créditos para publicar". Convierte el acto de
 * acompañar a alguien en una moneda y hace que la escucha se sienta como un
 * peaje. La palabra "crédito" no debe aparecer nunca de cara al usuario.
 */
export function reciprocityMessage(state: ReciprocityState, now: Date = new Date()): string {
  const result = canPublish(state, now)

  if (result.reason === 'banned') {
    return 'Tu cuenta está en pausa temporalmente. Mientras tanto puedes seguir leyendo y cuidándote.'
  }

  if (result.isFirstPost) {
    return 'Tu primera vez va sin condiciones. Cuéntanos qué te pasa.'
  }

  if (result.allowed) {
    return 'Has escuchado a tres personas. Ahora es tu turno: te leemos.'
  }

  const faltan = result.creditsNeeded
  return faltan === 1
    ? 'Te queda una persona por acompañar y podrás publicar. Aquí nadie habla sin haber escuchado.'
    : `Te quedan ${faltan} personas por acompañar y podrás publicar. Aquí nadie habla sin haber escuchado.`
}

/**
 * Mensaje para cuando el SERVIDOR rechaza la publicación (el trigger lanzó
 * `check_violation`). Se separa del anterior a propósito: llegar aquí significa
 * que la UI y la base discrepaban, así que el copy asume que la persona ya
 * había escrito su texto y lo primero es tranquilizarla sobre eso.
 */
export const RECIPROCITY_SERVER_REJECTION =
  'No hemos podido publicarlo todavía: te falta acompañar a alguien más. ' +
  'Tu texto sigue aquí, no se ha perdido.'
