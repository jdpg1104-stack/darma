// ============================================================================
// B11 · Pruebas del pipeline
//
// Lo que se prueba aquí es LA DEGRADACIÓN SEGURA, que es donde vive el valor
// del bloque: cerrado en la economía, abierto en la voz. Ninguna prueba toca
// la red ni exige MODERATION_API_KEY.
//
// El doble de Supabase es un objeto que registra los inserts en memoria. No se
// intenta emular PostgREST: lo que hay que comprobar es QUÉ filas se escriben
// y en qué tabla, no cómo las serializa el cliente.
// ============================================================================

import { test } from 'node:test'
import assert from 'node:assert/strict'

import { evaluarContenido, type DepsPipeline } from './pipeline.ts'
import { construirFilaAuditoria } from './auditoria.ts'
import { evaluarPresupuesto } from './presupuesto.ts'
import { decidirSancion, deltaDeSancion } from './sancion.ts'
import { parsearSemillaSuperadmin, ROL_MINIMO_MODERACION } from './acceso.ts'
import { cumpleRol } from '../../app/(admin)/_lib/acceso.ts'
import { construirTarjeta, recursosMostrados, recursosVerificados } from './recursos.ts'
import { USO_CERO } from './modelo.ts'
import { KARMA_WEIGHTS } from '../karma.ts'
import type { ClienteIA, RespuestaIA } from './cliente.ts'
import type { SupabaseClient } from '@supabase/supabase-js'

// ── Dobles ──────────────────────────────────────────────────────────────────

interface AdminFalso {
  admin: SupabaseClient
  inserts: { tabla: string; fila: Record<string, unknown> }[]
  rpc: string[]
}

function adminFalso(): AdminFalso {
  const inserts: { tabla: string; fila: Record<string, unknown> }[] = []
  const rpc: string[] = []
  const admin = {
    from(tabla: string) {
      return {
        async insert(fila: Record<string, unknown>) {
          inserts.push({ tabla, fila })
          return { data: null, error: null }
        },
        select() {
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
    async rpc(nombre: string) {
      rpc.push(nombre)
      return { data: true, error: null }
    },
  }
  return { admin: admin as unknown as SupabaseClient, inserts, rpc }
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

const AUTOR = '11111111-2222-3333-4444-555555555555'

/** Comentario largo, específico y sin frases hechas: pasa la criba de reglas. */
const COMENTARIO_BUENO =
  'A mí me pasó algo parecido cuando cambié de trabajo el año pasado y lo que ' +
  'me sirvió fue apuntar cada noche una cosa concreta que hubiera salido bien, ' +
  'por pequeña que fuera. ¿Has podido hablarlo con alguien de tu entorno?'

function depsBase(extra: Partial<DepsPipeline> = {}): DepsPipeline {
  return {
    // El país se pasa resuelto para no tocar identity_vault en las pruebas.
    paisConocido: 'ES',
    omitirLimiteUsuario: true,
    leerContador: async () => 0,
    incrementar: async () => true,
    ...extra,
  }
}

// ── 2. Comentario válido ────────────────────────────────────────────────────

test('comentario válido: validado, riesgo none y sin tarjeta', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.9, riesgo: 'none', motivo: 'Aporta experiencia propia.' }),
  )
  const salida = await evaluarContenido(
    { texto: COMENTARIO_BUENO, tipo: 'comment', autorId: AUTOR, refId: undefined },
    depsBase({ cliente: espia.cliente }),
  )
  assert.equal(salida.publicable, true)
  assert.equal(salida.validado, true)
  assert.equal(salida.riesgo, 'none')
  assert.equal(salida.tarjetaAyuda, null)
  assert.equal(salida.degradado, false)
})

// ── 3. Riesgo critical por reglas ───────────────────────────────────────────

test('crisis por reglas: se escribe crisis_events y viene la tarjeta', async () => {
  const bd = adminFalso()
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.8, riesgo: 'none', motivo: 'Desahogo.' }),
  )
  const salida = await evaluarContenido(
    {
      texto: 'Esta noche voy a acabar con todo, ya lo tengo decidido y me despido.',
      tipo: 'post',
      autorId: AUTOR,
    },
    depsBase({ cliente: espia.cliente, admin: bd.admin }),
  )

  assert.equal(salida.riesgo, 'critical')
  assert.notEqual(salida.tarjetaAyuda, null)
  assert.ok((salida.tarjetaAyuda?.recursos.length ?? 0) > 0, 'la tarjeta nunca puede venir vacía')

  const eventos = bd.inserts.filter((i) => i.tabla === 'crisis_events')
  assert.equal(eventos.length, 1)
  assert.equal(eventos[0].fila.risk, 'critical')
  assert.equal(eventos[0].fila.country_code, 'ES')
  assert.ok(Array.isArray(eventos[0].fila.resources_shown))
})

test('la crisis se registra ANTES de la llamada al clasificador', async () => {
  const bd = adminFalso()
  // Cliente que revienta: si el registro dependiera de él, no habría fila.
  const espia = clienteFalso(() => {
    throw new Error('proveedor caído')
  })
  const salida = await evaluarContenido(
    { texto: 'Quiero morirme y no le veo salida a nada.', tipo: 'post', autorId: AUTOR },
    depsBase({ cliente: espia.cliente, admin: bd.admin }),
  )
  assert.equal(espia.invocaciones, 1, 'sí se intentó clasificar')
  assert.ok(bd.inserts.some((i) => i.tabla === 'crisis_events'), 'la crisis se registró igualmente')
  assert.notEqual(salida.tarjetaAyuda, null)
  assert.equal(salida.publicable, true, 'la crisis se prioriza, no se censura')
})

// ── 4. Sin MODERATION_API_KEY ───────────────────────────────────────────────

test('SIN CLAVE: se publica, NO se valida, se marca degradado y se abre flag', async () => {
  const previa = process.env.MODERATION_API_KEY
  delete process.env.MODERATION_API_KEY
  const bd = adminFalso()
  try {
    const salida = await evaluarContenido(
      { texto: COMENTARIO_BUENO, tipo: 'comment', autorId: AUTOR },
      depsBase({ admin: bd.admin }), // sin `cliente`: exactamente el estado real de hoy
    )
    assert.equal(salida.publicable, true, 'la voz falla ABIERTA')
    assert.equal(salida.validado, false, 'la economía falla CERRADA')
    assert.equal(salida.degradado, true)

    const flags = bd.inserts.filter((i) => i.tabla === 'moderation_flags')
    assert.equal(flags.length, 1)
    assert.equal(flags[0].fila.signal, 'ai_unavailable')
    assert.equal(flags[0].fila.severity, 3)
    assert.equal(flags[0].fila.state, 'pending', 'un humano tiene que repasarlo')
  } finally {
    if (previa !== undefined) process.env.MODERATION_API_KEY = previa
  }
})

test('SIN CLAVE y con señal de riesgo: la tarjeta sigue apareciendo', async () => {
  const previa = process.env.MODERATION_API_KEY
  delete process.env.MODERATION_API_KEY
  const bd = adminFalso()
  try {
    const salida = await evaluarContenido(
      { texto: 'No aguanto más, quiero quitarme la vida.', tipo: 'post', autorId: AUTOR },
      depsBase({ admin: bd.admin }),
    )
    assert.equal(salida.riesgo, 'high')
    assert.notEqual(salida.tarjetaAyuda, null)
    assert.ok(bd.inserts.some((i) => i.tabla === 'crisis_events'))
    assert.equal(salida.publicable, true)
    assert.equal(salida.validado, false)
  } finally {
    if (previa !== undefined) process.env.MODERATION_API_KEY = previa
  }
})

test('degradación sin señal de reglas: el riesgo sube a low, no se queda en none', async () => {
  const espia = clienteFalso({ stop_reason: 'end_turn', content: [] })
  const salida = await evaluarContenido(
    { texto: COMENTARIO_BUENO, tipo: 'comment', autorId: AUTOR },
    depsBase({ cliente: espia.cliente }),
  )
  assert.equal(salida.degradado, true)
  assert.equal(salida.riesgo, 'low', 'no saber es peor que saber que no hay nada')
  assert.equal(salida.tarjetaAyuda, null, "'low' no bloquea ni encola a nadie")
})

// ── 9. Escalada unidireccional, extremo a extremo ───────────────────────────

test('el LLM dice none, las reglas dijeron high: sale high y con tarjeta', async () => {
  const bd = adminFalso()
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.95, riesgo: 'none', motivo: 'Comentario correcto.' }),
  )
  const salida = await evaluarContenido(
    { texto: 'Últimamente pienso en suicidarme casi todos los días.', tipo: 'post', autorId: AUTOR },
    depsBase({ cliente: espia.cliente, admin: bd.admin }),
  )
  assert.equal(salida.riesgo, 'high')
  assert.notEqual(salida.tarjetaAyuda, null)
})

// ── 10. Presupuesto agotado ─────────────────────────────────────────────────

test('presupuesto agotado: CERO llamadas de red e indeterminado', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.9, riesgo: 'none', motivo: 'No debería llamarse.' }),
  )
  const salida = await evaluarContenido(
    { texto: COMENTARIO_BUENO, tipo: 'comment', autorId: AUTOR },
    depsBase({
      cliente: espia.cliente,
      // Contador por encima del cupo: el cortacircuitos salta antes de la red.
      leerContador: async () => 10_000_000,
    }),
  )
  assert.equal(espia.invocaciones, 0, 'no se debe tocar la red con el cupo agotado')
  assert.equal(salida.degradado, true)
  assert.equal(salida.validado, false)
  assert.equal(salida.publicable, true, 'ni siquiera sin presupuesto se silencia a nadie')
})

test('evaluarPresupuesto: umbral de aviso al 80 % y agotado al 100 %', () => {
  assert.equal(evaluarPresupuesto(79, 100).aviso, false)
  assert.equal(evaluarPresupuesto(80, 100).aviso, true)
  assert.equal(evaluarPresupuesto(80, 100).agotado, false)
  assert.equal(evaluarPresupuesto(100, 100).agotado, true)
  assert.equal(evaluarPresupuesto(150, 100).agotado, true)
  // No revienta con datos absurdos.
  assert.equal(evaluarPresupuesto(-5, 0).usadas, 0)
})

// ── Tóxico ──────────────────────────────────────────────────────────────────

test('tóxico: no se publica y no se valida', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'toxico', puntuacion: 0.97, riesgo: 'none', motivo: 'Desprecia a quien escribe.' }),
  )
  const salida = await evaluarContenido(
    { texto: COMENTARIO_BUENO, tipo: 'comment', autorId: AUTOR },
    depsBase({ cliente: espia.cliente }),
  )
  assert.equal(salida.publicable, false)
  assert.equal(salida.validado, false)
})

// ── Criba barata: las reglas ahorran la llamada ─────────────────────────────

test('un comentario demasiado corto no gasta ni una llamada de pago', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.9, riesgo: 'none', motivo: 'No debería llamarse.' }),
  )
  const salida = await evaluarContenido(
    { texto: 'ánimo', tipo: 'comment', autorId: AUTOR },
    depsBase({ cliente: espia.cliente }),
  )
  assert.equal(espia.invocaciones, 0)
  assert.equal(salida.validado, false)
  assert.equal(salida.publicable, false, 'el CHECK de la columna lo rechazaría igualmente')
  assert.equal(salida.degradado, false, 'esto no es una degradación: es un veredicto')
})

test('relleno detectado por reglas: se publica pero no acredita karma', async () => {
  const espia = clienteFalso(
    respuesta({ calidad: 'valido', puntuacion: 0.9, riesgo: 'none', motivo: 'No debería llamarse.' }),
  )
  const salida = await evaluarContenido(
    {
      texto: 'ánimo ánimo ánimo mucho ánimo fuerza fuerza fuerza un abrazo un abrazo suerte suerte',
      tipo: 'comment',
      autorId: AUTOR,
    },
    depsBase({ cliente: espia.cliente }),
  )
  assert.equal(espia.invocaciones, 0)
  assert.equal(salida.publicable, true)
  assert.equal(salida.validado, false)
})

// ── Auditoría ───────────────────────────────────────────────────────────────

test('la fila de auditoría NO contiene el texto del usuario', () => {
  const secreto = 'mi jefe me humilló delante de todos y llevo semanas sin dormir'
  const fila = construirFilaAuditoria({
    refTipo: 'comment',
    refId: '99999999-8888-7777-6666-555555555555',
    sujetoId: AUTOR,
    calidad: 'valido',
    puntuacion: 0.8,
    riesgo: 'none',
    motivo: 'Aporta experiencia propia.',
    degradado: false,
    causa: null,
    uso: USO_CERO,
    latenciaMs: 120,
    cacheAcertada: true,
  })
  const serializada = JSON.stringify(fila)
  assert.equal(serializada.includes(secreto), false)
  assert.equal(serializada.includes('jefe'), false)
  assert.ok(serializada.includes('99999999-8888-7777-6666-555555555555'), 'sí guarda el ref_id')
})

test('la auditoría rutinaria nace dismissed y no ensancha la cola', () => {
  const limpia = construirFilaAuditoria({
    refTipo: 'comment',
    calidad: 'valido',
    puntuacion: 0.9,
    riesgo: 'none',
    motivo: 'ok',
    degradado: false,
    causa: null,
    uso: USO_CERO,
    latenciaMs: 10,
    cacheAcertada: true,
  })
  assert.equal(limpia.state, 'dismissed')
  assert.equal(limpia.signal, 'ai_decision')
  assert.equal(limpia.severity, 1)

  const grave = construirFilaAuditoria({
    refTipo: 'post',
    calidad: 'indeterminado',
    puntuacion: null,
    riesgo: 'critical',
    motivo: 'sin veredicto',
    degradado: true,
    causa: 'sin_clave',
    uso: USO_CERO,
    latenciaMs: 0,
    cacheAcertada: false,
  })
  assert.equal(grave.state, 'pending')
  assert.equal(grave.signal, 'ai_unavailable')
  assert.equal(grave.severity, 5)
})

// ── Sanciones ───────────────────────────────────────────────────────────────

test('los deltas de sanción salen de lib/karma.ts, no de un literal', () => {
  assert.equal(deltaDeSancion('spam_penalty'), KARMA_WEIGHTS.spam_penalty.reputation)
  assert.equal(deltaDeSancion('report_upheld'), KARMA_WEIGHTS.report_upheld.reputation)
  assert.equal(deltaDeSancion('spam_penalty'), -40)
  assert.equal(deltaDeSancion('report_upheld'), -30)
})

test('la sanción escala con la reincidencia; el shadow-ban llega a la tercera', () => {
  assert.deepEqual(decidirSancion(0), { penalizar: 'spam_penalty', shadowBan: false })
  assert.deepEqual(decidirSancion(1), { penalizar: 'report_upheld', shadowBan: false })
  assert.deepEqual(decidirSancion(2), { penalizar: 'report_upheld', shadowBan: true })
})

// ── Acceso de moderador (base de la prueba 11 de la ficha) ─────────────────

test('el rol de moderación es un nivel de `admin_roles`, no una lista de uuids', () => {
  // La comprobación REAL vive en Postgres (`tiene_rol_admin()`); aquí solo se
  // fija el contrato del lado del código: qué mínimo se exige y que la
  // jerarquía se lee `>=`, igual que en la función de la base.
  assert.equal(ROL_MINIMO_MODERACION, 'moderador')
  assert.equal(cumpleRol('soporte', ROL_MINIMO_MODERACION), false)
  assert.equal(cumpleRol('superadmin', ROL_MINIMO_MODERACION), true)
})

test('MODERATION_ADMIN_IDS ya no autoriza a nadie: solo siembra el primer superadmin', () => {
  assert.equal(parsearSemillaSuperadmin(undefined).size, 0)
  const CON_LETRAS = 'ABCDEF00-1111-2222-3333-444444444444'
  const semilla = parsearSemillaSuperadmin(` ${CON_LETRAS} , ${AUTOR} `)
  assert.equal(semilla.size, 2)
  // Normaliza a minúsculas para que el script de bootstrap no inserte dos filas
  // por el mismo uuid escrito de dos formas.
  assert.equal(semilla.has(CON_LETRAS.toLowerCase()), true)
  assert.equal(semilla.has(CON_LETRAS), false)
})

// ── Recursos ────────────────────────────────────────────────────────────────

test('la tarjeta sale de i18n/recursosCrisis.ts y nunca viene vacía', () => {
  for (const pais of ['ES', 'US', 'XX', null]) {
    const tarjeta = construirTarjeta('high', pais)
    assert.ok(tarjeta.recursos.length > 0, `tarjeta vacía para ${pais}`)
    assert.ok(tarjeta.mensaje.length > 0)
  }
  // Indexado por PAÍS y jamás por idioma: en EE. UU. toca el 988, no el 024.
  const eeuu = construirTarjeta('high', 'US')
  assert.ok(eeuu.recursos.some((r) => r.telefono === '988'))
  const espana = construirTarjeta('high', 'ES')
  assert.ok(espana.recursos.some((r) => r.telefono === '024'))
})

test('mientras los teléfonos no estén verificados, la tarjeta y el registro lo dicen', () => {
  // Aviso vivo del proyecto: los 24 recursos siguen sin verificar por una
  // persona. Este bloque no puede darlos por buenos.
  assert.equal(recursosVerificados(), false)
  const tarjeta = construirTarjeta('critical', 'ES')
  assert.match(tarjeta.mensaje, /no responde/)
  assert.equal(recursosMostrados(tarjeta, 'ES')[0], 'SIN_VERIFICACION_HUMANA')
})

test('lo que se persiste son identificadores estables, no el texto de la tarjeta', () => {
  const tarjeta = construirTarjeta('high', 'MX')
  const ids = recursosMostrados(tarjeta, 'MX')
  assert.ok(ids.some((id) => id.startsWith('MX·')))
  assert.equal(ids.some((id) => id.includes(tarjeta.mensaje)), false)
})
