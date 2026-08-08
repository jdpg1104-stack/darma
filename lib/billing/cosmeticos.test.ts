// ============================================================================
// Cosméticos — el espejo TS ≡ SQL, el guard anti-imitación en dos idiomas y
// la compra con dobles.
//
// ── QUÉ SE PRUEBA AQUÍ Y QUÉ NO ─────────────────────────────────────────────
// La transaccionalidad de verdad (cobro y columna en la misma transacción, el
// CHECK revirtiendo el cobro) vive en Postgres (`comprar_cosmetico`, 0217_1) y
// solo se demuestra contra la base; fingirla con un mock probaría el mock. Lo
// que SÍ se prueba aquí:
//  · Que la lista cerrada del CHECK y el catálogo TS son EL MISMO conjunto
//    (mismo patrón que `sincronia.test.ts` con 0121 y que el guard de
//    `compute_hot_score`): un cosmético nuevo en un solo lado no compila la CI.
//  · Que el guard anti-imitación mira el TEXTO de LOS DOS catálogos, no la
//    clave — el aviso literal de PEDIDOS: un «Mentor Crown» solo en inglés
//    pasaría un guard que mirase el español.
//  · Que el envoltorio `comprarCosmetico()` respeta el contrato de la RPC:
//    sin saldo no compra, el reintento no cobra dos veces, y el coste sale del
//    catálogo — nunca de quien llama.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SupabaseClient } from '@supabase/supabase-js'

import { LOCALES, obtenerTraductor } from '../../i18n/index.ts'
import { esErrorApi } from '../auth/errores.ts'
import {
  CATALOGO_COSMETICOS,
  IDS_COSMETICOS_COMPRABLES,
  IDS_MARCOS,
  IDS_PALETAS,
  LIMITE_PETICION_COSMETICO,
  comprarCosmetico,
  cosmeticosPublicables,
  errorDeCosmetico,
  esCategoriaComprable,
  esIdCosmeticoComprable,
  prohibidoPorqueImitaNivel,
  type IdCosmeticoComprable,
} from './cosmeticos.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SQL_0217 = readFileSync(
  join(AQUI, '..', '..', 'supabase', 'migrations', '0220_1_b12_cosmeticos.sql'),
  'utf8',
)

/** Extrae la lista cerrada de un CHECK: `columna in ('a', 'b')` → ['a', 'b']. */
function listaDelCheck(columna: string): string[] {
  const encontrado = new RegExp(`${columna} in \\(([^)]+)\\)`).exec(SQL_0217)
  assert.ok(encontrado, `no se encontró el CHECK de ${columna} en 0220_1_b12_cosmeticos.sql`)
  return encontrado[1]!
    .split(',')
    .map((v) => v.trim().replace(/^'|'$/g, ''))
    .sort()
}

// ── Espejo TS ≡ SQL ─────────────────────────────────────────────────────────

test('la lista cerrada del CHECK de cosmetic_frame es EXACTAMENTE la de marcos del catálogo', () => {
  assert.deepEqual(listaDelCheck('cosmetic_frame'), [...IDS_MARCOS].sort())
})

test('la lista cerrada del CHECK de cosmetic_palette es EXACTAMENTE la de paletas del catálogo', () => {
  assert.deepEqual(listaDelCheck('cosmetic_palette'), [...IDS_PALETAS].sort())
})

test('las tuplas de ids comprables y el catálogo son el mismo conjunto, categoría a categoría', () => {
  // La tupla existe para derivar el tipo y el z.enum; si alguien añade un marco
  // al catálogo sin tocar la tupla (o al revés), esta es la costura que avisa.
  const marcos = CATALOGO_COSMETICOS.filter((c) => c.categoria === 'marco').map((c) => c.id)
  const paletas = CATALOGO_COSMETICOS.filter((c) => c.categoria === 'paleta').map((c) => c.id)
  assert.deepEqual([...IDS_MARCOS].sort(), marcos.sort())
  assert.deepEqual([...IDS_PALETAS].sort(), paletas.sort())
  assert.deepEqual([...IDS_COSMETICOS_COMPRABLES].sort(), [...marcos, ...paletas].sort())

  // Y todos los ids comprables llevan el prefijo del que la RPC deriva la
  // columna: un id sin prefijo pasaría el enum y moriría en el DA006 del SQL.
  for (const id of IDS_COSMETICOS_COMPRABLES) {
    assert.match(id, /^(marco|paleta)_/, `${id} no lleva el prefijo del que 0217_1 deriva la columna`)
  }
})

test('la RPC del SQL está cerrada a service_role y las columnas no son escribibles por el cliente', () => {
  // La disciplina de 0215: una security definer nueva se revoca SIEMPRE.
  assert.match(
    SQL_0217,
    /revoke all on function public\.comprar_cosmetico\(uuid, text, integer\)\s*\n?\s*from public, anon, authenticated;/,
  )
  assert.match(SQL_0217, /grant execute on function public\.comprar_cosmetico\(uuid, text, integer\) to service_role;/)

  // Las columnas son cara pública en LECTURA…
  assert.match(SQL_0217, /grant select \(cosmetic_frame, cosmetic_palette\) on public\.profiles to authenticated;/)
  // …y en ESCRITURA no hay grant: si esta línea apareciera, el cliente podría
  // ponerse el cosmético sin pagar.
  assert.doesNotMatch(SQL_0217, /grant update[^;]*cosmetic/i)
})

test('en el SQL, la rama de idempotencia va ANTES del cobro y el cobro antes de la escritura', () => {
  // Son literales, no un parser: lo que fijan es el ORDEN que hace verdad
  // «el reintento no cobra dos veces» y «no hay cobro sin cosmético».
  const idempotencia = SQL_0217.indexOf('if v_actual = p_cosmetico then')
  const cobro = SQL_0217.indexOf('public.spend_crystals(p_user, p_coste')
  const escritura = SQL_0217.indexOf('update public.profiles set cosmetic_frame = p_cosmetico')

  assert.ok(idempotencia > 0, 'no se encontró la rama de idempotencia en 0217_1')
  assert.ok(cobro > 0, 'no se encontró el cobro con spend_crystals en 0217_1')
  assert.ok(escritura > 0, 'no se encontró la escritura de la columna en 0217_1')
  assert.ok(idempotencia < cobro, 'la idempotencia tiene que comprobarse ANTES de cobrar')
  assert.ok(cobro < escritura, 'el cobro va antes de la escritura, en la misma transacción')
})

// ── El guard anti-imitación, sobre el TEXTO de los dos idiomas ──────────────

test('🔴 ningún cosmético imita un nivel: ni en el id, ni en el texto de NINGÚN idioma', () => {
  for (const cosmetico of CATALOGO_COSMETICOS) {
    for (const locale of LOCALES) {
      const t = obtenerTraductor(locale)
      const etiqueta = t(cosmetico.claveEtiqueta)
      const descripcion = t(cosmetico.claveDescripcion)

      // Sin texto no hay pantalla: la clave pintada tal cual es un bug aparte,
      // pero también dejaría este guard mirando una cadena que nadie ve.
      assert.notEqual(etiqueta, cosmetico.claveEtiqueta, `${cosmetico.id} sin etiqueta en ${locale}`)
      assert.notEqual(descripcion, cosmetico.claveDescripcion, `${cosmetico.id} sin descripción en ${locale}`)

      assert.equal(
        prohibidoPorqueImitaNivel(cosmetico, [etiqueta, descripcion]),
        false,
        `«${etiqueta}» (${cosmetico.id}, ${locale}) se parece a un nivel de karma: comprar algo que aparenta reputación es comprar reputación`,
      )
    }
  }
})

test('la etiqueta de referencia del catálogo coincide letra a letra con es.json', () => {
  // `etiqueta` sigue existiendo como campo porque es la entrada histórica del
  // guard (lineaRoja.test.ts la recorre). Este test impide que el campo y el
  // catálogo español se conviertan en dos nombres distintos del mismo cosmético.
  const t = obtenerTraductor('es')
  for (const cosmetico of CATALOGO_COSMETICOS) {
    assert.equal(t(cosmetico.claveEtiqueta), cosmetico.etiqueta, cosmetico.id)
  }
})

test('el guard atrapa una imitación en cualquiera de sus entradas', () => {
  // En el id…
  assert.equal(prohibidoPorqueImitaNivel({ id: 'marco_mentor', etiqueta: 'Aurora' }), true)
  // …en la etiqueta de referencia…
  assert.equal(prohibidoPorqueImitaNivel({ id: 'marco_aurora', etiqueta: 'Corona' }), true)
  // …y en un texto resuelto de OTRO idioma, que es el caso que avisaba PEDIDOS:
  // un cosmético limpio en español que solo en inglés se llama como un nivel.
  assert.equal(prohibidoPorqueImitaNivel({ id: 'marco_aurora', etiqueta: 'Aurora' }, ['Mentor Crown']), true)
  assert.equal(prohibidoPorqueImitaNivel({ id: 'paleta_verde', etiqueta: 'Verde' }, ['Seed green']), true)
  // Y lo limpio pasa.
  assert.equal(prohibidoPorqueImitaNivel({ id: 'marco_aurora', etiqueta: 'Aurora' }, ['Northern light']), false)
})

test('todo el catálogo es publicable hoy, y lo comprable es exactamente marco + paleta', () => {
  assert.equal(cosmeticosPublicables().length, CATALOGO_COSMETICOS.length)

  for (const cosmetico of CATALOGO_COSMETICOS) {
    assert.equal(
      esIdCosmeticoComprable(cosmetico.id),
      esCategoriaComprable(cosmetico.categoria),
      `${cosmetico.id}: comprable por id y por categoría tienen que decir lo mismo`,
    )
  }
  // El tema existe, se enseña y NO se puede comprar: no tiene columna todavía.
  assert.equal(esIdCosmeticoComprable('tema_nocturno_profundo'), false)
})

// ── La compra, con dobles ───────────────────────────────────────────────────

/**
 * Doble con ESTADO que implementa el contrato de `comprar_cosmetico()` (0217_1):
 * mira la columna antes de cobrar, cobra solo si alcanza, y cuenta los cobros.
 * No demuestra la transacción — eso es de Postgres — pero sí que el envoltorio
 * y el contrato encajan sin tocar la red.
 */
function clienteConEstado(inicial: { crystals: number; frame?: string | null; palette?: string | null }) {
  const estado = {
    crystals: inicial.crystals,
    frame: inicial.frame ?? null,
    palette: inicial.palette ?? null,
    cobros: 0,
  }
  const llamadas: Array<{ nombre: string; args: Record<string, unknown> }> = []

  const cliente = {
    rpc(nombre: string, args: Record<string, unknown>) {
      llamadas.push({ nombre, args })
      if (nombre !== 'comprar_cosmetico') {
        return Promise.resolve({ data: null, error: { code: 'PGRST202', message: 'rpc desconocida' } })
      }
      const id = String(args['p_cosmetico'])
      const coste = Number(args['p_coste'])
      const esMarco = id.startsWith('marco_')
      const actual = esMarco ? estado.frame : estado.palette

      if (actual === id) {
        return Promise.resolve({ data: [{ comprado: false, saldo: estado.crystals }], error: null })
      }
      if (estado.crystals < coste) {
        return Promise.resolve({ data: null, error: { code: 'DA001', message: 'saldo insuficiente' } })
      }
      estado.crystals -= coste
      estado.cobros += 1
      if (esMarco) estado.frame = id
      else estado.palette = id
      return Promise.resolve({ data: [{ comprado: true, saldo: estado.crystals }], error: null })
    },
  } as unknown as SupabaseClient

  return { cliente, estado, llamadas }
}

test('comprar cobra una vez, escribe la columna y el coste sale del CATÁLOGO', async () => {
  const { cliente, estado, llamadas } = clienteConEstado({ crystals: 500 })

  const resultado = await comprarCosmetico(cliente, { userId: 'u-1', cosmeticoId: 'marco_niebla' })

  assert.equal(resultado.comprado, true)
  assert.equal(resultado.saldo, 380)
  assert.equal(resultado.categoria, 'marco')
  assert.equal(estado.frame, 'marco_niebla')
  assert.equal(estado.cobros, 1)

  // Lo que viajó a la RPC: el usuario de la sesión y el coste DEL CATÁLOGO
  // (120, marco_niebla), nunca un número de quien llama — el envoltorio ni
  // siquiera tiene un parámetro donde ponerlo.
  assert.equal(llamadas.length, 1)
  assert.equal(llamadas[0]?.args['p_user'], 'u-1')
  assert.equal(llamadas[0]?.args['p_coste'], 120)
})

test('FALLO · sin saldo no se compra: DA001 → saldo_insuficiente y nada cambió', async () => {
  const { cliente, estado } = clienteConEstado({ crystals: 10 })

  await assert.rejects(
    () => comprarCosmetico(cliente, { userId: 'u-1', cosmeticoId: 'paleta_musgo' }),
    (error: unknown) => esErrorApi(error) && error.code === 'saldo_insuficiente',
  )
  assert.equal(estado.crystals, 10, 'un intento fallido no puede tocar el saldo')
  assert.equal(estado.palette, null)
  assert.equal(estado.cobros, 0)
})

test('el reintento del doble toque NO cobra dos veces: comprado=false y el saldo intacto', async () => {
  const { cliente, estado } = clienteConEstado({ crystals: 500 })

  const primera = await comprarCosmetico(cliente, { userId: 'u-1', cosmeticoId: 'paleta_amanecer' })
  const segunda = await comprarCosmetico(cliente, { userId: 'u-1', cosmeticoId: 'paleta_amanecer' })

  assert.equal(primera.comprado, true)
  assert.equal(primera.saldo, 300)
  assert.equal(segunda.comprado, false, 'el reintento tiene que reconocerse, no repetirse')
  assert.equal(segunda.saldo, 300, 'el saldo del reintento es el MISMO: no hubo segundo cobro')
  assert.equal(estado.cobros, 1)
})

test('FALLO · un tema o un id fuera del catálogo se rechazan ANTES de tocar la red', async () => {
  const { cliente, llamadas } = clienteConEstado({ crystals: 5000 })

  for (const malo of ['tema_nocturno_profundo', 'marco_mentor', 'diamante', '']) {
    await assert.rejects(
      () => comprarCosmetico(cliente, { userId: 'u-1', cosmeticoId: malo as IdCosmeticoComprable }),
      (error: unknown) => esErrorApi(error) && error.code === 'entrada_invalida',
      `«${malo}» tendría que ser entrada_invalida`,
    )
  }
  assert.equal(llamadas.length, 0, 'un id no comprable no puede llegar a la RPC')
})

test('FALLO · los SQLSTATE propios se traducen a códigos públicos, sin filtrar el mensaje de Postgres', () => {
  assert.equal(errorDeCosmetico({ code: 'DA001', message: 'saldo insuficiente' }).code, 'saldo_insuficiente')
  assert.equal(errorDeCosmetico({ code: 'DA002', message: 'perfil inexistente' }).code, 'no_encontrado')
  assert.equal(errorDeCosmetico({ code: 'DA006', message: 'cosmético inválido' }).code, 'entrada_invalida')
  // El CHECK de la lista cerrada desde el propio motor: la transacción entera
  // (cobro incluido) se revirtió, y para quien llama es una entrada inválida.
  assert.equal(errorDeCosmetico({ code: '23514', message: 'check violation' }).code, 'entrada_invalida')

  const raro = errorDeCosmetico({ code: '42P01', message: 'relation "profiles" does not exist' })
  assert.equal(raro.code, 'error_interno')
  assert.ok(!raro.message.includes('profiles'), 'el mensaje público no puede llevar el nombre de una tabla')
})

test('el límite de la ruta existe y es un límite de ruta de dinero', () => {
  // Vive en cosmeticos.ts por propiedad de archivos (pedido anotado para
  // moverlo a limites.ts); esto fija que no se quede en cero ni se dispare.
  assert.ok(LIMITE_PETICION_COSMETICO.limite >= 1)
  assert.ok(LIMITE_PETICION_COSMETICO.limite <= 60)
  assert.equal(LIMITE_PETICION_COSMETICO.ventanaSegundos, 3600)
})
