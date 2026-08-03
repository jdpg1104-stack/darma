// ============================================================================
// Pruebas de la validación de la query string.
//
// La que de verdad importa es la de `limite=500`: tiene que FALLAR, no
// recortarse. Un recorte silencioso convierte un cliente roto en un bug que
// nadie ve durante meses — alguien pide 500, recibe 20 y concluye que el feed
// solo tiene 20 elementos.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import { esErrorApi } from '../../../lib/auth/errores.ts'
import {
  LIMITE_MAXIMO,
  LIMITE_POR_DEFECTO,
  esCarril,
  idiomaDeContenido,
  parsearParametros,
} from './validacion.ts'

function params(entrada: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entrada)
}

test('sin parámetros: carril «para_ti», límite por defecto, sin cursor', () => {
  const resultado = parsearParametros(params({}))
  assert.deepEqual(resultado, { cursor: null, limite: LIMITE_POR_DEFECTO, carril: 'para_ti' })
})

test('acepta el límite máximo y el mínimo', () => {
  assert.equal(parsearParametros(params({ limite: '1' })).limite, 1)
  assert.equal(parsearParametros(params({ limite: String(LIMITE_MAXIMO) })).limite, LIMITE_MAXIMO)
})

test('acepta los dos carriles del enum cerrado', () => {
  assert.equal(parsearParametros(params({ carril: 'para_ti' })).carril, 'para_ti')
  assert.equal(parsearParametros(params({ carril: 'nuevo' })).carril, 'nuevo')
})

// ── Caminos de fallo ────────────────────────────────────────────────────────

function esperarEntradaInvalida(entrada: Record<string, string>, motivo: string) {
  assert.throws(
    () => parsearParametros(params(entrada)),
    (error: unknown) => {
      assert.ok(esErrorApi(error), `no es un ErrorApi: ${motivo}`)
      assert.equal(error.code, 'entrada_invalida')
      assert.equal(error.status, 422)
      // El detalle de zod describe la forma exacta de la validación: es
      // información sobre el sistema y no puede llegar al cliente.
      assert.ok(!/zod|invalid_type|expected/i.test(error.message), 'el mensaje filtra detalle de zod')
      return true
    },
    motivo,
  )
}

test('FALLO · limite=500 es entrada_invalida, NO un límite recortado en silencio', () => {
  esperarEntradaInvalida({ limite: '500' }, 'limite=500')
})

test('FALLO · límites imposibles se rechazan uno a uno', () => {
  esperarEntradaInvalida({ limite: '0' }, 'limite=0')
  esperarEntradaInvalida({ limite: '-3' }, 'limite negativo')
  esperarEntradaInvalida({ limite: '2.5' }, 'limite decimal')
  esperarEntradaInvalida({ limite: 'muchos' }, 'limite no numérico')
  esperarEntradaInvalida({ limite: '51' }, 'limite justo por encima del máximo')
})

test('FALLO · un carril inventado se rechaza (cada carril es un índice)', () => {
  esperarEntradaInvalida({ carril: 'aleatorio' }, 'carril inexistente')
  esperarEntradaInvalida({ carril: 'PARA_TI' }, 'carril con otra caja')
})

test('FALLO · un cursor de más de 256 caracteres se rechaza (DoS barato)', () => {
  esperarEntradaInvalida({ cursor: 'x'.repeat(257) }, 'cursor de 257')
  // Y uno de 4 KB, que es el caso real: barato de enviar, caro de decodificar.
  esperarEntradaInvalida({ cursor: 'x'.repeat(4096) }, 'cursor de 4 KB')
})

test('esCarril solo acepta los valores del contrato', () => {
  assert.equal(esCarril('para_ti'), true)
  assert.equal(esCarril('nuevo'), true)
  assert.equal(esCarril('otro'), false)
  assert.equal(esCarril(null), false)
  assert.equal(esCarril(undefined), false)
})

test('el idioma del contenido cae en «es» ante cualquier cosa desconocida', () => {
  assert.equal(idiomaDeContenido('en-GB,en;q=0.9'), 'en')
  assert.equal(idiomaDeContenido('es-ES,es;q=0.9'), 'es')
  // 'fr' no tiene catálogo: devolverlo vaciaría el carril de contenido en
  // silencio, que es peor que mostrar el catálogo en español.
  assert.equal(idiomaDeContenido('fr-FR'), 'es')
  assert.equal(idiomaDeContenido(null), 'es')
  assert.equal(idiomaDeContenido(''), 'es')
})
