// ============================================================================
// Darma · suite de RLS con la ANON KEY en la mano
//
// Esto no es un test de aplicación: es un intento de ataque. Cada caso se
// ejecuta con la `anon key` (la que va en el bundle, la que cualquiera puede
// leer con las devtools abiertas) y una sesión de USUARIO B, contra datos que
// pertenecen a USUARIO A. La aserción es siempre la misma y siempre al revés de
// lo habitual:
//
//     si el ataque NO falla, el test falla.
//
// POR QUÉ NUNCA `service_role`: esa llave salta todas las políticas por diseño.
// Un test que pase usando service_role no prueba absolutamente nada. El runner
// (`scripts/security/ejecutarRls.ts`) aborta antes de ejecutar un solo caso si
// detecta `role: service_role` en el payload del JWT configurado.
//
// POSITIVO DE CONTROL — lo más importante de todo el archivo. Un test de
// seguridad que pasa porque la consulta estaba mal escrita (tabla mal
// deletreada, sesión que no se abrió, filtro que no coincide con nada) es PEOR
// que no tener test: genera confianza falsa. Por eso los casos críticos traen
// `controlServiceRole`: el MISMO ataque, ejecutado con la llave que sí puede,
// tiene que FUNCIONAR. Si falla en los dos casos, el caso está mal escrito.
//
// ── OJO CON LO QUE SE ASERTA ────────────────────────────────────────────────
// · `profiles.level` es una columna generada `stored`: escribirla da «cannot
//   insert into generated column», que es un error DISTINTO al de permiso. La
//   aserción correcta es «no se pudo escribir», nunca «error 42501».
// · Un refugio ajeno devuelve CERO FILAS SIN ERROR. Si devolviera «permiso
//   denegado», un acosador podría distinguir «esta sala no existe» de «existe y
//   no estoy dentro» — que es justo lo que necesita para saber que su víctima
//   sigue en la app. Esa diferencia se testea explícitamente.
// · El shadow-ban se comprueba SIEMPRE desde el usuario B. La política
//   `posts_read` deja al autor ver sus propios posts aunque esté silenciado (es
//   deliberado: quien está en shadow-ban no debe notarlo), así que un test hecho
//   desde la sesión del baneado pasa siempre y no prueba nada.
//
// NOTA DE TIPADO: este archivo vive bajo `supabase/`, que `tsconfig.json`
// excluye y `eslint.config.mjs` ignora. Entra en el typecheck igualmente porque
// `scripts/security/ejecutarRls.ts` lo importa y TypeScript sigue los imports
// aunque el archivo no esté en el `include`. No lo dejes huérfano.
// ============================================================================

import type { SupabaseClient, PostgrestError } from '@supabase/supabase-js'
import type { Database } from '../../lib/supabase/database.types.ts'

export type ClienteDarma = SupabaseClient<Database>

/** Una identidad sembrada para la prueba. */
export interface UsuarioPrueba {
  id: string
  email: string
  password: string
}

/**
 * Todo lo que la siembra deja preparado. A es la víctima (dueña de los datos),
 * B es quien ataca. Las dos sesiones se crean UNA sola vez y se comparten entre
 * todos los casos: crear un usuario por caso multiplica el tiempo por veinte y
 * entonces nadie ejecuta la suite.
 */
export interface ContextoPrueba {
  usuarioA: UsuarioPrueba
  usuarioB: UsuarioPrueba
  /** Tercera identidad, en shadow-ban, para el caso de `posts_read`. */
  usuarioSombra: UsuarioPrueba

  postA: string
  postSombra: string
  comentarioA: string

  /** Refugio de A, del que B NO es miembro. */
  refugioA: string
  /** Mensaje dentro de `refugioA`. */
  mensajeA: number
  /** Refugio de B, para los casos que exigen ser miembro de algo. */
  refugioB: string

  contenidoAprobado: string
  contenidoPendiente: string

  encuestaA: string
  opcionA: string

  /** Uuid de un refugio que NO existe: distinguirlo del ajeno es el ataque. */
  refugioInexistente: string
}

/** Resultado de un intento de ataque. */
export interface ResultadoAtaque {
  bloqueado: boolean
  detalle: string
}

/** Resultado del positivo de control (el mismo ataque con service_role). */
export interface ResultadoControl {
  funciono: boolean
  detalle: string
}

export interface CasoRls {
  tabla: string
  /** Descripción legible del intento. Aparece tal cual en el informe. */
  ataque: string
  ejecutar(anon: ClienteDarma, ctx: ContextoPrueba): Promise<ResultadoAtaque>
  /**
   * El MISMO ataque con `service_role`. Debe funcionar: si no, el caso está mal
   * escrito y su «bloqueado» no significa nada. Ver la cabecera.
   */
  controlServiceRole?(admin: ClienteDarma, ctx: ContextoPrueba): Promise<ResultadoControl>
  /**
   * Marca de regresión: identifica un fallo REAL que ya se cerró. Estos casos
   * existen para que no vuelva, y su fallo se reporta como regresión, no como
   * hallazgo nuevo.
   */
  regresion?: string
}

// ── Ayudas de aserción ──────────────────────────────────────────────────────

type Respuesta = { data: unknown; error: PostgrestError | null }

/**
 * Una ESCRITURA está bloqueada si dio error o si no afectó a ninguna fila.
 *
 * Las dos formas cuentan porque son dos mecanismos distintos: el privilegio de
 * columna da error de permiso, mientras que una política RLS que no case
 * simplemente no encuentra fila que actualizar y devuelve `[]` sin error. Las
 * dos son «no se pudo escribir», que es lo único que importa.
 *
 * IMPRESCINDIBLE: la consulta debe llevar `.select()` al final. Sin él PostgREST
 * no devuelve las filas afectadas, `data` es null y cualquier update pasaría por
 * «bloqueado».
 */
function escrituraBloqueada(r: Respuesta, contexto: string): ResultadoAtaque {
  if (r.error) return { bloqueado: true, detalle: `${contexto}: rechazado (${r.error.code ?? 'sin código'})` }
  const filas = Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1
  if (filas === 0) return { bloqueado: true, detalle: `${contexto}: 0 filas afectadas` }
  return { bloqueado: false, detalle: `FUGA · ${contexto}: se escribieron ${filas} fila(s)` }
}

/** Una LECTURA está bloqueada si dio error o si devolvió cero filas. */
function lecturaBloqueada(r: Respuesta, contexto: string): ResultadoAtaque {
  if (r.error) return { bloqueado: true, detalle: `${contexto}: rechazado (${r.error.code ?? 'sin código'})` }
  const filas = Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1
  if (filas === 0) return { bloqueado: true, detalle: `${contexto}: 0 filas` }
  // Nunca se vuelca el contenido: el log de CI lo ve todo el equipo y estas
  // tablas guardan desahogos, mensajes cifrados y la cola de crisis.
  return { bloqueado: false, detalle: `FUGA · ${contexto}: se leyeron ${filas} fila(s)` }
}

/** Lectura que debe devolver CERO FILAS **sin error**. La diferencia es el test. */
function silencioSinError(r: Respuesta, contexto: string): ResultadoAtaque {
  if (r.error) {
    return {
      bloqueado: false,
      detalle:
        `FUGA DE EXISTENCIA · ${contexto}: devolvió un error (${r.error.code ?? 'sin código'}) en vez de ` +
        'cero filas. Un error distingue «existe y no tengo acceso» de «no existe», y eso confirma a un ' +
        'acosador que su víctima sigue en la app.',
    }
  }
  const filas = Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1
  if (filas > 0) return { bloqueado: false, detalle: `FUGA · ${contexto}: se leyeron ${filas} fila(s)` }
  return { bloqueado: true, detalle: `${contexto}: cero filas, sin error (correcto)` }
}

/** Un control positivo: la operación con service_role tiene que haber funcionado. */
function controlOk(r: Respuesta, contexto: string): ResultadoControl {
  if (r.error) return { funciono: false, detalle: `${contexto}: falló también con service_role (${r.error.code ?? '?'})` }
  const filas = Array.isArray(r.data) ? r.data.length : r.data == null ? 0 : 1
  if (filas === 0) return { funciono: false, detalle: `${contexto}: 0 filas con service_role` }
  return { funciono: true, detalle: `${contexto}: funcionó con service_role (${filas} fila/s)` }
}

// ============================================================================
// LOS CUATRO ATAQUES OBLIGATORIOS + LAS CINCO REGRESIONES
//
// Van primero, y con comentario, porque son los que más importan. El resto de la
// matriz (tabla × lectura ajena × escritura ajena × columna prohibida) viene
// después.
// ============================================================================

const ATAQUES_NOMBRADOS: readonly CasoRls[] = [
  // ── EL TEST QUE MÁS IMPORTA DE TODA LA SUITE ─────────────────────────────
  // `comments.is_validated` es la columna más peligrosa de la aplicación.
  // `0001` concede `grant update (body, state)`, así que `is_validated` queda
  // fuera — correcto. Pero si alguien la añadiera a ese grant en una migración
  // futura, cualquiera con la anon key podría auto-validarse comentarios,
  // disparar `trg_comments_validated`, ganar karma y saltarse la reciprocidad
  // ENTERA. Este caso va el primero a propósito.
  {
    tabla: 'comments',
    ataque: 'auto-validarse un comentario (is_validated = true) para farmear karma y créditos',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('comments')
        .update({ is_validated: true })
        .eq('id', ctx.comentarioA)
        .select()
      return escrituraBloqueada(r, 'comments.is_validated')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('comments')
        .update({ is_validated: true })
        .eq('id', ctx.comentarioA)
        .select()
      return controlOk(r, 'comments.is_validated')
    },
  },

  // ── Ataque nombrado 1: escribirse karma ──────────────────────────────────
  // La política `profiles_update_own` permite editar la fila propia; lo que
  // impide `karma_reputation = 999999` NO es RLS sino el privilegio de columna
  // (`grant update (alias, avatar_seed, bio, availability)`). Son dos
  // mecanismos distintos y hay que probar el segundo.
  {
    tabla: 'profiles',
    ataque: 'escribirse karma_reputation = 999999 en la propia fila',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('profiles')
        .update({ karma_reputation: 999_999 })
        .eq('id', ctx.usuarioB.id)
        .select()
      return escrituraBloqueada(r, 'profiles.karma_reputation (fila propia)')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('profiles')
        .update({ karma_reputation: 999_999 })
        .eq('id', ctx.usuarioB.id)
        .select()
      return controlOk(r, 'profiles.karma_reputation (fila propia)')
    },
  },
  {
    tabla: 'profiles',
    ataque: 'escribir el karma de OTRA persona',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('profiles')
        .update({ karma_reputation: 999_999 })
        .eq('id', ctx.usuarioA.id)
        .select()
      return escrituraBloqueada(r, 'profiles.karma_reputation (fila ajena)')
    },
  },

  // ── Ataque nombrado 2: saltarse la reciprocidad ──────────────────────────
  // El gate 3:1 no es una comprobación de la API (que se salta con un curl a
  // PostgREST): es el trigger BEFORE INSERT `trg_posts_reciprocity`. Insertar
  // directo tiene que levantar `check_violation` y NO dejar fila.
  {
    tabla: 'posts',
    ataque: 'insertar en posts sin créditos de escucha (saltarse el gate 3:1)',
    async ejecutar(anon, ctx) {
      // Dos inserciones: la primera puede ser el post gratis de B. La segunda ya
      // exige crédito y es la que debe morir en el trigger.
      const cuerpo = 'Texto suficientemente largo para pasar el check de longitud del cuerpo del post.'
      await anon.from('posts').insert({ author_id: ctx.usuarioB.id, body: cuerpo }).select()
      const r = await anon
        .from('posts')
        .insert({ author_id: ctx.usuarioB.id, body: cuerpo + ' Segundo intento.' })
        .select()

      if (r.error) {
        // 23514 = check_violation, el errcode que levanta posts_consume_credit().
        return { bloqueado: true, detalle: `reciprocidad: rechazado (${r.error.code ?? 'sin código'})` }
      }
      return { bloqueado: false, detalle: 'FUGA · se publicó un segundo post sin créditos de escucha' }
    },
  },
  {
    tabla: 'posts',
    ataque: 'publicar en nombre de otra persona (author_id ajeno en el body)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('posts')
        .insert({
          author_id: ctx.usuarioA.id,
          body: 'Suplantación: este post dice ser de otra persona y no debe existir jamás.',
        })
        .select()
      return escrituraBloqueada(r, 'posts.author_id ajeno')
    },
  },

  // ── Ataque nombrado 3: leer identity_vault ───────────────────────────────
  // La tabla con el único vínculo entre alias y persona real. RLS activa y CERO
  // políticas + `revoke all`. Es el pilar del anonimato: ni un bug de API ni una
  // consulta mal escrita pueden filtrarla.
  {
    tabla: 'identity_vault',
    ataque: 'leer identity_vault (el vínculo con la persona real)',
    async ejecutar(anon) {
      const r = await anon.from('identity_vault').select('user_id')
      return lecturaBloqueada(r, 'identity_vault SELECT')
    },
    async controlServiceRole(admin) {
      const r = await admin.from('identity_vault').select('user_id').limit(1)
      return controlOk(r, 'identity_vault SELECT')
    },
  },
  {
    tabla: 'identity_vault',
    ataque: 'escribir en identity_vault',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('identity_vault')
        .insert({ user_id: ctx.usuarioB.id, contact_hash: 'x' })
        .select()
      return escrituraBloqueada(r, 'identity_vault INSERT')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('identity_vault')
        .insert({ user_id: ctx.usuarioSombra.id, contact_hash: 'control' })
        .select()
      return controlOk(r, 'identity_vault INSERT')
    },
  },

  // ── Ataque nombrado 4: leer un refugio ajeno ─────────────────────────────
  // Y la propiedad fina: CERO FILAS, no «permiso denegado». Ver la cabecera.
  {
    tabla: 'refuge_messages',
    ataque: 'leer los mensajes de un refugio del que no soy miembro',
    async ejecutar(anon, ctx) {
      const r = await anon.from('refuge_messages').select('id').eq('refuge_id', ctx.refugioA)
      return silencioSinError(r, 'refuge_messages de refugio ajeno')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('refuge_messages').select('id').eq('refuge_id', ctx.refugioA)
      return controlOk(r, 'refuge_messages de refugio ajeno')
    },
  },
  {
    tabla: 'refuges',
    ataque: 'un refugio ajeno y uno inexistente deben ser INDISTINGUIBLES',
    async ejecutar(anon, ctx) {
      const ajeno = await anon.from('refuges').select('id').eq('id', ctx.refugioA)
      const fantasma = await anon.from('refuges').select('id').eq('id', ctx.refugioInexistente)

      const a = silencioSinError(ajeno, 'refuges ajeno')
      const f = silencioSinError(fantasma, 'refuges inexistente')

      if (!a.bloqueado) return a
      if (!f.bloqueado) return f

      // Misma forma de respuesta en los dos casos: ningún canal lateral.
      const mismaForma = (ajeno.error === null) === (fantasma.error === null)
      return mismaForma
        ? { bloqueado: true, detalle: 'refugio ajeno e inexistente responden igual (correcto)' }
        : {
            bloqueado: false,
            detalle:
              'FUGA DE EXISTENCIA · el refugio ajeno y el inexistente responden distinto: ' +
              'se puede confirmar que una sala existe sin pertenecer a ella.',
          }
    },
  },

  // ══════════════════════════════════════════════════════════════════════════
  // LAS CINCO REGRESIONES · fallos REALES cerrados en la auditoría 2026-08-03.
  // Estos casos son la prueba de que no vuelven. Si uno falla, alguien ha
  // reabierto un agujero que ya costó encontrar una vez.
  // ══════════════════════════════════════════════════════════════════════════

  // R1 · `0001` revocaba `award_karma` a `public, anon, authenticated`, y ese
  // `revoke ... from public` se lleva por delante el EXECUTE que `service_role`
  // heredaba. Sin el grant explícito, el servidor no podía otorgar karma por
  // RPC: la economía entera quedaba muerta desde fuera de los triggers.
  {
    tabla: 'fn:award_karma',
    ataque: 'REGRESIÓN R1 · award_karma debe ser inejecutable desde authenticated…',
    regresion: 'R1 · grant execute de award_karma a service_role',
    async ejecutar(anon, ctx) {
      const r = await anon.rpc('award_karma', { p_user: ctx.usuarioB.id, p_kind: 'comment_validated' })
      return r.error
        ? { bloqueado: true, detalle: `award_karma desde authenticated: rechazado (${r.error.code ?? '?'})` }
        : { bloqueado: false, detalle: 'FUGA · authenticated pudo ejecutar award_karma y regalarse karma' }
    },
    // …y EJECUTABLE desde service_role. Esta mitad es el positivo de control y a
    // la vez la regresión: si falla, el `grant execute … to service_role` de
    // 0001 ha desaparecido otra vez.
    async controlServiceRole(admin, ctx) {
      const r = await admin.rpc('award_karma', {
        p_user: ctx.usuarioA.id,
        p_kind: 'comment_validated',
        p_idem: `regresion-r1:${Date.now()}`,
      })
      return r.error
        ? {
            funciono: false,
            detalle:
              `REGRESIÓN R1 · service_role NO puede ejecutar award_karma (${r.error.code ?? '?'}). ` +
              'Falta `grant execute on function public.award_karma(...) to service_role` en 0001_core.sql.',
          }
        : { funciono: true, detalle: 'award_karma ejecutable por service_role (correcto)' }
    },
  },

  // R2 · `content_views` concedía `grant update (watched_seconds, completed,
  // completed_at)` a authenticated. Eso era karma gratis: un PATCH poniendo
  // `completed = true`, repetido sobre 120 contenidos distintos, agotaba el tope
  // diario entero sin ver un segundo de vídeo. La PK impide repetir el MISMO
  // contenido; no impide barrer el catálogo.
  {
    tabla: 'content_views',
    ataque: 'REGRESIÓN R2 · farmear karma con PATCH completed = true sobre content_views',
    regresion: 'R2 · farmeo de karma vía PATCH en content_views',
    async ejecutar(anon, ctx) {
      // Primero la fila legítima (nace a cero, que es lo único permitido).
      await anon
        .from('content_views')
        .insert({ content_id: ctx.contenidoAprobado, user_id: ctx.usuarioB.id })
        .select()

      const r = await anon
        .from('content_views')
        .update({ completed: true, watched_seconds: 9999 })
        .eq('content_id', ctx.contenidoAprobado)
        .eq('user_id', ctx.usuarioB.id)
        .select()

      return escrituraBloqueada(r, 'content_views.completed vía UPDATE')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('content_views')
        .update({ completed: true })
        .eq('content_id', ctx.contenidoAprobado)
        .eq('user_id', ctx.usuarioB.id)
        .select()
      return controlOk(r, 'content_views.completed vía UPDATE')
    },
  },

  // R3 · la otra mitad del mismo agujero, la que casi siempre se olvida: si el
  // UPDATE está cerrado pero el INSERT deja nacer la fila con `completed =
  // true`, el karma se farmea igual. Lo cierra el `with check` de
  // `content_views_insert_own` (completed = false y watched_seconds = 0).
  {
    tabla: 'content_views',
    ataque: 'REGRESIÓN R3 · insertar en content_views directamente con completed = true',
    regresion: 'R3 · farmeo de karma vía INSERT en content_views',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('content_views')
        .insert({
          content_id: ctx.contenidoPendiente,
          user_id: ctx.usuarioB.id,
          completed: true,
          watched_seconds: 9999,
        })
        .select()
      return escrituraBloqueada(r, 'content_views INSERT con completed = true')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('content_views')
        .insert({ content_id: ctx.contenidoPendiente, user_id: ctx.usuarioA.id, completed: true })
        .select()
      return controlOk(r, 'content_views INSERT con completed = true')
    },
  },

  // R4 · el ledger registraba los GASTOS con la clase `comment_validated`,
  // porque `karma_events.kind` tiene una FK a `karma_weights(kind)` y no había
  // clase para gastar. Resultado: un boost de −50 aparecía en el historial de la
  // persona etiquetado como «comentario validado» — y la pantalla que miente es
  // justo la de transparencia del karma, la que sostiene la confianza.
  //
  // Aquí se comprueba desde el cliente lo único comprobable con la anon key: que
  // la clase `karma_spend` EXISTE en la tabla pública de pesos y que su
  // `reputation` es 0. La verificación de que spend_karma() la usa vive en
  // `rls_regresiones.sql` (pgTAP), que sí puede mirar el ledger.
  {
    tabla: 'karma_weights',
    ataque: "REGRESIÓN R4 · la clase 'karma_spend' debe existir con reputation = 0",
    regresion: 'R4 · el ledger etiquetaba gastos como comment_validated',
    async ejecutar(anon) {
      const r = await anon
        .from('karma_weights')
        .select('kind, reputation, counts_to_cap')
        .eq('kind', 'karma_spend')
        .maybeSingle()

      if (r.error) {
        return { bloqueado: false, detalle: `REGRESIÓN R4 · no se pudo leer karma_weights (${r.error.code ?? '?'})` }
      }
      if (!r.data) {
        return {
          bloqueado: false,
          detalle:
            "REGRESIÓN R4 · la clase 'karma_spend' NO existe en karma_weights. Sin ella spend_karma() " +
            "vuelve a reutilizar 'comment_validated' para satisfacer la FK y el ledger miente.",
        }
      }
      if (r.data.reputation !== 0 || r.data.counts_to_cap !== false) {
        return {
          bloqueado: false,
          detalle: `REGRESIÓN R4 · 'karma_spend' tiene reputation=${r.data.reputation}, counts_to_cap=${r.data.counts_to_cap}; se esperaba 0 y false`,
        }
      }
      return { bloqueado: true, detalle: "'karma_spend' existe con reputation = 0 (correcto)" }
    },
  },

  // R5 · `profiles_read ... using (true)` deja ver todas las FILAS —que es lo
  // que queremos, los perfiles son anónimos— pero RLS no sabe nada de COLUMNAS.
  // Sin el `revoke select` + `grant select (…)`, un
  // `GET /rest/v1/profiles?select=karma_spendable,crystals` devolvía el saldo de
  // cualquiera, rompiendo CONTRATOS §2, que los declara privados.
  {
    tabla: 'profiles',
    ataque: 'REGRESIÓN R5 · leer karma_spendable y crystals de otra persona',
    regresion: 'R5 · fuga de karma_spendable/crystals por falta de privilegio de columna',
    async ejecutar(anon, ctx) {
      const r = await anon.from('profiles').select('karma_spendable, crystals').eq('id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'profiles.karma_spendable/crystals (fila ajena)')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('profiles').select('karma_spendable, crystals').eq('id', ctx.usuarioA.id)
      return controlOk(r, 'profiles.karma_spendable/crystals (fila ajena)')
    },
  },
  {
    tabla: 'profiles',
    ataque: 'REGRESIÓN R5 bis · leer el propio saldo con un select directo (tampoco)',
    regresion: 'R5 · fuga de karma_spendable/crystals por falta de privilegio de columna',
    async ejecutar(anon, ctx) {
      // El privilegio de columna no distingue fila propia de ajena: no hay
      // consulta directa que devuelva estos campos. La única puerta es la RPC
      // `mi_perfil_privado()`, y eso es exactamente lo que se quiere.
      const r = await anon.from('profiles').select('karma_spendable').eq('id', ctx.usuarioB.id)
      return lecturaBloqueada(r, 'profiles.karma_spendable (fila propia)')
    },
  },
  {
    tabla: 'profiles',
    ataque: 'REGRESIÓN R5 ter · mi_perfil_privado() SÍ devuelve el saldo propio',
    regresion: 'R5 · fuga de karma_spendable/crystals por falta de privilegio de columna',
    async ejecutar(anon) {
      // El contrapunto: cerrar la columna sin dejar la puerta buena abierta
      // rompería /api/me. Aquí «bloqueado» significa «la RPC funciona».
      const r = await anon.rpc('mi_perfil_privado')
      if (r.error) {
        return { bloqueado: false, detalle: `mi_perfil_privado() falló para authenticated (${r.error.code ?? '?'})` }
      }
      return { bloqueado: true, detalle: 'mi_perfil_privado() accesible para el propio usuario (correcto)' }
    },
  },
]

// ============================================================================
// MATRIZ TABLA POR TABLA
// Para cada tabla: lectura ajena, escritura ajena y columna prohibida.
// ============================================================================

const MATRIZ: readonly CasoRls[] = [
  // ── profiles ─────────────────────────────────────────────────────────────
  {
    tabla: 'profiles',
    ataque: 'lectura ajena de los campos públicos (DEBE permitirse: son anónimos)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('profiles').select('id, alias, level').eq('id', ctx.usuarioA.id)
      const filas = Array.isArray(r.data) ? r.data.length : 0
      return r.error === null && filas === 1
        ? { bloqueado: true, detalle: 'perfil público legible (correcto)' }
        : { bloqueado: false, detalle: `profiles: el perfil público NO es legible (${r.error?.code ?? '0 filas'})` }
    },
  },
  {
    tabla: 'profiles',
    ataque: 'leer shadow_banned de otra persona (delataría el shadow-ban)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('profiles').select('shadow_banned').eq('id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'profiles.shadow_banned')
    },
  },
  {
    tabla: 'profiles',
    ataque: 'leer listen_credits y banned_until de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon.from('profiles').select('listen_credits, banned_until').eq('id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'profiles.listen_credits/banned_until')
    },
  },
  {
    tabla: 'profiles',
    ataque: 'escribir el alias de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon.from('profiles').update({ alias: 'secuestrado' }).eq('id', ctx.usuarioA.id).select()
      return escrituraBloqueada(r, 'profiles.alias ajeno')
    },
  },
  {
    tabla: 'profiles',
    ataque: 'escribir columnas prohibidas propias (crystals, listen_credits, shadow_banned, banned_until)',
    async ejecutar(anon, ctx) {
      for (const parche of [
        { crystals: 9999 },
        { listen_credits: 9999 },
        { shadow_banned: false },
        { banned_until: null },
        { karma_spendable: 9999 },
      ]) {
        const r = await anon.from('profiles').update(parche).eq('id', ctx.usuarioB.id).select()
        const res = escrituraBloqueada(r, `profiles.${Object.keys(parche)[0]}`)
        if (!res.bloqueado) return res
      }
      return { bloqueado: true, detalle: 'ninguna columna privada de profiles es escribible' }
    },
  },
  {
    tabla: 'profiles',
    ataque: 'escribir la columna generada `level`',
    async ejecutar(anon, ctx) {
      // OJO: aquí Postgres da «cannot insert into generated column», que NO es
      // un error de permiso. La aserción correcta es «no se pudo escribir».
      const r = await anon.from('profiles').update({ level: 'mentor' } as never).eq('id', ctx.usuarioB.id).select()
      return escrituraBloqueada(r, 'profiles.level (columna generada)')
    },
  },

  // ── karma_events ─────────────────────────────────────────────────────────
  {
    tabla: 'karma_events',
    ataque: 'leer el ledger de karma de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon.from('karma_events').select('id').eq('user_id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'karma_events ajeno')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('karma_events').select('id').eq('user_id', ctx.usuarioA.id).limit(1)
      return controlOk(r, 'karma_events ajeno')
    },
  },
  {
    tabla: 'karma_events',
    ataque: 'insertar una entrada en el ledger de karma',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('karma_events')
        .insert({ user_id: ctx.usuarioB.id, kind: 'comment_validated', delta_reputation: 5000, delta_spendable: 5000 })
        .select()
      return escrituraBloqueada(r, 'karma_events INSERT')
    },
  },
  {
    tabla: 'karma_events',
    ataque: 'borrar del ledger de karma (es append-only)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('karma_events').delete().eq('user_id', ctx.usuarioB.id).select()
      return escrituraBloqueada(r, 'karma_events DELETE')
    },
  },

  // ── karma_weights ────────────────────────────────────────────────────────
  {
    tabla: 'karma_weights',
    ataque: 'lectura pública de la economía (DEBE permitirse: es auditable por diseño)',
    async ejecutar(anon) {
      const r = await anon.from('karma_weights').select('kind, reputation')
      const filas = Array.isArray(r.data) ? r.data.length : 0
      return r.error === null && filas > 0
        ? { bloqueado: true, detalle: `karma_weights legible (${filas} clases, correcto)` }
        : { bloqueado: false, detalle: 'karma_weights NO es legible y la economía debe ser auditable' }
    },
  },
  {
    tabla: 'karma_weights',
    ataque: 'reescribir el peso de una acción (subirse comment_validated a 1000)',
    async ejecutar(anon) {
      const r = await anon.from('karma_weights').update({ reputation: 1000 }).eq('kind', 'comment_validated').select()
      return escrituraBloqueada(r, 'karma_weights.reputation')
    },
    async controlServiceRole(admin) {
      const r = await admin.from('karma_weights').update({ reputation: 10 }).eq('kind', 'comment_validated').select()
      return controlOk(r, 'karma_weights.reputation')
    },
  },
  {
    tabla: 'karma_weights',
    ataque: 'insertar una clase de karma nueva',
    async ejecutar(anon) {
      const r = await anon
        .from('karma_weights')
        .insert({ kind: 'clase_inventada', reputation: 5000, description: 'x' })
        .select()
      return escrituraBloqueada(r, 'karma_weights INSERT')
    },
  },

  // ── posts ────────────────────────────────────────────────────────────────
  {
    tabla: 'posts',
    ataque: 'un post en shadow-ban NO debe verse desde otra sesión',
    async ejecutar(anon, ctx) {
      // Se comprueba desde B, nunca desde el propio baneado: `posts_read` deja
      // al autor ver sus posts aunque esté silenciado (deliberado), así que el
      // test hecho desde su sesión pasaría siempre sin probar nada.
      const r = await anon.from('posts').select('id').eq('id', ctx.postSombra)
      return lecturaBloqueada(r, 'posts de un autor en shadow-ban')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('posts').select('id').eq('id', ctx.postSombra)
      return controlOk(r, 'posts de un autor en shadow-ban')
    },
  },
  {
    tabla: 'posts',
    ataque: 'editar el cuerpo de un post ajeno',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('posts')
        .update({ body: 'Contenido reescrito por alguien que no es el autor de este texto.' })
        .eq('id', ctx.postA)
        .select()
      return escrituraBloqueada(r, 'posts.body ajeno')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('posts')
        .update({ body: 'Contenido reescrito por alguien que no es el autor de este texto.' })
        .eq('id', ctx.postA)
        .select()
      return controlOk(r, 'posts.body ajeno')
    },
  },
  {
    tabla: 'posts',
    ataque: 'escribir columnas prohibidas de posts (upvote_count, reply_count, hot_score, risk, boost_until)',
    async ejecutar(anon, ctx) {
      for (const parche of [
        { upvote_count: 9999 },
        { reply_count: 9999 },
        { hot_score: 9999 },
        { risk: 'none' as const },
        { boost_until: new Date(Date.now() + 86_400_000).toISOString() },
      ]) {
        const r = await anon.from('posts').update(parche).eq('id', ctx.postA).select()
        const res = escrituraBloqueada(r, `posts.${Object.keys(parche)[0]}`)
        if (!res.bloqueado) return res
      }
      return { bloqueado: true, detalle: 'ninguna columna de ranking/moderación de posts es escribible' }
    },
  },

  // ── comments ─────────────────────────────────────────────────────────────
  {
    tabla: 'comments',
    ataque: 'editar el cuerpo de un comentario ajeno',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('comments')
        .update({ body: 'Texto reescrito por quien no lo escribió, suficientemente largo para el check.' })
        .eq('id', ctx.comentarioA)
        .select()
      return escrituraBloqueada(r, 'comments.body ajeno')
    },
  },
  {
    tabla: 'comments',
    ataque: 'escribir columnas prohibidas de comments (is_helpful, quality_score, upvote_count)',
    async ejecutar(anon, ctx) {
      for (const parche of [{ is_helpful: true }, { quality_score: 1 }, { upvote_count: 9999 }]) {
        const r = await anon.from('comments').update(parche).eq('id', ctx.comentarioA).select()
        const res = escrituraBloqueada(r, `comments.${Object.keys(parche)[0]}`)
        if (!res.bloqueado) return res
      }
      return { bloqueado: true, detalle: 'ninguna columna de calidad de comments es escribible' }
    },
  },
  {
    tabla: 'comments',
    ataque: 'comentar en nombre de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('comments')
        .insert({
          post_id: ctx.postA,
          author_id: ctx.usuarioA.id,
          body: 'Comentario suplantado, con longitud suficiente para superar el check de la tabla.',
        })
        .select()
      return escrituraBloqueada(r, 'comments.author_id ajeno')
    },
  },

  // ── post_votes ───────────────────────────────────────────────────────────
  {
    tabla: 'post_votes',
    ataque: 'votar en nombre de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon.from('post_votes').insert({ post_id: ctx.postA, user_id: ctx.usuarioA.id }).select()
      return escrituraBloqueada(r, 'post_votes.user_id ajeno')
    },
  },
  {
    tabla: 'post_votes',
    ataque: 'borrar el voto de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('post_votes')
        .delete()
        .eq('post_id', ctx.postA)
        .eq('user_id', ctx.usuarioA.id)
        .select()
      return escrituraBloqueada(r, 'post_votes DELETE ajeno')
    },
  },

  // ── refuges / refuge_members / refuge_messages ───────────────────────────
  {
    tabla: 'refuges',
    ataque: 'archivar el refugio de otra persona (altera el hilo de quien está dentro)',
    async ejecutar(anon, ctx) {
      // El vector real no es «borrar mensajes ajenos»: es que quien no es
      // creador archive la sala. Y en la sala propia, que el creador toque los
      // contadores. Son dos mecanismos distintos (política vs columna).
      const r = await anon
        .from('refuges')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', ctx.refugioA)
        .select()
      return escrituraBloqueada(r, 'refuges.archived_at ajeno')
    },
  },
  {
    tabla: 'refuges',
    ataque: 'tocar los contadores del refugio PROPIO (member_count, message_count, last_message_at)',
    async ejecutar(anon, ctx) {
      for (const parche of [{ member_count: 99 }, { message_count: 99 }, { last_message_at: new Date().toISOString() }]) {
        const r = await anon.from('refuges').update(parche).eq('id', ctx.refugioB).select()
        const res = escrituraBloqueada(r, `refuges.${Object.keys(parche)[0]} (sala propia)`)
        if (!res.bloqueado) return res
      }
      return { bloqueado: true, detalle: 'los contadores de refuges no son escribibles ni por el creador' }
    },
  },
  {
    tabla: 'refuge_members',
    ataque: 'leer la pertenencia de un refugio ajeno',
    async ejecutar(anon, ctx) {
      const r = await anon.from('refuge_members').select('user_id').eq('refuge_id', ctx.refugioA)
      return silencioSinError(r, 'refuge_members de refugio ajeno')
    },
  },
  {
    tabla: 'refuge_members',
    ataque: 'colarse en un refugio ajeno insertándose como miembro',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('refuge_members')
        .insert({ refuge_id: ctx.refugioA, user_id: ctx.usuarioB.id })
        .select()
      // Nota: `refuge_members_join` permite `user_id = auth.uid()` sin exigir
      // invitación; lo que impide colarse en la sala de A es el aforo y el
      // bloqueo. Si esto deja de estar bloqueado, hay que revisar la política.
      return escrituraBloqueada(r, 'refuge_members INSERT en sala ajena')
    },
  },
  {
    tabla: 'refuge_members',
    ataque: 'concederse `is_host` en la sala propia',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('refuge_members')
        .update({ is_host: true })
        .eq('refuge_id', ctx.refugioB)
        .eq('user_id', ctx.usuarioB.id)
        .select()
      return escrituraBloqueada(r, 'refuge_members.is_host')
    },
  },
  {
    tabla: 'refuge_members',
    ataque: 'expulsar a otra persona de un refugio (update de su fila)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('refuge_members')
        .update({ left_at: new Date().toISOString() })
        .eq('refuge_id', ctx.refugioA)
        .eq('user_id', ctx.usuarioA.id)
        .select()
      return escrituraBloqueada(r, 'refuge_members.left_at ajeno')
    },
  },
  {
    tabla: 'refuge_messages',
    ataque: 'escribir en un refugio del que no soy miembro',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('refuge_messages')
        .insert({
          refuge_id: ctx.refugioA,
          sender_id: ctx.usuarioB.id,
          ciphertext: '\\xdeadbeef',
          nonce: '\\x000102030405060708090a0b',
        })
        .select()
      return escrituraBloqueada(r, 'refuge_messages INSERT en sala ajena')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('refuge_messages')
        .insert({
          refuge_id: ctx.refugioA,
          sender_id: ctx.usuarioA.id,
          ciphertext: '\\xc0ffee',
          nonce: '\\x000102030405060708090a0b',
        })
        .select()
      return controlOk(r, 'refuge_messages INSERT en sala ajena')
    },
  },
  {
    tabla: 'refuge_messages',
    ataque: 'reescribir el ciphertext de un mensaje (debe ser INMUTABLE)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('refuge_messages')
        .update({ ciphertext: '\\xc0ffee' })
        .eq('id', ctx.mensajeA)
        .select()
      return escrituraBloqueada(r, 'refuge_messages.ciphertext')
    },
  },
  {
    tabla: 'refuge_messages',
    ataque: 'borrar un mensaje (delete revocado: rompería el hilo de la otra persona)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('refuge_messages').delete().eq('id', ctx.mensajeA).select()
      return escrituraBloqueada(r, 'refuge_messages DELETE')
    },
  },

  // ── kindred ──────────────────────────────────────────────────────────────
  {
    tabla: 'kindred',
    ataque: 'leer la lista de almas afines de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon.from('kindred').select('kindred_id').eq('owner_id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'kindred ajena')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('kindred').select('kindred_id').eq('owner_id', ctx.usuarioA.id)
      return controlOk(r, 'kindred ajena')
    },
  },
  {
    tabla: 'kindred',
    ataque: 'saber quién te tiene guardado (consulta por el sentido inverso)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('kindred').select('owner_id').eq('kindred_id', ctx.usuarioB.id)
      return lecturaBloqueada(r, 'kindred inversa')
    },
  },
  {
    tabla: 'kindred',
    ataque: 'insertar una entrada en la lista de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('kindred')
        .insert({ owner_id: ctx.usuarioA.id, kindred_id: ctx.usuarioB.id })
        .select()
      return escrituraBloqueada(r, 'kindred INSERT ajeno')
    },
  },
  {
    tabla: 'kindred',
    ataque: 'cambiar el kindred_id de una fila propia (solo `note` es editable)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('kindred')
        .update({ kindred_id: ctx.usuarioA.id })
        .eq('owner_id', ctx.usuarioB.id)
        .select()
      return escrituraBloqueada(r, 'kindred.kindred_id')
    },
  },

  // ── blocks ───────────────────────────────────────────────────────────────
  {
    tabla: 'blocks',
    ataque: 'averiguar si alguien me ha bloqueado',
    async ejecutar(anon, ctx) {
      // Que la persona bloqueada no pueda consultarlo es intencionado: si
      // supiera que la bloquearon, buscaría otra vía.
      const r = await anon.from('blocks').select('blocker_id').eq('blocked_id', ctx.usuarioB.id)
      return lecturaBloqueada(r, 'blocks por blocked_id')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('blocks').select('blocker_id').eq('blocked_id', ctx.usuarioB.id)
      return controlOk(r, 'blocks por blocked_id')
    },
  },
  {
    tabla: 'blocks',
    ataque: 'crear un bloqueo en nombre de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('blocks')
        .insert({ blocker_id: ctx.usuarioA.id, blocked_id: ctx.usuarioB.id })
        .select()
      return escrituraBloqueada(r, 'blocks INSERT ajeno')
    },
  },
  {
    tabla: 'blocks',
    ataque: 'editar un bloqueo propio (UPDATE está revocado entero)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('blocks').update({ mode: 'mute' }).eq('blocker_id', ctx.usuarioB.id).select()
      return escrituraBloqueada(r, 'blocks UPDATE')
    },
  },

  // ── content_items ────────────────────────────────────────────────────────
  {
    tabla: 'content_items',
    ataque: 'leer contenido sin aprobar (pendiente o rechazado)',
    async ejecutar(anon, ctx) {
      // Es la barrera que impide que contenido sin revisar llegue a alguien
      // vulnerable por un fallo de la app.
      const r = await anon.from('content_items').select('id').eq('id', ctx.contenidoPendiente)
      return lecturaBloqueada(r, 'content_items pendiente')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('content_items').select('id').eq('id', ctx.contenidoPendiente)
      return controlOk(r, 'content_items pendiente')
    },
  },
  {
    tabla: 'content_items',
    ataque: 'subir contenido desde el cliente (vector de contenido pro-autolesión)',
    async ejecutar(anon) {
      const r = await anon
        .from('content_items')
        .insert({
          source: 'atacante',
          platform: 'youtube',
          external_id: 'malicioso-1',
          title: 'Contenido inyectado',
          url: 'https://example.invalid/x',
          state: 'approved',
        })
        .select()
      return escrituraBloqueada(r, 'content_items INSERT')
    },
  },
  {
    tabla: 'content_items',
    ataque: 'auto-aprobarse contenido (state = approved)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('content_items')
        .update({ state: 'approved' })
        .eq('id', ctx.contenidoPendiente)
        .select()
      return escrituraBloqueada(r, 'content_items.state')
    },
  },

  // ── content_views ────────────────────────────────────────────────────────
  {
    tabla: 'content_views',
    ataque: 'leer lo que ha visto otra persona (historial de consumo)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('content_views').select('content_id').eq('user_id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'content_views ajenas')
    },
  },
  {
    tabla: 'content_views',
    ataque: 'borrar una visualización propia (delete revocado)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('content_views').delete().eq('user_id', ctx.usuarioB.id).select()
      return escrituraBloqueada(r, 'content_views DELETE')
    },
  },

  // ── polls / poll_options / poll_votes ────────────────────────────────────
  {
    tabla: 'polls',
    ataque: 'cerrar la encuesta de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon.from('polls').update({ state: 'hidden' }).eq('id', ctx.encuestaA).select()
      return escrituraBloqueada(r, 'polls.state ajeno')
    },
  },
  {
    tabla: 'polls',
    ataque: 'inflar total_votes de una encuesta',
    async ejecutar(anon, ctx) {
      const r = await anon.from('polls').update({ total_votes: 9999 }).eq('id', ctx.encuestaA).select()
      return escrituraBloqueada(r, 'polls.total_votes')
    },
  },
  {
    tabla: 'poll_options',
    ataque: 'inflar el contador de una opción',
    async ejecutar(anon, ctx) {
      const r = await anon.from('poll_options').update({ vote_count: 9999 }).eq('id', ctx.opcionA).select()
      return escrituraBloqueada(r, 'poll_options.vote_count')
    },
  },
  {
    tabla: 'poll_options',
    ataque: 'añadir una opción a la encuesta de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('poll_options')
        .insert({ poll_id: ctx.encuestaA, ordinal: 9, label: 'opción inyectada' })
        .select()
      return escrituraBloqueada(r, 'poll_options INSERT ajeno')
    },
  },
  {
    tabla: 'poll_votes',
    ataque: 'leer el voto de otra persona (la encuesta es anónima incluso para su autor)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('poll_votes').select('option_id').eq('user_id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'poll_votes ajenos')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('poll_votes').select('option_id').eq('user_id', ctx.usuarioA.id)
      return controlOk(r, 'poll_votes ajenos')
    },
  },
  {
    tabla: 'poll_votes',
    ataque: 'cambiar el propio voto (UPDATE revocado: el voto es definitivo)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('poll_votes')
        .update({ option_id: ctx.opcionA })
        .eq('user_id', ctx.usuarioB.id)
        .select()
      return escrituraBloqueada(r, 'poll_votes UPDATE')
    },
  },
  {
    tabla: 'poll_votes',
    ataque: 'votar, borrar y volver a votar (DELETE revocado)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('poll_votes').delete().eq('user_id', ctx.usuarioB.id).select()
      return escrituraBloqueada(r, 'poll_votes DELETE')
    },
  },

  // ── moderación, crisis y rate limits: cero políticas ─────────────────────
  {
    tabla: 'moderation_flags',
    ataque: 'averiguar si alguien fue reportado, o quién le reportó',
    async ejecutar(anon) {
      const r = await anon.from('moderation_flags').select('id')
      return lecturaBloqueada(r, 'moderation_flags SELECT')
    },
    async controlServiceRole(admin) {
      const r = await admin.from('moderation_flags').select('id').limit(1)
      return controlOk(r, 'moderation_flags SELECT')
    },
  },
  {
    tabla: 'moderation_flags',
    ataque: 'inyectar una señal de moderación contra otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('moderation_flags')
        .insert({ ref_type: 'profile', subject_id: ctx.usuarioA.id, signal: 'user_report', severity: 5 })
        .select()
      return escrituraBloqueada(r, 'moderation_flags INSERT')
    },
  },
  {
    tabla: 'crisis_events',
    ataque: 'leer la cola de crisis (quién está en riesgo)',
    async ejecutar(anon) {
      const r = await anon.from('crisis_events').select('id')
      return lecturaBloqueada(r, 'crisis_events SELECT')
    },
    async controlServiceRole(admin) {
      const r = await admin.from('crisis_events').select('id').limit(1)
      return controlOk(r, 'crisis_events SELECT')
    },
  },
  {
    tabla: 'crisis_events',
    ataque: 'leer el propio expediente de crisis (tampoco: es infraestructura del servidor)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('crisis_events').select('id').eq('user_id', ctx.usuarioB.id)
      return lecturaBloqueada(r, 'crisis_events propio')
    },
  },
  {
    tabla: 'crisis_events',
    ataque: 'marcar un evento de crisis como atendido',
    async ejecutar(anon) {
      const r = await anon.from('crisis_events').update({ attended_at: new Date().toISOString() }).gt('id', 0).select()
      return escrituraBloqueada(r, 'crisis_events UPDATE')
    },
  },
  {
    tabla: 'rate_limits',
    ataque: 'leer los contadores de rate limit',
    async ejecutar(anon) {
      const r = await anon.from('rate_limits').select('key')
      return lecturaBloqueada(r, 'rate_limits SELECT')
    },
  },
  {
    tabla: 'rate_limits',
    ataque: 'reiniciar el propio contador de rate limit',
    async ejecutar(anon) {
      const r = await anon.from('rate_limits').update({ count: 0 }).neq('key', '').select()
      return escrituraBloqueada(r, 'rate_limits UPDATE')
    },
  },

  // ── economía ─────────────────────────────────────────────────────────────
  {
    tabla: 'crystal_ledger',
    ataque: 'leer el libro de cristales de otra persona',
    async ejecutar(anon, ctx) {
      const r = await anon.from('crystal_ledger').select('id').eq('user_id', ctx.usuarioA.id)
      return lecturaBloqueada(r, 'crystal_ledger ajeno')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.from('crystal_ledger').select('id').eq('user_id', ctx.usuarioA.id)
      return controlOk(r, 'crystal_ledger ajeno')
    },
  },
  {
    tabla: 'crystal_ledger',
    ataque: 'acreditarse cristales insertando en el libro',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('crystal_ledger')
        .insert({ user_id: ctx.usuarioB.id, delta: 10_000, reason: 'regalo propio', source: 'grant' })
        .select()
      return escrituraBloqueada(r, 'crystal_ledger INSERT')
    },
  },
  {
    tabla: 'crystal_ledger',
    ataque: 'reescribir el histórico económico (append-only por trigger)',
    async ejecutar(anon, ctx) {
      const r = await anon.from('crystal_ledger').update({ delta: 10_000 }).eq('user_id', ctx.usuarioB.id).select()
      return escrituraBloqueada(r, 'crystal_ledger UPDATE')
    },
  },
  {
    tabla: 'boosts',
    ataque: 'los boosts son PÚBLICOS por transparencia (debe poder leerse que un post está impulsado)',
    async ejecutar(anon, ctx) {
      // Igual que un anuncio se marca como anuncio. Si esta lectura dejara de
      // funcionar, el feed no podría señalar el contenido impulsado.
      const r = await anon.from('boosts').select('id').eq('post_id', ctx.postA)
      return r.error === null
        ? { bloqueado: true, detalle: 'boosts legible por authenticated (correcto)' }
        : { bloqueado: false, detalle: `boosts NO es legible (${r.error.code ?? '?'}) y debe serlo` }
    },
  },
  {
    tabla: 'boosts',
    ataque: 'regalarse un boost (no hay política de INSERT en boosts)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('boosts')
        .insert({
          post_id: ctx.postA,
          user_id: ctx.usuarioB.id,
          currency: 'karma',
          amount: 50,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .select()
      return escrituraBloqueada(r, 'boosts INSERT')
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin
        .from('boosts')
        .insert({
          post_id: ctx.postA,
          user_id: ctx.usuarioA.id,
          currency: 'karma',
          amount: 50,
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        })
        .select()
      return controlOk(r, 'boosts INSERT')
    },
  },
  {
    tabla: 'gifts',
    ataque: 'fabricar un regalo de cristales (no hay política de INSERT en gifts)',
    async ejecutar(anon, ctx) {
      const r = await anon
        .from('gifts')
        .insert({
          sender_id: ctx.usuarioA.id,
          recipient_id: ctx.usuarioB.id,
          gift_kind: 'vela',
          cost_crystals: 100,
          fee_crystals: 0,
          net_crystals: 100,
        })
        .select()
      return escrituraBloqueada(r, 'gifts INSERT')
    },
  },
  {
    tabla: 'gifts',
    ataque: 'leer regalos en los que no estoy implicado',
    async ejecutar(anon, ctx) {
      const r = await anon.from('gifts').select('id').eq('sender_id', ctx.usuarioA.id).eq('recipient_id', ctx.usuarioSombra.id)
      return lecturaBloqueada(r, 'gifts ajenos')
    },
  },
]

// ============================================================================
// FUNCIONES `SECURITY DEFINER`
//
// Las de economía y rate limiting llevan `revoke all ... from public, anon,
// authenticated`: llamarlas por RPC con la anon key tiene que dar error de
// permiso. Si `spend_karma` fuera invocable, cualquiera se vaciaría el saldo de
// otro; si `check_rate_limit` lo fuera, se podría gastar el cupo de un tercero.
//
// ⚠️ DIVERGENCIA CON LA FICHA B15, VERIFICADA CONTRA EL SQL: la ficha lista
// `is_refuge_member`, `is_blocked_between` y `refuge_has_block` como
// «inejecutables desde authenticated». El nombre real de la segunda es
// `is_blocked_with`, y las TRES están concedidas a `authenticated` a propósito
// en `0002_comunidad.sql` (líneas 1256-1258) — y tiene que ser así: una
// expresión de política RLS se evalúa con los privilegios de QUIEN CONSULTA, de
// modo que sin ese grant toda consulta a `refuges` fallaría con «permission
// denied for function». Lo que las hace seguras no es el revoke: es que su firma
// no acepta un uuid de tercero, así que la única respuesta obtenible es sobre
// uno mismo. Eso es lo que se testea aquí. Anotado en HANDOFF/PEDIDOS.md.
// ============================================================================

const FUNCIONES: readonly CasoRls[] = [
  {
    tabla: 'fn:spend_karma',
    ataque: 'ejecutar spend_karma por RPC con la anon key',
    async ejecutar(anon, ctx) {
      const r = await anon.rpc('spend_karma', { p_user: ctx.usuarioA.id, p_amount: 1, p_reason: 'ataque' })
      return r.error
        ? { bloqueado: true, detalle: `spend_karma: rechazado (${r.error.code ?? '?'})` }
        : { bloqueado: false, detalle: 'FUGA · authenticated pudo ejecutar spend_karma sobre otra persona' }
    },
  },
  {
    tabla: 'fn:spend_crystals',
    ataque: 'ejecutar spend_crystals por RPC con la anon key',
    async ejecutar(anon, ctx) {
      const r = await anon.rpc('spend_crystals', { p_user: ctx.usuarioA.id, p_amount: 1, p_reason: 'ataque' })
      return r.error
        ? { bloqueado: true, detalle: `spend_crystals: rechazado (${r.error.code ?? '?'})` }
        : { bloqueado: false, detalle: 'FUGA · authenticated pudo ejecutar spend_crystals sobre otra persona' }
    },
    async controlServiceRole(admin, ctx) {
      const r = await admin.rpc('spend_crystals', { p_user: ctx.usuarioA.id, p_amount: 1, p_reason: 'control' })
      return r.error
        ? { funciono: false, detalle: `spend_crystals falló también con service_role (${r.error.code ?? '?'})` }
        : { funciono: true, detalle: 'spend_crystals ejecutable por service_role (correcto)' }
    },
  },
  {
    tabla: 'fn:check_rate_limit',
    ataque: 'ejecutar check_rate_limit por RPC (gastar el cupo de un tercero)',
    async ejecutar(anon) {
      const r = await anon.rpc('check_rate_limit', { p_key: 'ataque', p_limit: 1, p_window_seconds: 60 })
      return r.error
        ? { bloqueado: true, detalle: `check_rate_limit: rechazado (${r.error.code ?? '?'})` }
        : { bloqueado: false, detalle: 'FUGA · authenticated pudo ejecutar check_rate_limit' }
    },
    async controlServiceRole(admin) {
      const r = await admin.rpc('check_rate_limit', { p_key: 'control', p_limit: 5, p_window_seconds: 60 })
      return r.error
        ? { funciono: false, detalle: `check_rate_limit falló también con service_role (${r.error.code ?? '?'})` }
        : { funciono: true, detalle: 'check_rate_limit ejecutable por service_role (correcto)' }
    },
  },
  {
    tabla: 'fn:is_refuge_member',
    ataque: 'sondear la pertenencia a un refugio ajeno (debe responder false, nunca la verdad de otro)',
    async ejecutar(anon, ctx) {
      // Es invocable (tiene que serlo, ver la nota de arriba). Lo que se exige
      // es que solo pueda hablar de quien pregunta: para B, el refugio de A es
      // un `false`, igual que un uuid inventado.
      const ajeno = await anon.rpc('is_refuge_member', { p_refuge: ctx.refugioA })
      const fantasma = await anon.rpc('is_refuge_member', { p_refuge: ctx.refugioInexistente })

      if (ajeno.error || fantasma.error) {
        return {
          bloqueado: false,
          detalle:
            `is_refuge_member no es ejecutable por authenticated (${ajeno.error?.code ?? fantasma.error?.code}). ` +
            'Sin ese grant, TODA consulta a refuges falla: revisa 0002_comunidad.sql.',
        }
      }
      if (ajeno.data !== false || fantasma.data !== false) {
        return {
          bloqueado: false,
          detalle: 'FUGA · is_refuge_member revela pertenencias ajenas: se puede sondear si alguien está en una sala',
        }
      }
      return { bloqueado: true, detalle: 'is_refuge_member solo responde sobre quien pregunta (correcto)' }
    },
  },
  {
    tabla: 'fn:is_blocked_with',
    ataque: 'usar is_blocked_with como oráculo de bloqueos ajenos',
    async ejecutar(anon, ctx) {
      const r = await anon.rpc('is_blocked_with', { p_other: ctx.usuarioA.id })
      if (r.error) {
        return {
          bloqueado: false,
          detalle: `is_blocked_with no es ejecutable por authenticated (${r.error.code ?? '?'}); las políticas de kindred fallarán`,
        }
      }
      // Su firma no admite «de quién»: solo puede responder sobre la relación
      // entre quien pregunta y p_other, que es información que ya tiene.
      return { bloqueado: true, detalle: 'is_blocked_with solo habla de la relación propia (correcto)' }
    },
  },
]

/** Todos los casos, en el orden en que importan. */
export const CASOS_RLS: readonly CasoRls[] = [...ATAQUES_NOMBRADOS, ...MATRIZ, ...FUNCIONES]

/** Tablas cubiertas, para el resumen del runner. */
export const TABLAS_CUBIERTAS: readonly string[] = [
  ...new Set(CASOS_RLS.map((c) => c.tabla).filter((t) => !t.startsWith('fn:'))),
]
