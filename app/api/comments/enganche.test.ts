// ============================================================================
// Pruebas del ENGANCHE del ValidadorIA al POST de comentarios (B04 ⇄ B11)
//
//   node --test --experimental-strip-types "app/api/comments/enganche.test.ts"
//
// SIN red y sin MODERATION_API_KEY: el cliente del clasificador y el admin se
// inyectan siempre (mismos dobles que `validador.test.ts` y
// `lib/ai/pipeline.test.ts`). Lo que se fija aquí es el contrato del enganche:
//
//   · el contexto completo (autorId, refId, admin, pais) llega hasta el
//     pipeline — la fila de `crisis_events` lo demuestra campo a campo;
//   · la crisis se registra UNA sola vez: la del pipeline cuando corre, la de
//     la ruta cuando no (sin clave, o con el suelo heurístico en contra);
//   · un fallo del validador (proveedor caído, admin roto) JAMÁS lanza, así
//     que no puede romper la publicación del comentario.
//
// La parte que vive en `route.ts` no se puede importar aquí (arrastra imports
// `@/` que node --test no resuelve), así que se vigila igual que hace
// `hilo.test.ts` con sus salvaguardas: leyendo el fuente y afirmando sobre él.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  ValidadorHeuristico,
  ValidadorIA,
  type ContextoValidacionIA,
} from './validador.ts'
import { evaluar, registrar } from './crisisHilo.ts'
import type { ClienteIA, RespuestaIA } from '../../../lib/ai/cliente.ts'

// ── Dobles ──────────────────────────────────────────────────────────────────

interface AdminFalso {
  admin: SupabaseClient
  inserts: { tabla: string; fila: Record<string, unknown> }[]
  /** Tablas consultadas con select(), para vigilar que no se toque el vault. */
  selects: string[]
}

/** Doble de Supabase que registra los inserts en memoria (patrón de B11). */
function adminFalso(): AdminFalso {
  const inserts: { tabla: string; fila: Record<string, unknown> }[] = []
  const selects: string[] = []
  const admin = {
    from(tabla: string) {
      return {
        async insert(fila: Record<string, unknown>) {
          inserts.push({ tabla, fila })
          return { data: null, error: null }
        },
        select() {
          selects.push(tabla)
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: null, error: null }
                },
              }
            },
          }
        },
      }
    },
    async rpc() {
      return { data: true, error: null }
    },
  }
  return { admin: admin as unknown as SupabaseClient, inserts, selects }
}

/** Doble en el que TODO Postgres está caído: cada llamada rechaza. */
function adminRoto(): SupabaseClient {
  const caida = async (): Promise<never> => {
    throw new Error('postgres caído')
  }
  const admin = {
    from() {
      return {
        insert: caida,
        select() {
          return {
            eq() {
              return { maybeSingle: caida }
            },
          }
        },
      }
    },
    rpc: caida,
  }
  return admin as unknown as SupabaseClient
}

interface Espia {
  cliente: ClienteIA
  invocaciones: number
}

function clienteFalso(respuesta: RespuestaIA | (() => never)): Espia {
  const espia: Espia = {
    invocaciones: 0,
    cliente: {
      messages: {
        async create() {
          espia.invocaciones++
          if (typeof respuesta === 'function') respuesta()
          return respuesta as RespuestaIA
        },
      },
    },
  }
  return espia
}

function respuesta(objeto: unknown): RespuestaIA {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(objeto) }],
    usage: { input_tokens: 250, output_tokens: 120, cache_read_input_tokens: 1200 },
  }
}

/** Ejecuta `fn` garantizando que NO hay MODERATION_API_KEY en el entorno. */
async function sinClave(fn: () => Promise<void>): Promise<void> {
  const previa = process.env.MODERATION_API_KEY
  delete process.env.MODERATION_API_KEY
  try {
    await fn()
  } finally {
    if (previa !== undefined) process.env.MODERATION_API_KEY = previa
  }
}

/**
 * La decisión de `route.ts`, reproducida literalmente para poder ejecutar la
 * SECUENCIA de la ruta con dobles. Si esta expresión y la de la ruta divergen,
 * el test del fuente (abajo) es el que lo detecta.
 */
function laRegistraElPipeline(opciones: {
  hayTarjeta: boolean
  hayClave: boolean
  sueloValido: boolean
}): boolean {
  return opciones.hayTarjeta && opciones.hayClave && opciones.sueloValido
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const AUTOR = '11111111-2222-3333-4444-555555555555'
const COMENTARIO_ID = '99999999-8888-4777-8666-555555555555'

const POST_AJENO =
  'Llevo unas semanas sin ganas de nada y me cuesta hasta levantarme para ir ' +
  'a clase; no sé ni por dónde empezar a contarlo.'

/** Pasa la criba heurística: largo, diverso y sin frases hechas dominantes. */
const COMENTARIO_BUENO =
  'A mí me pasó algo parecido cuando cambié de trabajo el año pasado y lo que ' +
  'me sirvió fue apuntar cada noche una cosa concreta que hubiera salido bien, ' +
  'por pequeña que fuera. ¿Has podido hablarlo con alguien de tu entorno?'

/** Pasa la criba de calidad Y dispara `es_ideation` (riesgo high). */
const COMENTARIO_CRISIS =
  'Leyéndote me he visto muy reflejado: yo también pienso en suicidarme ' +
  'algunos días y sé lo mucho que pesa callarlo. A mí me sirvió contárselo a ' +
  'mi médica de cabecera. ¿Has podido pedir cita o decírselo a alguien cercano?'

/** La criba lo tumba (relleno) pero la señal de crisis está dentro. */
const RELLENO_CON_CRISIS =
  'ánimo ánimo ánimo fuerza fuerza fuerza me quiero morir un abrazo un abrazo suerte suerte'

function contextoCompleto(admin: SupabaseClient): ContextoValidacionIA {
  return {
    postBody: POST_AJENO,
    autorId: AUTOR,
    refId: COMENTARIO_ID,
    admin,
    pais: 'ES',
  }
}

// ── 1. El contexto completo llega hasta el pipeline ─────────────────────────

test('el contexto completo llega al pipeline: la fila de crisis lo demuestra campo a campo', async () => {
  const bd = adminFalso()
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.9, riesgo: 'none', motivo: 'Habla desde su experiencia.' }),
  )
  const validador = new ValidadorIA({ cliente: espia.cliente })

  const veredicto = await validador.validar(COMENTARIO_CRISIS, contextoCompleto(bd.admin))

  assert.equal(espia.invocaciones, 1, 'con autorId de sesión el pipeline corre de verdad')
  assert.equal(veredicto.valido, true)

  const eventos = bd.inserts.filter((i) => i.tabla === 'crisis_events')
  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].fila.user_id, AUTOR, 'autorId: siempre el uuid de la sesión')
  assert.equal(eventos[0].fila.ref_id, COMENTARIO_ID, 'refId: el comentario YA insertado')
  assert.equal(eventos[0].fila.ref_type, 'comment')
  assert.equal(eventos[0].fila.country_code, 'ES', 'el país del borde llega hasta la fila')
  // Con `pais` en el contexto, el pipeline NO viaja a identity_vault.
  assert.ok(!bd.selects.includes('identity_vault'), 'el país resuelto evita identity_vault')
})

// ── 2. La crisis se registra UNA vez, quien corresponda ─────────────────────

test('con clave y suelo a favor: UNA fila de crisis — la del pipeline, no la de la ruta', async () => {
  const bd = adminFalso()
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.85, riesgo: 'none', motivo: 'Acompaña de verdad.' }),
  )
  const contexto = contextoCompleto(bd.admin)

  // La secuencia de route.ts, con sus mismas piezas:
  const evaluacion = evaluar(COMENTARIO_CRISIS, 'ES')
  assert.notEqual(evaluacion.tarjeta, null, 'las reglas ven la crisis: habría algo que registrar')
  const suelo = await new ValidadorHeuristico().validar(COMENTARIO_CRISIS, contexto)
  const decision = laRegistraElPipeline({
    hayTarjeta: evaluacion.tarjeta !== null,
    hayClave: true, // en la ruta: hayClaveIA(); aquí el cliente va inyectado
    sueloValido: suelo.valido,
  })
  assert.equal(decision, true)
  if (!decision) await registrar(bd.admin, evaluacion, AUTOR, COMENTARIO_ID, 'ES')

  await new ValidadorIA({ cliente: espia.cliente }).validar(COMENTARIO_CRISIS, contexto)

  const eventos = bd.inserts.filter((i) => i.tabla === 'crisis_events')
  assert.equal(eventos.length, 1, 'ni cero filas (crisis perdida) ni dos (duplicada)')
  assert.equal(eventos[0].fila.risk, 'high')
})

test('sin clave (el estado real de hoy): el validador no escribe crisis y registra la ruta', async () => {
  await sinClave(async () => {
    const bd = adminFalso()
    const contexto = contextoCompleto(bd.admin)

    // Sin clave y sin cliente inyectado, el validador es la heurística pura.
    const veredicto = await new ValidadorIA().validar(COMENTARIO_CRISIS, contexto)
    assert.equal(veredicto.valido, true)
    assert.equal(
      bd.inserts.filter((i) => i.tabla === 'crisis_events').length,
      0,
      'el pipeline no corrió: nadie ha registrado la crisis todavía',
    )

    // …así que el registro de la ruta DEBE seguir en pie:
    const evaluacion = evaluar(COMENTARIO_CRISIS, 'ES')
    const suelo = await new ValidadorHeuristico().validar(COMENTARIO_CRISIS, contexto)
    const decision = laRegistraElPipeline({
      hayTarjeta: evaluacion.tarjeta !== null,
      hayClave: false,
      sueloValido: suelo.valido,
    })
    assert.equal(decision, false)
    await registrar(bd.admin, evaluacion, AUTOR, COMENTARIO_ID, 'ES')

    const eventos = bd.inserts.filter((i) => i.tabla === 'crisis_events')
    assert.equal(eventos.length, 1)
    assert.equal(eventos[0].fila.ref_type, 'comment')
    assert.equal(eventos[0].fila.risk, 'high')
    assert.deepEqual(
      eventos[0].fila.resources_shown,
      evaluacion.tarjeta!.recursos.map((r) => r.name),
      'se guarda QUÉ se mostró, no solo que se detectó',
    )
  })
})

test('suelo en contra + señal de crisis: el pipeline no corre y el registro es de la ruta', async () => {
  const bd = adminFalso()
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.9, riesgo: 'none', motivo: 'No debería llamarse.' }),
  )
  const contexto = contextoCompleto(bd.admin)

  const suelo = await new ValidadorHeuristico().validar(RELLENO_CON_CRISIS, contexto)
  assert.equal(suelo.valido, false, 'la criba tumba el relleno')
  const evaluacion = evaluar(RELLENO_CON_CRISIS, 'ES')
  assert.notEqual(evaluacion.tarjeta, null, 'pero la señal de crisis está ahí y no puede perderse')

  const decision = laRegistraElPipeline({
    hayTarjeta: evaluacion.tarjeta !== null,
    hayClave: true,
    sueloValido: suelo.valido,
  })
  assert.equal(decision, false)
  await registrar(bd.admin, evaluacion, AUTOR, COMENTARIO_ID, 'ES')
  await new ValidadorIA({ cliente: espia.cliente }).validar(RELLENO_CON_CRISIS, contexto)

  assert.equal(espia.invocaciones, 0, 'el rechazo heurístico no gasta una llamada de pago')
  const eventos = bd.inserts.filter((i) => i.tabla === 'crisis_events')
  assert.equal(eventos.length, 1, 'exactamente una fila: la de la ruta')
})

// ── 3. Un fallo del validador no puede romper la publicación ────────────────

test('FALLO: proveedor caído Y admin roto — validar() resuelve con la heurística, no lanza', async () => {
  const espia = clienteFalso(() => {
    throw new Error('proveedor caído')
  })
  const contexto: ContextoValidacionIA = {
    autorId: AUTOR,
    refId: COMENTARIO_ID,
    admin: adminRoto(),
    pais: 'ES',
  }

  // Si esto lanzara, el POST devolvería error_interno con el comentario YA
  // insertado: publicado pero sin respuesta. Por eso el contrato es NO lanzar.
  const veredicto = await new ValidadorIA({ cliente: espia.cliente }).validar(
    COMENTARIO_BUENO,
    contexto,
  )

  assert.equal(espia.invocaciones, 1, 'sí se intentó clasificar')
  assert.deepEqual(veredicto, await new ValidadorHeuristico().validar(COMENTARIO_BUENO))
})

// ── 4. La parte de route.ts, vigilada sobre el fuente ───────────────────────

const AQUI = import.meta.dirname

test('route.ts construye el contexto COMPLETO y se lo pasa al validador', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  const inicio = fuente.indexOf('ContextoValidacionIA = {')
  assert.ok(inicio > -1, 'la ruta declara el contexto con su tipo de B11')
  const bloque = fuente.slice(inicio, fuente.indexOf('}', inicio))

  assert.ok(bloque.includes('postBody: post.body'), 'el eco del post se sigue detectando')
  assert.ok(bloque.includes('autorId: userId'), 'SIEMPRE el uuid de la sesión, jamás del body')
  assert.ok(bloque.includes('refId: creado.id'), 'el uuid del comentario YA insertado')
  assert.match(bloque, /\badmin\b/, 'el admin de la ruta viaja al pipeline')
  assert.match(bloque, /\bpais\b/, 'el país del borde viaja al pipeline')

  assert.match(
    fuente,
    /validadorPorDefecto\.validar\(entrada\.body,\s*contextoIA\)/,
    'y ese contexto es el que recibe el validador',
  )
})

test('route.ts registra la crisis UNA vez: registrar() está detrás del guard del pipeline', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  assert.match(fuente, /hayClaveIA\(\)/, 'la decisión mira si el pipeline puede correr')
  assert.equal(
    (fuente.match(/await registrar\(/g) ?? []).length,
    1,
    'una única llamada a registrar() en toda la ruta',
  )
  assert.match(
    fuente,
    /if\s*\(!laRegistraElPipeline\)\s*\{\s*await registrar\(/,
    'y va condicionada a que el pipeline NO cubra el registro',
  )
})
