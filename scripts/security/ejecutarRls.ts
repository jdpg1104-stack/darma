// ============================================================================
// Runner de la suite de RLS
//
// Siembra dos identidades (más una en shadow-ban), abre UNA sesión con la anon
// key, y lanza contra ella todos los casos de `supabase/tests/rls.integracion.ts`.
//
// TRES COSAS QUE ESTE RUNNER HACE Y QUE SON LA RAZÓN DE QUE EXISTA:
//
//  1. ABORTA SI LA CLAVE CONFIGURADA ES `service_role`. Esa llave salta todas
//     las políticas por diseño; una suite que pase con ella no prueba nada y es
//     peor que no tenerla, porque genera confianza falsa. Se decodifica el
//     payload del JWT y se comprueba el `role` ANTES de ejecutar un solo caso.
//
//  2. VERIFICA QUE LA SESIÓN ESTÁ ABIERTA antes de atacar. El fallo típico de
//     una suite de RLS es que `signInWithPassword` falle en silencio, el cliente
//     quede anónimo, la consulta devuelva cero filas y el test cante victoria.
//     Se comprueba que `auth.getUser()` devuelve exactamente el id del usuario B.
//
//  3. EJECUTA EL POSITIVO DE CONTROL. Cada caso crítico repite el mismo ataque
//     con `service_role`: allí TIENE que funcionar. Si falla en los dos casos,
//     el caso está mal escrito (tabla mal deletreada, filtro que no casa) y su
//     «bloqueado» no vale nada.
//
// RENDIMIENTO: los casos se agrupan por tabla y los grupos corren EN PARALELO
// (secuencial dentro del grupo, para que dos casos de la misma tabla no se pisen
// el estado). Objetivo: < 90 s. Una suite lenta es una suite que nadie ejecuta.
//
// El informe describe el ATAQUE, nunca vuelca datos: un log de CI lo ve todo el
// equipo y estas tablas guardan desahogos y la cola de crisis.
//
// USO:
//   node --experimental-strip-types scripts/security/ejecutarRls.ts
//
// VARIABLES:
//   SUPABASE_URL | NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_ANON_KEY | NEXT_PUBLIC_SUPABASE_ANON_KEY
//   SUPABASE_SERVICE_ROLE_KEY   (solo para sembrar y para los controles)
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

import {
  CASOS_RLS,
  TABLAS_CUBIERTAS,
  type CasoRls,
  type ClienteDarma,
  type ContextoPrueba,
  type UsuarioPrueba,
} from '../../supabase/tests/rls.integracion.ts'
import type { Database } from '../../lib/supabase/database.types.ts'

// ── 1. La aserción que protege a toda la suite ──────────────────────────────

export interface VerificacionClave {
  ok: boolean
  mensaje: string
  rol: string | null
}

/** Rol declarado en el payload de un JWT de Supabase. `null` si no se puede leer. */
export function rolDeJwt(token: string): string | null {
  const partes = token.split('.')
  if (partes.length !== 3) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(partes[1]!, 'base64url').toString('utf8'))
    if (typeof payload !== 'object' || payload === null) return null
    const rol = (payload as { role?: unknown }).role
    return typeof rol === 'string' ? rol : null
  } catch {
    return null
  }
}

/**
 * La clave con la que se ataca DEBE ser la anon key.
 *
 * Se acepta también una clave sin `role` legible (formatos nuevos de clave
 * publicable de Supabase, que no son JWT): lo único que se rechaza de forma
 * tajante es un `role: service_role`, porque ése es el que invalida la suite.
 */
export function verificarClaveAnon(clave: string): VerificacionClave {
  if (!clave) {
    return { ok: false, rol: null, mensaje: '[rls] no hay clave anónima configurada (SUPABASE_ANON_KEY).' }
  }

  const rol = rolDeJwt(clave)

  if (rol === 'service_role') {
    return {
      ok: false,
      rol,
      mensaje:
        '[rls] ABORTADO: la clave configurada como anónima tiene `role: service_role`.\n' +
        '      Esa llave SALTA TODAS LAS POLÍTICAS RLS por diseño, así que la suite entera\n' +
        '      pasaría sin probar absolutamente nada — y eso es peor que no tener suite,\n' +
        '      porque genera confianza falsa en el anonimato de la gente.\n' +
        '      Pon la ANON key en SUPABASE_ANON_KEY y vuelve a ejecutar.',
    }
  }

  return { ok: true, rol, mensaje: `[rls] clave anónima verificada (role=${rol ?? 'no declarado'}).` }
}

// ── 2. Siembra ──────────────────────────────────────────────────────────────

const CUERPO_POST = 'Texto sembrado para la suite de RLS, con longitud suficiente para el check de la tabla.'
const CUERPO_COMENTARIO =
  'Comentario sembrado para la suite de RLS, con longitud suficiente para superar el check de comments.'

function nuevoUsuario(sufijo: string): UsuarioPrueba {
  return {
    id: '',
    email: `rls-${sufijo}-${randomUUID().slice(0, 8)}@darma.test`,
    password: `Rls-${randomUUID()}`,
  }
}

async function crearIdentidad(admin: ClienteDarma, u: UsuarioPrueba, alias: string, shadow = false): Promise<void> {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`no se pudo crear ${u.email}: ${error?.message}`)
  u.id = data.user.id

  const perfil = await admin.from('profiles').insert({
    id: u.id,
    alias,
    // Crédito de sobra para que la siembra pueda insertar posts sin que el gate
    // 3:1 la bloquee. El usuario B se queda a cero a propósito: es lo que hace
    // que su segundo post muera en `trg_posts_reciprocity`.
    listen_credits: shadow || alias.startsWith('atacante') ? 0 : 99,
    shadow_banned: shadow,
  })
  if (perfil.error) throw new Error(`no se pudo crear el perfil de ${alias}: ${perfil.error.message}`)
}

async function sembrar(admin: ClienteDarma): Promise<ContextoPrueba> {
  const usuarioA = nuevoUsuario('a')
  const usuarioB = nuevoUsuario('b')
  const usuarioSombra = nuevoUsuario('s')

  await crearIdentidad(admin, usuarioA, `victima_${randomUUID().slice(0, 6)}`)
  await crearIdentidad(admin, usuarioB, `atacante_${randomUUID().slice(0, 6)}`)
  await crearIdentidad(admin, usuarioSombra, `sombra_${randomUUID().slice(0, 6)}`, true)

  const post = await admin
    .from('posts')
    .insert({ author_id: usuarioA.id, body: CUERPO_POST })
    .select('id')
    .single()
  if (post.error) throw new Error(`siembra de posts: ${post.error.message}`)

  const postSombra = await admin
    .from('posts')
    .insert({ author_id: usuarioSombra.id, body: `${CUERPO_POST} Sombra.` })
    .select('id')
    .single()
  if (postSombra.error) throw new Error(`siembra de post en shadow-ban: ${postSombra.error.message}`)

  const comentario = await admin
    .from('comments')
    .insert({ post_id: post.data.id, author_id: usuarioA.id, body: CUERPO_COMENTARIO })
    .select('id')
    .single()
  if (comentario.error) throw new Error(`siembra de comments: ${comentario.error.message}`)

  // Refugio de A (B no es miembro) + un mensaje dentro.
  const refugioA = await admin
    .from('refuges')
    .insert({ created_by: usuarioA.id, title: 'sala A' })
    .select('id')
    .single()
  if (refugioA.error) throw new Error(`siembra de refuges: ${refugioA.error.message}`)

  await admin.from('refuge_members').insert({ refuge_id: refugioA.data.id, user_id: usuarioA.id, is_host: true })

  const mensaje = await admin
    .from('refuge_messages')
    .insert({
      refuge_id: refugioA.data.id,
      sender_id: usuarioA.id,
      ciphertext: '\\xdeadbeefdeadbeef',
      nonce: '\\x000102030405060708090a0b',
    })
    .select('id')
    .single()
  if (mensaje.error) throw new Error(`siembra de refuge_messages: ${mensaje.error.message}`)

  // Refugio propio de B: hace falta para los casos de «columna prohibida en la
  // sala propia», que son los que separan política de fila de privilegio de
  // columna.
  const refugioB = await admin
    .from('refuges')
    .insert({ created_by: usuarioB.id, title: 'sala B' })
    .select('id')
    .single()
  if (refugioB.error) throw new Error(`siembra de refugio de B: ${refugioB.error.message}`)
  await admin.from('refuge_members').insert({ refuge_id: refugioB.data.id, user_id: usuarioB.id, is_host: true })

  const aprobado = await admin
    .from('content_items')
    .insert({
      source: 'siembra',
      platform: 'internal',
      external_id: `ok-${randomUUID()}`,
      title: 'Contenido aprobado de prueba',
      url: 'https://example.invalid/aprobado',
      state: 'approved',
    })
    .select('id')
    .single()
  if (aprobado.error) throw new Error(`siembra de content_items: ${aprobado.error.message}`)

  const pendiente = await admin
    .from('content_items')
    .insert({
      source: 'siembra',
      platform: 'internal',
      external_id: `pend-${randomUUID()}`,
      title: 'Contenido pendiente de revisión',
      url: 'https://example.invalid/pendiente',
      state: 'pending',
    })
    .select('id')
    .single()
  if (pendiente.error) throw new Error(`siembra de content_items pendiente: ${pendiente.error.message}`)

  const encuesta = await admin
    .from('polls')
    .insert({ author_id: usuarioA.id, question: '¿Alguien más se siente así?' })
    .select('id')
    .single()
  if (encuesta.error) throw new Error(`siembra de polls: ${encuesta.error.message}`)

  const opcion = await admin
    .from('poll_options')
    .insert({ poll_id: encuesta.data.id, ordinal: 0, label: 'Sí' })
    .select('id')
    .single()
  if (opcion.error) throw new Error(`siembra de poll_options: ${opcion.error.message}`)

  // Filas PROPIAS de B: sin ellas, los casos de «update/delete revocado sobre lo
  // propio» devolverían 0 filas por no encontrar nada y pasarían por la razón
  // equivocada. Es la trampa nº 2 de la ficha, aplicada a la siembra.
  await admin.from('poll_votes').insert({ poll_id: encuesta.data.id, option_id: opcion.data.id, user_id: usuarioB.id })
  await admin.from('kindred').insert({ owner_id: usuarioB.id, kindred_id: usuarioSombra.id, note: 'nota propia' })
  await admin.from('blocks').insert({ blocker_id: usuarioB.id, blocked_id: usuarioSombra.id })
  await admin.from('blocks').insert({ blocker_id: usuarioA.id, blocked_id: usuarioB.id })
  await admin.from('kindred').insert({ owner_id: usuarioA.id, kindred_id: usuarioSombra.id })
  await admin
    .from('crystal_ledger')
    .insert({ user_id: usuarioA.id, delta: 100, reason: 'siembra', source: 'grant' })
  await admin
    .from('crystal_ledger')
    .insert({ user_id: usuarioB.id, delta: 100, reason: 'siembra', source: 'grant' })
  await admin.from('profiles').update({ crystals: 100, karma_spendable: 100 }).eq('id', usuarioA.id)

  return {
    usuarioA,
    usuarioB,
    usuarioSombra,
    postA: post.data.id,
    postSombra: postSombra.data.id,
    comentarioA: comentario.data.id,
    refugioA: refugioA.data.id,
    mensajeA: mensaje.data.id,
    refugioB: refugioB.data.id,
    contenidoAprobado: aprobado.data.id,
    contenidoPendiente: pendiente.data.id,
    encuestaA: encuesta.data.id,
    opcionA: opcion.data.id,
    refugioInexistente: randomUUID(),
  }
}

async function limpiar(admin: ClienteDarma, ctx: ContextoPrueba): Promise<void> {
  // `on delete cascade` desde auth.users se lleva perfiles, posts, refugios y
  // todo lo demás. Best-effort: un fallo aquí no debe cambiar el veredicto.
  for (const u of [ctx.usuarioA, ctx.usuarioB, ctx.usuarioSombra]) {
    if (!u.id) continue
    try {
      await admin.auth.admin.deleteUser(u.id)
    } catch {
      // ignorado a propósito
    }
  }
}

// ── 3. Ejecución ────────────────────────────────────────────────────────────

export interface ResultadoCaso {
  tabla: string
  ataque: string
  bloqueado: boolean
  detalle: string
  /** `null` si el caso no define positivo de control. */
  control: { funciono: boolean; detalle: string } | null
  regresion?: string
  ms: number
}

function agrupar(casos: readonly CasoRls[]): Map<string, CasoRls[]> {
  const grupos = new Map<string, CasoRls[]>()
  for (const c of casos) {
    const lista = grupos.get(c.tabla)
    if (lista) lista.push(c)
    else grupos.set(c.tabla, [c])
  }
  return grupos
}

async function ejecutarGrupo(
  casos: readonly CasoRls[],
  anon: ClienteDarma,
  admin: ClienteDarma,
  ctx: ContextoPrueba,
): Promise<ResultadoCaso[]> {
  const out: ResultadoCaso[] = []

  for (const caso of casos) {
    const t0 = Date.now()
    let bloqueado = false
    let detalle = ''
    try {
      const r = await caso.ejecutar(anon, ctx)
      bloqueado = r.bloqueado
      detalle = r.detalle
    } catch (e) {
      // Una excepción del cliente no es un «bloqueado»: puede ser un caso mal
      // escrito. Se reporta como fallo para que alguien lo mire.
      bloqueado = false
      detalle = `EXCEPCIÓN en el caso: ${(e as Error).message}`
    }

    let control: ResultadoCaso['control'] = null
    if (caso.controlServiceRole) {
      try {
        control = await caso.controlServiceRole(admin, ctx)
      } catch (e) {
        control = { funciono: false, detalle: `EXCEPCIÓN en el control: ${(e as Error).message}` }
      }
    }

    out.push({
      tabla: caso.tabla,
      ataque: caso.ataque,
      bloqueado,
      detalle,
      control,
      regresion: caso.regresion,
      ms: Date.now() - t0,
    })
  }

  return out
}

export interface Informe {
  ok: boolean
  resultados: ResultadoCaso[]
  ms: number
}

export function formatearInforme(inf: Informe): string {
  const fallos = inf.resultados.filter((r) => !r.bloqueado)
  const controlesRotos = inf.resultados.filter((r) => r.control !== null && !r.control.funciono)
  const regresiones = fallos.filter((r) => r.regresion)

  const lineas: string[] = []
  lineas.push('')
  lineas.push('─'.repeat(78))
  lineas.push(
    `[rls] ${inf.resultados.length} casos · ${TABLAS_CUBIERTAS.length} tablas · ${(inf.ms / 1000).toFixed(1)} s`,
  )
  lineas.push('─'.repeat(78))

  if (fallos.length === 0 && controlesRotos.length === 0) {
    lineas.push('✓ Todos los ataques quedaron bloqueados y todos los positivos de control funcionaron.')
    return lineas.join('\n')
  }

  if (regresiones.length > 0) {
    lineas.push('')
    lineas.push(`⚠ ${regresiones.length} REGRESIÓN(ES): un agujero ya cerrado ha vuelto a abrirse.`)
    for (const r of regresiones) lineas.push(`    · ${r.regresion}`)
  }

  if (fallos.length > 0) {
    lineas.push('')
    lineas.push(`✗ ${fallos.length} ataque(s) NO bloqueado(s):`)
    for (const f of fallos) {
      lineas.push(`    [${f.tabla}] ${f.ataque}`)
      lineas.push(`        ${f.detalle}`)
    }
  }

  if (controlesRotos.length > 0) {
    lineas.push('')
    lineas.push(`✗ ${controlesRotos.length} positivo(s) de control roto(s).`)
    lineas.push('  El ataque falló TAMBIÉN con service_role: el caso puede estar mal escrito')
    lineas.push('  (tabla mal deletreada, filtro que no casa, sesión sin abrir) y su «bloqueado»')
    lineas.push('  no demuestra nada. Arregla el caso ANTES de dar por buena la política.')
    for (const c of controlesRotos) {
      lineas.push(`    [${c.tabla}] ${c.ataque}`)
      lineas.push(`        ${c.control?.detalle}`)
    }
  }

  return lineas.join('\n')
}

export async function ejecutarSuite(): Promise<Informe> {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

  if (!url) throw new Error('[rls] falta SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL.')

  // ── La aserción de arranque. Antes de nada. ───────────────────────────────
  const verificacion = verificarClaveAnon(anonKey)
  if (!verificacion.ok) throw new Error(verificacion.mensaje)
  console.error(verificacion.mensaje)

  if (!serviceKey) throw new Error('[rls] falta SUPABASE_SERVICE_ROLE_KEY (solo para sembrar y para los controles).')
  if (rolDeJwt(serviceKey) !== 'service_role') {
    console.error('[rls] aviso: SUPABASE_SERVICE_ROLE_KEY no declara role=service_role; la siembra puede fallar.')
  }

  const admin = createClient<Database>(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })

  const t0 = Date.now()
  const ctx = await sembrar(admin)

  try {
    const anon = createClient<Database>(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })

    const sesion = await anon.auth.signInWithPassword({
      email: ctx.usuarioB.email,
      password: ctx.usuarioB.password,
    })
    if (sesion.error) throw new Error(`[rls] no se pudo abrir sesión como usuario B: ${sesion.error.message}`)

    // Trampa nº 2 de la ficha: si el login falla en silencio, el cliente queda
    // anónimo, todo devuelve cero filas y la suite canta victoria sin haber
    // probado una sola política.
    const quien = await anon.auth.getUser()
    if (quien.error || quien.data.user?.id !== ctx.usuarioB.id) {
      throw new Error(
        '[rls] la sesión del usuario B NO está activa. Sin sesión, todas las consultas devuelven ' +
          'cero filas y la suite pasaría sin probar nada.',
      )
    }
    console.error(`[rls] sesión de usuario B verificada (${ctx.usuarioB.id}).`)

    const grupos = [...agrupar(CASOS_RLS).values()]
    const porGrupo = await Promise.all(grupos.map((g) => ejecutarGrupo(g, anon, admin, ctx)))
    const resultados = porGrupo.flat()

    await anon.auth.signOut()

    const ok =
      resultados.every((r) => r.bloqueado) && resultados.every((r) => r.control === null || r.control.funciono)

    return { ok, resultados, ms: Date.now() - t0 }
  } finally {
    await limpiar(admin, ctx)
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const informe = await ejecutarSuite()
    console.error(formatearInforme(informe))
    process.exit(informe.ok ? 0 : 1)
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
