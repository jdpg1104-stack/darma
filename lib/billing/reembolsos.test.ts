// ============================================================================
// Reembolsos — reintento idempotente, suelo en cero y pérdida auditada
//
// La demostración de verdad del suelo en 0 y de la idempotencia vive en
// Postgres (`revertir_compra`, 0216_1): probarla con un mock probaría el mock.
// Lo que se prueba aquí, SIN red y SIN base, son las tres mitades nuestras:
//
//  · La política de rutas: qué notificación ES un reembolso y contra qué
//    `external_id` se ejecuta (funciones puras, mismo material que reciben los
//    webhooks tras verificar la firma).
//  · El contrato de `revertirCompra`: un reintento NO es un error, `sin_compra`
//    no revienta, y un error de Postgres sale como código sin filtrar nada.
//  · El TEXTO de la migración: que el suelo, el insert especulativo, la
//    auditoría de la pérdida y el revoke a solo service_role están escritos, y
//    que el trigger append-only no se toca. Es un grep tosco a propósito, como
//    lineaRoja.test.ts: su valor es romperse si alguien relaja la política.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'

import { esErrorApi } from '../auth/errores.ts'
import { reembolsoDeApple, reembolsoDeGoogle, revertirCompra } from './reembolsos.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RUTA_MIGRACION = join(AQUI, '..', '..', 'supabase', 'migrations', '0219_1_b12_reembolsos.sql')

// ── La política de rutas: Apple ─────────────────────────────────────────────

test('REFUND y REVOKE dan orden de reversión contra apple:<transactionId>', () => {
  for (const tipo of ['REFUND', 'REVOKE'] as const) {
    const orden = reembolsoDeApple(tipo, { transactionId: '2000000123456789' })
    assert.deepEqual(orden, { externalId: 'apple:2000000123456789', motivo: tipo })
  }
})

test('FALLO · una notificación de Apple que no es reembolso no da orden', () => {
  // ONE_TIME_CHARGE es la compra normal; TEST es el ping de la consola. Si
  // cualquiera de estas diera orden, una compra REVERTIRÍA cristales.
  for (const tipo of ['ONE_TIME_CHARGE', 'CONSUMPTION_REQUEST', 'TEST', '', undefined]) {
    assert.equal(reembolsoDeApple(tipo, { transactionId: '2000000123456789' }), null)
  }
})

test('FALLO · un REFUND sin transactionId no da orden: no se adivina la compra', () => {
  assert.equal(reembolsoDeApple('REFUND', {}), null)
  assert.equal(reembolsoDeApple('REFUND', { transactionId: '' }), null)
  assert.equal(reembolsoDeApple('REFUND', { transactionId: '   ' }), null)
})

// ── La política de rutas: Google ────────────────────────────────────────────

test('voidedPurchase da orden contra google:<orderId>, que es la clave del ledger', () => {
  const orden = reembolsoDeGoogle({
    voidedPurchaseNotification: { orderId: 'GPA.1234-5678', purchaseToken: 'tok', refundType: 1 },
  })
  assert.deepEqual(orden, { externalId: 'google:GPA.1234-5678', motivo: 'voidedPurchase' })
})

test('FALLO · sin voidedPurchaseNotification o sin orderId no hay orden', () => {
  // La acreditación usó `google:<orderId>`; el purchaseToken NO está en el
  // ledger, así que sin orderId no hay contra qué revertir.
  assert.equal(reembolsoDeGoogle({}), null)
  assert.equal(reembolsoDeGoogle({ oneTimeProductNotification: { notificationType: 1 } }), null)
  assert.equal(reembolsoDeGoogle({ voidedPurchaseNotification: { purchaseToken: 'tok' } }), null)
  assert.equal(reembolsoDeGoogle({ voidedPurchaseNotification: { orderId: '  ', purchaseToken: 'tok' } }), null)
})

test('el external_id de la orden lleva prefijo de plataforma: Apple y Google no colisionan', () => {
  const apple = reembolsoDeApple('REFUND', { transactionId: 'X' })
  const google = reembolsoDeGoogle({ voidedPurchaseNotification: { orderId: 'X' } })
  assert.ok(apple && google)
  assert.notEqual(apple.externalId, google.externalId)
})

// ── El contrato de revertirCompra ───────────────────────────────────────────

function clienteFalso(respuesta: { data?: unknown; error?: unknown }) {
  const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = []
  const cliente = {
    rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ nombre, args })
      return Promise.resolve(respuesta)
    },
  } as unknown as SupabaseClient
  return { cliente, llamadas }
}

test('la reversión pasa a la RPC el external_id ORIGINAL y el motivo, tal cual', async () => {
  const { cliente, llamadas } = clienteFalso({
    data: [{ estado: 'revertida', revertido: 550, perdido: 0, saldo: 0 }],
  })

  const resultado = await revertirCompra(cliente, { externalId: 'apple:2000000123456789', motivo: 'REFUND' })

  assert.deepEqual(resultado, { estado: 'revertida', revertido: 550, perdido: 0, saldo: 0 })
  assert.equal(llamadas[0]!.nombre, 'revertir_compra')
  assert.equal(llamadas[0]!.args.p_external_id, 'apple:2000000123456789')
  assert.equal(llamadas[0]!.args.p_motivo, 'REFUND')
})

test('un reembolso REINTENTADO devuelve estado reintento y NO es un error', async () => {
  // La store reenvía durante días. Si el reintento lanzara, el webhook
  // respondería 5xx y el reenvío no pararía nunca. Las cifras son las del
  // PRIMER procesado, tal como las devuelve la RPC.
  const { cliente } = clienteFalso({
    data: [{ estado: 'reintento', revertido: 300, perdido: 250, saldo: 40 }],
  })

  const resultado = await revertirCompra(cliente, { externalId: 'google:GPA.1', motivo: 'voidedPurchase' })

  assert.equal(resultado.estado, 'reintento')
  assert.equal(resultado.revertido, 300)
  assert.equal(resultado.perdido, 250, 'la pérdida auditada del primer procesado tiene que sobrevivir al reintento')
})

test('la pérdida viaja en el resultado: saldo gastado = revertido parcial + perdido', async () => {
  // El caso central de la decisión de producto: se reembolsan 550, quedaban
  // 200 → se revierten 200 (saldo a 0, nunca negativo) y se pierden 350.
  const { cliente } = clienteFalso({
    data: [{ estado: 'revertida', revertido: 200, perdido: 350, saldo: 0 }],
  })

  const resultado = await revertirCompra(cliente, { externalId: 'apple:1', motivo: 'REVOKE' })

  assert.equal(resultado.revertido + resultado.perdido, 550)
  assert.equal(resultado.saldo, 0, 'el suelo es 0: jamás un saldo negativo')
})

test('sin_compra no revienta y el saldo nulo sale como 0', async () => {
  const { cliente } = clienteFalso({ data: [{ estado: 'sin_compra', revertido: 0, perdido: 0, saldo: null }] })

  const resultado = await revertirCompra(cliente, { externalId: 'apple:jamas-acreditada', motivo: 'REFUND' })

  assert.deepEqual(resultado, { estado: 'sin_compra', revertido: 0, perdido: 0, saldo: 0 })
})

test('FALLO · sin external_id no se revierte: sin idempotencia, un reintento duplicaría', async () => {
  const { cliente, llamadas } = clienteFalso({ data: [{ estado: 'revertida', revertido: 1, perdido: 0, saldo: 0 }] })

  await assert.rejects(
    () => revertirCompra(cliente, { externalId: '', motivo: 'REFUND' }),
    (error: unknown) => esErrorApi(error) && error.code === 'entrada_invalida',
  )
  assert.equal(llamadas.length, 0, 'no puede llegar a llamar a la base de datos')
})

test('FALLO · un error de Postgres se convierte en error_interno sin filtrar el mensaje', async () => {
  const { cliente } = clienteFalso({
    error: { code: '23514', message: 'new row violates check constraint "crystal_ledger_delta_check"' },
  })

  await assert.rejects(
    () => revertirCompra(cliente, { externalId: 'apple:1', motivo: 'REFUND' }),
    (error: unknown) =>
      esErrorApi(error) && error.code === 'error_interno' && !error.message.includes('crystal_ledger_delta_check'),
  )
})

test('FALLO · un estado desconocido o una respuesta vacía son error_interno, no un no-evento', async () => {
  for (const data of [[], [{ estado: 'aprobada', revertido: 1, perdido: 0, saldo: 0 }], null]) {
    const { cliente } = clienteFalso({ data })
    await assert.rejects(
      () => revertirCompra(cliente, { externalId: 'apple:1', motivo: 'REFUND' }),
      (error: unknown) => esErrorApi(error) && error.code === 'error_interno',
    )
  }
})

// ── El contrato escrito en la migración ─────────────────────────────────────

/** Sin comentarios `--`: los comentarios EXPLICAN la regla y pueden nombrarla. */
function sqlSinComentarios(): string {
  return readFileSync(RUTA_MIGRACION, 'utf8')
    .split('\n')
    .map((linea) => linea.replace(/\r$/, '').replace(/--.*$/, ''))
    .join('\n')
}

test('la migración escribe el suelo en cero y la pérdida como diferencia', () => {
  const sql = sqlSinComentarios()
  assert.match(sql, /least\(v_saldo,\s*v_delta\)/, 'el suelo en 0 es least(saldo, reembolsado)')
  assert.match(sql, /v_delta\s*-\s*v_revertido/, 'la pérdida es lo reembolsado menos lo recuperado')
})

test('la migración usa el MISMO insert especulativo que acreditar_compra', () => {
  const sql = sqlSinComentarios()
  assert.match(
    sql,
    /on conflict \(external_id\) where external_id is not null do nothing/,
    'sin el insert especulativo, un reintento de la store revertiría dos veces',
  )
  assert.match(sql, /returning id into v_id/, 'el conflicto ES la detección del reintento')
  assert.match(sql, /if v_id is not null then/, 'el caché solo se toca si el apunte es nuevo')
})

test('la pérdida queda AUDITADA en el propio apunte (raw_receipt)', () => {
  const sql = sqlSinComentarios()
  for (const campo of ['reembolsado', 'revertido', 'perdido', 'external_id_original', 'motivo']) {
    assert.ok(sql.includes(`'${campo}'`), `el apunte inverso tiene que llevar «${campo}» en raw_receipt`)
  }
  assert.match(sql, /'refund'/, 'el apunte inverso lleva source=refund, el único que admite delta 0')
})

test('la relajación del CHECK de delta queda acotada a source=refund', () => {
  const sql = sqlSinComentarios()
  assert.match(
    sql,
    /check \(delta <> 0 or source = 'refund'\)/,
    'delta 0 solo puede existir en un apunte de reembolso; en cualquier otro source sigue prohibido',
  )
})

test('🔴 revertir_compra es security definer y SOLO de service_role', () => {
  const sql = sqlSinComentarios()
  assert.match(sql, /security definer/, 'sin definer no puede escribir en el ledger blindado')
  assert.match(sql, /set search_path = public, pg_temp/)
  assert.match(
    sql,
    /revoke all on function public\.revertir_compra\(text, text\)\s+from public, anon, authenticated;/,
    'una definer nueva hereda EXECUTE de PUBLIC: hay que revocarlo (disciplina de 0215)',
  )
  assert.match(sql, /grant execute on function public\.revertir_compra\(text, text\)\s+to service_role;/)
  assert.ok(
    !/grant execute on function public\.revertir_compra[^;]*to (authenticated|anon)/.test(sql),
    'revertir_compra resta saldo de cualquiera a partir de un external_id: jamás para el cliente',
  )
})

test('🔴 el trigger append-only NO se toca: un apunte negativo nuevo no es una edición', () => {
  const sql = sqlSinComentarios().toLowerCase()
  assert.ok(!sql.includes('drop trigger'), 'la migración no puede tirar el trigger de inmutabilidad')
  assert.ok(!sql.includes('disable trigger'), 'ni desactivarlo temporalmente')
  assert.ok(!sql.includes('crystal_ledger_immutable'), 'ni redefinir su función')
  assert.ok(!/\bupdate\s+public\.crystal_ledger\b/.test(sql), 'el ledger se corrige insertando, nunca con UPDATE')
  assert.ok(!/\bdelete\s+from\s+public\.crystal_ledger\b/.test(sql), 'y nunca con DELETE')
})

test('🔴 la migración de reembolsos no toca karma ni crisis (línea roja)', () => {
  // 0216_1 no está en el barrido de lineaRoja.test.ts (que apunta a 0121_1);
  // este test la cubre con los mismos patrones para que la regla no tenga un
  // hueco justo en el archivo que resta dinero. Los identificadores van
  // PARTIDOS a propósito: lineaRoja.test.ts también grepa este archivo, y un
  // literal entero aquí haría saltar su alarma con razón.
  const sql = sqlSinComentarios()
  const prohibidos = [
    new RegExp(String.raw`\baward_` + String.raw`karma\b`),
    new RegExp(String.raw`\bkarma_` + String.raw`reputation\b`),
    new RegExp(String.raw`karma_` + String.raw`spendable\s*\+`),
    new RegExp(String.raw`\bcrisis_` + String.raw`events\b`),
  ]
  for (const prohibido of prohibidos) {
    assert.ok(!prohibido.test(sql), `la migración de reembolsos no puede casar con ${String(prohibido)}`)
  }
})

// ── El cableado de los webhooks ─────────────────────────────────────────────

test('los DOS webhooks ejecutan la reversión y ya no dejan el reembolso «pendiente»', () => {
  // Grep estructural, como el de titularidad.test.ts sobre verify/restore: si
  // alguien vuelve a dejar el REFUND en un log-y-return, esto se rompe.
  const apple = readFileSync(new URL('../../app/api/billing/webhook/apple/route.ts', import.meta.url), 'utf8')
  const google = readFileSync(new URL('../../app/api/billing/webhook/google/route.ts', import.meta.url), 'utf8')

  assert.match(apple, /reembolsoDeApple\(/, 'el webhook de Apple no clasifica el REFUND')
  assert.match(apple, /revertirCompra\(/, 'el webhook de Apple no ejecuta la reversión')
  assert.match(google, /reembolsoDeGoogle\(/, 'el webhook de Google no clasifica el voidedPurchase')
  assert.match(google, /revertirCompra\(/, 'el webhook de Google no ejecuta la reversión')

  for (const [nombre, fuente] of [['apple', apple], ['google', google]] as const) {
    assert.ok(
      !fuente.includes('reembolso_pendiente_de_apunte_inverso'),
      `el webhook de ${nombre} sigue tratando el reembolso como pendiente en vez de revertirlo`,
    )
  }
})
