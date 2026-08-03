// ============================================================================
// Exportación de datos (art. 15 y 20 RGPD).
//
// ── QUÉ NO VA EN LA EXPORTACIÓN, Y POR QUÉ ─────────────────────────────────
// Las tres exclusiones son decisiones, no olvidos:
//
//  1. `identity_vault.contact_hash`. No es un dato que ayude a nadie —es un
//     HMAC con pimienta de servidor, irreversible incluso para nosotros— y
//     exportarlo debilita la detección de multicuenta: quien lo tuviera podría
//     comprobar si dos cuentas comparten contacto probando candidatos.
//  2. Los alias de terceros que aparezcan en tus hilos. El seudónimo de otra
//     persona es SU dato, no el tuyo.
//  3. Quién escribió los comentarios que recibiste. El texto sí va (se dirigió
//     a ti y forma parte de tu historia); el autor no, porque ese comentario es
//     dato personal DE ESA OTRA PERSONA. Es el punto donde el art. 15.4 —«el
//     derecho de acceso no afectará negativamente a los derechos de otros»— se
//     vuelve concreto.
//
// ── POR QUÉ EL CLIENTE ADMIN Y NO EL DE RLS ────────────────────────────────
// `0001_core.sql` REVOCA el `select` sobre `profiles` y lo devuelve solo sobre
// las columnas públicas: `authenticated` no puede leer su propio
// `karma_spendable`, ni sus `listen_credits`, ni `created_at` de más de una
// forma. Una exportación construida con el cliente RLS saldría incompleta y sin
// que nada avisara. Es una de las tres excepciones que documenta
// `lib/supabase/admin.ts`.
//
// ── RENDIMIENTO ────────────────────────────────────────────────────────────
// Cada bloque es UNA consulta con `limit` explícito y orden por el índice que
// ya existe. Ningún `count(*)`, ningún N+1. Si un bloque llega al tope, la
// exportación se marca como parcial y la solicitud pasa a modo diferido: es
// preferible decirlo a servir un archivo que miente por omisión.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Consentimiento } from './consentimientos.ts'
import { leerConsentimientos } from './consentimientos.ts'

/**
 * Tope de filas por bloque. Por encima de esto la exportación no se sirve en la
 * misma petición: se marca `processing` y se genera fuera de línea. 10 000
 * comentarios son ya un archivo de varios megabytes y una consulta que no
 * conviene meter en el camino de una petición HTTP.
 */
export const TOPE_POR_BLOQUE = 10_000

export interface ExportacionDarma {
  /** Versión del formato. Si algún día cambia la forma, esto lo dice. */
  formato: 1
  generadoEn: string
  perfil: {
    alias: string
    avatarSeed: string
    nivel: string
    karmaReputacion: number
    creadoEn: string
  }
  karma: Array<{ tipo: string; reputacion: number; gastable: number; fecha: string }>
  publicaciones: Array<{ id: string; tipo: string; cuerpo: string; fecha: string; respuestas: number }>
  comentarios: Array<{ id: string; postId: string; cuerpo: string; validado: boolean; fecha: string }>
  /** Comentarios RECIBIDOS: SIN autor. Son datos personales de otra persona. */
  apoyoRecibido: Array<{ postId: string; cuerpo: string; fecha: string }>
  contenidoVisto: Array<{ titulo: string; completado: boolean; fecha: string }>
  cristales: Array<{ delta: number; motivo: string; fecha: string }>
  consentimientos: Consentimiento[]
  solicitudes: Array<{ tipo: 'export' | 'erase'; estado: string; fecha: string }>
  /** Bloques que alcanzaron `TOPE_POR_BLOQUE`. Vacío = exportación completa. */
  bloquesTruncados: string[]
}

/** Las nueve secciones de datos que exige la ficha. El orden es el del contrato. */
export const SECCIONES_EXPORTACION = [
  'perfil',
  'karma',
  'publicaciones',
  'comentarios',
  'apoyoRecibido',
  'contenidoVisto',
  'cristales',
  'consentimientos',
  'solicitudes',
] as const

// ── Formas crudas de las filas ──────────────────────────────────────────────
// Declaradas a mano mientras B15 no regenere `lib/supabase/database.types.ts`
// con las tablas de 0201 (anotado en PEDIDOS.md). En cuanto exista, se
// sustituyen por `Database['public']['Tables'][…]['Row']`.
interface FilaPerfil {
  alias: string
  avatar_seed: string
  level: string
  karma_reputation: number
  created_at: string
}
interface FilaKarma { kind: string; delta_reputation: number; delta_spendable: number; created_at: string }
interface FilaPost { id: string; kind: string; body: string; created_at: string; reply_count: number }
interface FilaComentario { id: string; post_id: string; body: string; is_validated: boolean; created_at: string }
interface FilaApoyo { post_id: string; body: string; created_at: string }
interface FilaVista { completed: boolean; created_at: string; content_items: { title: string } | { title: string }[] | null }
interface FilaCristal { delta: number; reason: string; created_at: string }
interface FilaSolicitud { kind: 'export' | 'erase'; state: string; requested_at: string }

function fallar(bloque: string, error: { message: string } | null): void {
  if (error) throw new Error(`exportacion:${bloque}: ${error.message}`)
}

/**
 * Construye la exportación completa de una persona.
 *
 * @param supabase cliente ADMIN (ver cabecera).
 * @param userId   SIEMPRE de la sesión, nunca del cuerpo de la petición.
 */
export async function construirExportacionCon(
  supabase: SupabaseClient,
  userId: string,
): Promise<ExportacionDarma> {
  const truncados: string[] = []
  const marcarSiTope = (bloque: string, n: number): void => {
    if (n >= TOPE_POR_BLOQUE) truncados.push(bloque)
  }

  // 1 · Perfil. Una fila por PK.
  const perfilRes = await supabase
    .from('profiles')
    .select('alias, avatar_seed, level, karma_reputation, created_at')
    .eq('id', userId)
    .maybeSingle()
  fallar('perfil', perfilRes.error)
  const perfil = perfilRes.data as FilaPerfil | null
  if (!perfil) throw new Error('exportacion:perfil: sin perfil')

  // 2 · Karma. Índice idx_karma_events_user (user_id, created_at desc).
  const karmaRes = await supabase
    .from('karma_events')
    .select('kind, delta_reputation, delta_spendable, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(TOPE_POR_BLOQUE)
  fallar('karma', karmaRes.error)
  const karma = (karmaRes.data ?? []) as FilaKarma[]
  marcarSiTope('karma', karma.length)

  // 3 · Publicaciones. Índice idx_posts_author (author_id, created_at desc).
  const postsRes = await supabase
    .from('posts')
    .select('id, kind, body, created_at, reply_count')
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
    .limit(TOPE_POR_BLOQUE)
  fallar('publicaciones', postsRes.error)
  const posts = (postsRes.data ?? []) as FilaPost[]
  marcarSiTope('publicaciones', posts.length)

  // 4 · Comentarios propios. Índice idx_comments_author.
  const comentariosRes = await supabase
    .from('comments')
    .select('id, post_id, body, is_validated, created_at')
    .eq('author_id', userId)
    .order('created_at', { ascending: false })
    .limit(TOPE_POR_BLOQUE)
  fallar('comentarios', comentariosRes.error)
  const comentarios = (comentariosRes.data ?? []) as FilaComentario[]
  marcarSiTope('comentarios', comentarios.length)

  // 5 · Apoyo recibido. Se seleccionan TRES columnas y ninguna de ellas es
  // `author_id`: la exclusión está en el `select`, no en un filtro posterior.
  // Hacerlo al revés —traer el autor y borrarlo después— es la clase de código
  // donde un refactor futuro deja el dato dentro sin que nadie lo note.
  const idsPosts = posts.map((p) => p.id)
  let apoyo: FilaApoyo[] = []
  if (idsPosts.length > 0) {
    const apoyoRes = await supabase
      .from('comments')
      .select('post_id, body, created_at')
      .in('post_id', idsPosts)
      .neq('author_id', userId)
      .eq('state', 'active')
      .order('created_at', { ascending: false })
      .limit(TOPE_POR_BLOQUE)
    fallar('apoyoRecibido', apoyoRes.error)
    apoyo = (apoyoRes.data ?? []) as FilaApoyo[]
    marcarSiTope('apoyoRecibido', apoyo.length)
  }

  // 6 · Contenido visto. Índice idx_content_views_user.
  const vistasRes = await supabase
    .from('content_views')
    .select('completed, created_at, content_items(title)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(TOPE_POR_BLOQUE)
  fallar('contenidoVisto', vistasRes.error)
  const vistas = (vistasRes.data ?? []) as unknown as FilaVista[]
  marcarSiTope('contenidoVisto', vistas.length)

  // 7 · Cristales. Índice idx_crystal_ledger_user (user_id, id desc).
  const cristalesRes = await supabase
    .from('crystal_ledger')
    .select('delta, reason, created_at')
    .eq('user_id', userId)
    .order('id', { ascending: false })
    .limit(TOPE_POR_BLOQUE)
  fallar('cristales', cristalesRes.error)
  const cristales = (cristalesRes.data ?? []) as FilaCristal[]
  marcarSiTope('cristales', cristales.length)

  // 8 · Consentimientos.
  const consentimientos = await leerConsentimientos(supabase, userId)

  // 9 · Solicitudes previas. Nunca el `token_sha256` ni el `error` interno.
  const solicitudesRes = await supabase
    .from('privacy_requests')
    .select('kind, state, requested_at')
    .eq('user_id', userId)
    .order('requested_at', { ascending: false })
    .limit(200)
  fallar('solicitudes', solicitudesRes.error)
  const solicitudes = (solicitudesRes.data ?? []) as FilaSolicitud[]

  return {
    formato: 1,
    generadoEn: new Date().toISOString(),
    perfil: {
      alias: perfil.alias,
      avatarSeed: perfil.avatar_seed,
      nivel: perfil.level,
      karmaReputacion: perfil.karma_reputation,
      creadoEn: perfil.created_at,
    },
    karma: karma.map((k) => ({
      tipo: k.kind,
      reputacion: k.delta_reputation,
      gastable: k.delta_spendable,
      fecha: k.created_at,
    })),
    publicaciones: posts.map((p) => ({
      id: p.id,
      tipo: p.kind,
      cuerpo: p.body,
      fecha: p.created_at,
      respuestas: p.reply_count,
    })),
    comentarios: comentarios.map((c) => ({
      id: c.id,
      postId: c.post_id,
      cuerpo: c.body,
      validado: c.is_validated,
      fecha: c.created_at,
    })),
    apoyoRecibido: apoyo.map((a) => ({
      postId: a.post_id,
      cuerpo: a.body,
      fecha: a.created_at,
    })),
    contenidoVisto: vistas.map((v) => ({
      titulo: tituloDeContenido(v.content_items),
      completado: v.completed,
      fecha: v.created_at,
    })),
    cristales: cristales.map((c) => ({ delta: c.delta, motivo: c.reason, fecha: c.created_at })),
    consentimientos,
    solicitudes: solicitudes.map((s) => ({ tipo: s.kind, estado: s.state, fecha: s.requested_at })),
    bloquesTruncados: truncados,
  }
}

/** PostgREST devuelve el join como objeto o como array según la cardinalidad
 *  que infiera; se normalizan los dos casos en vez de confiar en uno. */
function tituloDeContenido(valor: FilaVista['content_items']): string {
  if (valor == null) return ''
  if (Array.isArray(valor)) return valor[0]?.title ?? ''
  return valor.title
}

/** Contrato de la ficha. Usa `service_role`: solo desde el servidor. */
export async function construirExportacion(userId: string): Promise<ExportacionDarma> {
  const { createAdminClient } = await import('../supabase/admin.ts')
  return construirExportacionCon(createAdminClient(), userId)
}

/**
 * Comprobación de anonimato sobre el archivo YA construido, antes de servirlo.
 *
 * No filtra ni corrige nada: si la persona escribió su propio teléfono en un
 * post, ese teléfono es suyo y va en su exportación. Lo que hace es DEVOLVER lo
 * que encuentre para que la ruta lo registre, porque un patrón que aparece en
 * muchas exportaciones a la vez no es alguien escribiendo su móvil: es una fuga
 * sistemática y hay que verla.
 *
 * Nunca se ejecuta sobre los `id` ni sobre las fechas, solo sobre los textos.
 */
export function revisarPiiExportacion(
  exportacion: ExportacionDarma,
  detectar: (texto: string) => Array<{ kind: string }>,
): Record<string, number> {
  const textos: string[] = [
    ...exportacion.publicaciones.map((p) => p.cuerpo),
    ...exportacion.comentarios.map((c) => c.cuerpo),
    ...exportacion.apoyoRecibido.map((a) => a.cuerpo),
  ]

  const conteo: Record<string, number> = {}
  for (const texto of textos) {
    for (const hallazgo of detectar(texto)) {
      conteo[hallazgo.kind] = (conteo[hallazgo.kind] ?? 0) + 1
    }
  }
  return conteo
}

/**
 * Serializa la exportación para descarga.
 *
 * Con indentación a propósito: el archivo lo va a abrir una persona, no un
 * script, y un JSON en una sola línea de varios megabytes es ilegible en
 * cualquier editor. El coste en bytes lo absorbe la compresión de la respuesta.
 */
export function serializarExportacion(exportacion: ExportacionDarma): string {
  return JSON.stringify(exportacion, null, 2)
}

/** Nombre del archivo. Sin alias ni id dentro: el nombre de un archivo acaba en
 *  la carpeta de descargas, en una copia de seguridad y en una captura. */
export function nombreArchivoExportacion(fecha = new Date()): string {
  return `darma-mis-datos-${fecha.toISOString().slice(0, 10)}.json`
}
