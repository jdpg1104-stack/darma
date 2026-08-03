// ============================================================================
// Pruebas de B05. Once casos, ocho de FALLO.
//
// Un test que solo comprueba el camino feliz de un perfil pasa igual con las
// políticas RLS desactivadas y con el karma gastable saliendo en el JSON del
// perfil ajeno. Aquí lo que se afirma es lo que NO ocurre: que no salgan los
// campos privados, que un cursor corrupto no rompa la pantalla, que un límite
// de 200 no cuele y que la Server Action no tenga por dónde escribir el karma.
//
// Las pruebas contra Postgres —dos sesiones reales, un usuario intentando leer
// el saldo de otro— están en la verificación del bloque y no aquí: `node --test`
// no debe depender de una base de datos remota.
// ============================================================================

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { progressToNextLevel } from '../../lib/karma.ts'
import { calcularInsignias, insigniasPublicas, CATALOGO_INSIGNIAS } from './insignias.ts'
import { codificarCursor, decodificarCursor } from './cursor.ts'
import { formatearDelta, formatearFechaCorta } from './fechas.ts'
import {
  cambiosPerfilDesdeEntrada,
  desgloseDesdeJsonb,
  eventoKarmaDesdeFila,
  perfilAjenoDesdeFila,
  resumenDesdeFila,
  vecesMeAyudo,
} from './proyecciones.ts'
import { argumentosHistorial } from './argumentos.ts'
import {
  esquemaConsultaHistorial,
  esquemaEditarPerfil,
} from './validacion.ts'
import type { FilaPerfilPublica } from './tipos.ts'

/** Fila con TODAS las columnas privadas puestas a valores reconocibles. Si
 *  alguna se colara en una proyección, el test la encuentra por su valor. */
const FILA_AJENA: FilaPerfilPublica & Record<string, unknown> = {
  id: '11111111-1111-4111-8111-111111111111',
  alias: 'Faro Sereno 4821',
  avatar_seed: 'aaaa1111bbbb2222',
  bio: 'Aquí ando.',
  karma_reputation: 2400,
  level: 'guia',
  availability: 'disponible',
  created_at: '2026-01-02T10:00:00.000Z',
  last_seen_at: '2026-08-03T09:47:31.000Z',
  // Columnas que Postgres NO devolvería (no hay privilegio de select). Se
  // añaden a mano justamente para probar que, aunque llegaran, la proyección
  // las descarta: la defensa no puede depender solo del `select`.
  karma_spendable: 777,
  crystals: 42,
  listen_credits: 5,
  listens_given: 37,
  posts_published: 9,
  daily_karma_earned: 60,
  shadow_banned: true,
  banned_until: '2027-01-01T00:00:00.000Z',
  entry_level: 'escucha',
  streak_days: 12,
}

// ── 1. Progreso de nivel · el tramo actual, no el total ─────────────────────
describe('1 · progreso al siguiente nivel', () => {
  it('con 2400 de karma faltan 2600 para mentor y el ratio es ~0,133', () => {
    const p = progressToNextLevel(2400)

    assert.equal(p.level, 'guia')
    assert.equal(p.nextLevel, 'mentor')
    assert.equal(p.remaining, 2600)
    // 400/3000 = 0,1333… El error que este test existe para cazar es pintar
    // 2400/5000 = 0,48: la barra saldría casi a la mitad justo cuando faltan
    // 2 600 puntos.
    assert.ok(Math.abs(p.ratio - 0.1333) < 0.001, `ratio inesperado: ${p.ratio}`)
    assert.notEqual(Math.round(p.ratio * 100), 48)
  })

  it('el resumen devuelve el progreso TAL CUAL, sin recalcular ratios', () => {
    const resumen = resumenDesdeFila(
      {
        reputacion: 2400,
        ganado_hoy: 60,
        streak_days: 12,
        streak_last_date: '2026-08-03',
        desglose_30d: [],
      },
      '2026-08-03',
    )

    assert.deepEqual(resumen.progreso, progressToNextLevel(2400))
    assert.equal(resumen.hoy.tope, 120)
    assert.equal(resumen.hoy.restante, 60)
    assert.equal(resumen.racha.activaHoy, true)
  })

  it('la racha de ayer no cuenta como activa hoy', () => {
    const resumen = resumenDesdeFila(
      { reputacion: 10, ganado_hoy: 0, streak_days: 3, streak_last_date: '2026-08-02', desglose_30d: [] },
      '2026-08-03',
    )
    assert.equal(resumen.racha.activaHoy, false)
    assert.equal(resumen.racha.dias, 3)
  })
})

// ── 2. Insignias en los bordes ──────────────────────────────────────────────
describe('2 · insignias en los bordes', () => {
  const clave = (lista: ReturnType<typeof calcularInsignias>, c: string) =>
    lista.find((i) => i.clave === c)

  it('con 0 escuchas ninguna de escucha está conseguida, pero SÍ aparecen', () => {
    const lista = calcularInsignias({ karmaReputacion: 0, escuchasDadas: 0 })
    assert.equal(clave(lista, 'primera_escucha')?.conseguida, false)
    assert.equal(clave(lista, 'diez_escuchas')?.conseguida, false)
  })

  it('con exactamente 10 escuchas, la de diez SÍ y la de cien NO', () => {
    const lista = calcularInsignias({ karmaReputacion: 0, escuchasDadas: 10 })
    assert.equal(clave(lista, 'primera_escucha')?.conseguida, true)
    assert.equal(clave(lista, 'diez_escuchas')?.conseguida, true)
    assert.equal(clave(lista, 'cien_escuchas')?.conseguida, false)
  })

  it('con exactamente 100 escuchas, las tres', () => {
    const lista = calcularInsignias({ karmaReputacion: 0, escuchasDadas: 100 })
    assert.equal(clave(lista, 'cien_escuchas')?.conseguida, true)
  })

  it('sin evidencia la insignia se OMITE, no se marca como no conseguida', () => {
    // `escuchasDadas: undefined` = "no lo sé" (perfil ajeno), distinto de 0.
    const lista = calcularInsignias({ karmaReputacion: 2400 })
    assert.equal(clave(lista, 'primera_escucha'), undefined)
    assert.equal(clave(lista, 'racha_7'), undefined)
    // Lo derivable de la reputación sí está.
    assert.equal(clave(lista, 'guia')?.conseguida, true)
    assert.equal(clave(lista, 'mentor')?.conseguida, false)
  })

  it('los umbrales de nivel salen de KARMA_LEVELS, no escritos a mano', () => {
    assert.equal(calcularInsignias({ karmaReputacion: 499 }).find((i) => i.clave === 'brote')?.conseguida, false)
    assert.equal(calcularInsignias({ karmaReputacion: 500 }).find((i) => i.clave === 'brote')?.conseguida, true)
    assert.equal(calcularInsignias({ karmaReputacion: 5000 }).find((i) => i.clave === 'mentor')?.conseguida, true)
  })

  it('toda insignia del catálogo explica cómo se consigue', () => {
    for (const def of CATALOGO_INSIGNIAS) {
      assert.ok(def.comoSeConsigue.length > 10, `${def.clave} sin explicación`)
      assert.ok(def.descripcion.length > 5, `${def.clave} sin descripción`)
    }
  })

  it('«me ayudó» se cuenta desde el desglose, sin consulta nueva', () => {
    const desglose = desgloseDesdeJsonb([
      { kind: 'marked_helpful', total: 150, veces: 10 },
      { kind: 'comment_validated', total: 90, veces: 9 },
    ])
    assert.equal(vecesMeAyudo(desglose), 10)
    assert.equal(
      calcularInsignias({ karmaReputacion: 0, vecesMeAyudo: vecesMeAyudo(desglose) })
        .find((i) => i.clave === 'corazon_util')?.conseguida,
      true,
    )
  })
})

// ── 3. FALLO · el historial es SIEMPRE el propio ────────────────────────────
describe('3 · FALLO · ?userId=<otro> no cambia de quién es el ledger', () => {
  it('los argumentos de la RPC no tienen ningún parámetro de usuario', () => {
    const args = argumentosHistorial({ limite: 20 })
    assert.deepEqual(Object.keys(args).sort(), ['p_cursor_created', 'p_cursor_id', 'p_limite'])

    const serializado = JSON.stringify(args)
    for (const sospechoso of ['user', 'userId', 'user_id', 'p_user', 'author']) {
      assert.ok(!serializado.includes(sospechoso), `los argumentos filtran ${sospechoso}`)
    }
  })

  it('el esquema de la query no acepta userId (`.strict()` no hace falta: no está)', () => {
    const r = esquemaConsultaHistorial.safeParse({ limite: '20', userId: 'otro' })
    assert.equal(r.success, true)
    // Aunque zod lo deje pasar, no llega a los argumentos: no hay dónde ponerlo.
    assert.equal('userId' in (r.success ? r.data : {}), false)
  })
})

// ── 4. FALLO · el perfil ajeno no contiene ninguna clave prohibida ──────────
describe('4 · FALLO · claves prohibidas en el perfil ajeno', () => {
  const PROHIBIDAS = [
    'karma_spendable', 'karmaSpendable',
    'crystals', 'cristales',
    'listen_credits', 'listenCredits',
    'daily_karma_earned', 'dailyKarmaEarned',
    'shadow_banned', 'shadowBanned',
    'banned_until', 'bannedUntil',
    'entry_level', 'entryLevel',
    'streak_days', 'streakDays',
    'last_seen_at', 'lastSeenAt',
    'listens_given', 'posts_published',
    'email', 'phone', 'contact_hash',
  ]

  /** Claves cortas que como SUBCADENA aparecen dentro de palabras legítimas
   *  ("ip" está dentro de "descripcion"). Se comprueban recorriendo las claves
   *  del objeto, no el texto del JSON. */
  const PROHIBIDAS_EXACTAS = ['ip', 'country', 'bio']

  /** Todas las claves del objeto, a cualquier profundidad. */
  function clavesDe(valor: unknown, salida: string[] = []): string[] {
    if (Array.isArray(valor)) {
      for (const v of valor) clavesDe(v, salida)
    } else if (typeof valor === 'object' && valor !== null) {
      for (const [k, v] of Object.entries(valor)) {
        salida.push(k)
        clavesDe(v, salida)
      }
    }
    return salida
  }

  it('el JSON serializado no contiene ninguna, ni como clave ni como valor', () => {
    const ajeno = perfilAjenoDesdeFila(FILA_AJENA)
    const json = JSON.stringify(ajeno)

    for (const clave of PROHIBIDAS) {
      assert.ok(!json.includes(clave), `el perfil ajeno filtra "${clave}": ${json}`)
    }

    const claves = clavesDe(ajeno)
    for (const clave of PROHIBIDAS_EXACTAS) {
      assert.ok(!claves.includes(clave), `el perfil ajeno filtra la clave "${clave}"`)
    }

    // Y tampoco los VALORES: una clave renombrada seguiría siendo una fuga.
    for (const valor of ['777', '42', '2027-01-01', '09:47:31']) {
      assert.ok(!json.includes(valor), `el perfil ajeno filtra el valor ${valor}: ${json}`)
    }
  })

  it('devuelve exactamente `perfil` e `insignias`, ni un campo más', () => {
    const ajeno = perfilAjenoDesdeFila(FILA_AJENA)
    assert.deepEqual(Object.keys(ajeno).sort(), ['insignias', 'perfil'])
    assert.deepEqual(
      Object.keys(ajeno.perfil).sort(),
      ['alias', 'avatarSeed', 'disponibilidad', 'esMentor', 'id', 'karmaReputacion', 'nivel'],
    )
  })

  it('las insignias públicas son solo las de nivel y solo las conseguidas', () => {
    const lista = insigniasPublicas(2400)
    assert.deepEqual(lista.map((i) => i.clave).sort(), ['brote', 'guia'])
    assert.ok(lista.every((i) => i.conseguida))
  })
})

// ── 5. FALLO · la edición no puede escribir karma ni cristales ──────────────
describe('5 · FALLO · la Server Action no tiene por dónde escribir el karma', () => {
  it('el esquema RECHAZA claves desconocidas en vez de ignorarlas', () => {
    const r = esquemaEditarPerfil.safeParse({ alias: 'Faro Sereno 1234', crystals: 9999 })
    assert.equal(r.success, false)
  })

  it('el objeto del UPDATE solo tiene las cuatro columnas del grant', () => {
    const cambios = cambiosPerfilDesdeEntrada({
      alias: 'Faro Sereno 1234',
      avatarSeed: 'aaaa1111bbbb2222',
      bio: 'Hola',
      disponibilidad: 'ausente',
    })

    assert.deepEqual(Object.keys(cambios).sort(), ['alias', 'availability', 'avatar_seed', 'bio'])
    const json = JSON.stringify(cambios)
    for (const prohibida of ['karma_reputation', 'karma_spendable', 'crystals', 'level', 'listens_given']) {
      assert.ok(!json.includes(prohibida), `el UPDATE incluiría ${prohibida}`)
    }
  })

  it('una bio vacía se guarda como NULL, no como cadena vacía', () => {
    assert.equal(cambiosPerfilDesdeEntrada({ bio: '' }).bio, null)
    assert.equal(cambiosPerfilDesdeEntrada({}).bio, undefined)
  })

  it('no finge éxito: sin ningún cambio, la validación falla', () => {
    assert.equal(esquemaEditarPerfil.safeParse({}).success, false)
  })
})

// ── 6. FALLO · alias inválido y alias duplicado ─────────────────────────────
describe('6 · FALLO · alias', () => {
  it('el patrón es idéntico al CHECK de 0001', () => {
    for (const bueno of ['Faro Sereno 1234', 'abc', 'Río_Cálido ñÑ', 'a'.repeat(24)]) {
      assert.equal(esquemaEditarPerfil.safeParse({ alias: bueno }).success, true, bueno)
    }
    for (const malo of ['ab', 'a'.repeat(25), 'con-guion', 'emoji 🙂', 'punto.com', '@handle']) {
      assert.equal(esquemaEditarPerfil.safeParse({ alias: malo }).success, false, malo)
    }
  })
})

// ── 7. FALLO · PII en la bio ────────────────────────────────────────────────
describe('7 · FALLO · PII en la bio', () => {
  it('un teléfono y un correo se detectan (lib/anonymity los bloquea)', async () => {
    const { detectPii } = await import('../../lib/anonymity.ts')
    assert.ok(detectPii('llámame al 612 345 678').some((f) => f.kind === 'phone'))
    assert.ok(detectPii('escríbeme a hola@ejemplo.com').some((f) => f.kind === 'email'))
    assert.ok(detectPii('sígueme en @mi_insta').some((f) => f.kind === 'handle'))
    // Y el camino feliz: una bio normal no se bloquea.
    assert.equal(detectPii('Aquí ando, intentando estar mejor.').length, 0)
  })

  it('la bio de más de 280 caracteres no pasa la validación', () => {
    assert.equal(esquemaEditarPerfil.safeParse({ bio: 'x'.repeat(281) }).success, false)
    assert.equal(esquemaEditarPerfil.safeParse({ bio: 'x'.repeat(280) }).success, true)
  })
})

// ── 8. FALLO · cursor corrupto → primera página, sin error ──────────────────
describe('8 · FALLO · cursor corrupto', () => {
  it('ida y vuelta', () => {
    const c = { creadoEn: '2026-08-03T09:00:00.000Z', id: '12345' }
    assert.deepEqual(decodificarCursor(codificarCursor(c)), c)
  })

  it('el id viaja como string: un bigint no cabe en un number de JS', () => {
    const grande = '9007199254740993' // 2^53 + 1
    const vuelta = decodificarCursor(codificarCursor({ creadoEn: '2026-08-03T09:00:00.000Z', id: grande }))
    assert.equal(vuelta?.id, grande)
  })

  it('cualquier basura devuelve null, y null significa PRIMERA PÁGINA', () => {
    for (const malo of [
      '', 'no-es-base64!!', Buffer.from('{}').toString('base64url'),
      Buffer.from('{"c":"no-es-fecha","i":"1"}').toString('base64url'),
      Buffer.from('{"c":"2026-08-03T09:00:00Z","i":"abc"}').toString('base64url'),
      Buffer.from('{"c":"2026-08-03T09:00:00Z","i":123}').toString('base64url'),
      Buffer.from('[]').toString('base64url'),
      'x'.repeat(300),
    ]) {
      assert.equal(decodificarCursor(malo), null, `debería ser null: ${malo.slice(0, 40)}`)
    }
  })

  it('con cursor corrupto la RPC recibe null en las dos columnas del keyset', () => {
    const args = argumentosHistorial({ limite: 20, cursor: 'basura-total' })
    assert.equal(args.p_cursor_created, null)
    assert.equal(args.p_cursor_id, null)
    assert.equal(args.p_limite, 20)
  })
})

// ── 9. FALLO · limite fuera de rango ────────────────────────────────────────
describe('9 · FALLO · límite del historial', () => {
  it('limite=200 no valida', () => {
    assert.equal(esquemaConsultaHistorial.safeParse({ limite: '200' }).success, false)
  })

  it('limite=0, negativo, decimal y texto tampoco', () => {
    for (const malo of ['0', '-5', '20.5', 'abc']) {
      assert.equal(esquemaConsultaHistorial.safeParse({ limite: malo }).success, false, malo)
    }
  })

  it('sin limite, el defecto es 20; el máximo aceptado es 50', () => {
    const r = esquemaConsultaHistorial.safeParse({})
    assert.equal(r.success && r.data.limite, 20)
    assert.equal(esquemaConsultaHistorial.safeParse({ limite: '50' }).success, true)
  })

  it('un cursor de más de 256 caracteres no valida', () => {
    assert.equal(esquemaConsultaHistorial.safeParse({ cursor: 'x'.repeat(257) }).success, false)
  })
})

// ── 10. El ledger no expone el bigint, y una penalización se ve entera ──────
describe('10 · líneas del historial', () => {
  it('el id del ledger NO sale en la respuesta (CONTRATOS §1)', () => {
    const evento = eventoKarmaDesdeFila({
      id: 918273645,
      kind: 'comment_validated',
      delta_reputation: 10,
      delta_spendable: 3,
      ref_type: 'comment',
      ref_id: '22222222-2222-4222-8222-222222222222',
      created_at: '2026-08-03T09:00:00.000Z',
    })

    assert.ok(evento)
    assert.equal('id' in evento, false)
    assert.ok(!JSON.stringify(evento).includes('918273645'))
    // La descripción se resuelve en TypeScript, sin join a karma_weights.
    assert.equal(evento.descripcion, 'Comentario de apoyo validado por IA')
  })

  it('un spam_penalty aparece con su delta negativo y no rompe nada', () => {
    const evento = eventoKarmaDesdeFila({
      id: 1, kind: 'spam_penalty', delta_reputation: -40, delta_spendable: 0,
      ref_type: 'comment', ref_id: null, created_at: '2026-08-03T09:00:00.000Z',
    })

    assert.equal(evento?.deltaReputacion, -40)
    assert.equal(formatearDelta(-40), '−40')
    assert.equal(formatearDelta(10), '+10')
    // El nivel se calcula sobre la reputación de `profiles`, que tiene
    // CHECK >= 0: la penalización no puede hundirlo por debajo de semilla.
    assert.equal(progressToNextLevel(-100).level, 'semilla')
  })

  it('un gasto (karma_spend) muestra el movimiento del saldo gastable', () => {
    const evento = eventoKarmaDesdeFila({
      id: 2, kind: 'karma_spend', delta_reputation: 0, delta_spendable: -50,
      ref_type: 'boost', ref_id: null, created_at: '2026-08-03T09:00:00.000Z',
    })
    assert.equal(evento?.deltaGastable, -50)
    assert.equal(evento?.descripcion, 'Gasto de karma gastable (boost, fruto, regalo)')
  })

  it('una clase de karma desconocida se omite en vez de romper la pantalla', () => {
    assert.equal(
      eventoKarmaDesdeFila({
        id: 3, kind: 'clase_que_no_existe', delta_reputation: 1, delta_spendable: 0,
        ref_type: null, ref_id: null, created_at: '2026-08-03T09:00:00.000Z',
      }),
      null,
    )
    assert.deepEqual(desgloseDesdeJsonb([{ kind: 'inventada', total: 5, veces: 1 }]), [])
    assert.deepEqual(desgloseDesdeJsonb(null), [])
    assert.deepEqual(desgloseDesdeJsonb('no es un array'), [])
  })
})

// ── 11. Fechas deterministas (sin desajuste de hidratación) ─────────────────
describe('11 · formato de fecha determinista', () => {
  it('mismo resultado sea cual sea la zona horaria del proceso', () => {
    assert.equal(formatearFechaCorta('2026-08-03T23:59:59.000Z'), '3 ago 2026')
    assert.equal(formatearFechaCorta('2026-01-09T00:00:00.000Z'), '9 ene 2026')
  })

  it('una cadena que no reconoce se devuelve tal cual, no se pierde la fila', () => {
    assert.equal(formatearFechaCorta('sin formato'), 'sin formato')
  })
})
