import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ejecutar,
  esBuildDeProduccion,
  evaluarGate,
  formatearGate,
  type EstadoGate,
} from './gateTelefonos.ts'
import { recursosPendientesDeVerificacion, tablaListaParaProduccion } from '../../i18n/recursosCrisis.ts'

// ── Qué entorno cuenta como producción ──────────────────────────────────────

test('solo VERCEL_ENV=production —o el forzado explícito— exige el gate', () => {
  assert.equal(esBuildDeProduccion({ VERCEL_ENV: 'production' }), true)
  assert.equal(esBuildDeProduccion({ DARMA_EXIGIR_TELEFONOS: '1' }), true)

  // Todo lo demás informa y deja pasar. Si esto se rompiera, el CI y cualquier
  // build local empezarían a fallar y el guard acabaría desactivado.
  assert.equal(esBuildDeProduccion({ VERCEL_ENV: 'preview' }), false)
  assert.equal(esBuildDeProduccion({ VERCEL_ENV: 'development' }), false)
  assert.equal(esBuildDeProduccion({}), false)
  assert.equal(esBuildDeProduccion({ DARMA_EXIGIR_TELEFONOS: '0' }), false)
})

// ── El estado real de la tabla ──────────────────────────────────────────────

test('el gate refleja lo que dice la tabla, sin duplicar su lógica', () => {
  const estado = evaluarGate({}, new Date('2026-08-04T00:00:00.000Z'))
  assert.equal(estado.pendientes.length, recursosPendientesDeVerificacion().length)
  // `listo` NO puede ser true mientras `tablaListaParaProduccion()` sea false.
  if (!tablaListaParaProduccion()) assert.equal(estado.listo, false)
})

test('un recurso caducado impide el despliegue aunque estuviera verificado', () => {
  // La tabla se escribió en 2026-08; en 2030 toda verificación de entonces está
  // fuera de la ventana de 180 días. Un teléfono verificado hace cuatro años es
  // tan peligroso como uno sin verificar: las líneas cambian de número.
  const estado = evaluarGate({}, new Date('2030-01-01T00:00:00.000Z'))
  assert.ok(estado.caducados.length > 0, 'en 2030 nada puede seguir fresco')
  assert.equal(estado.listo, false)
})

// ── Códigos de salida: lo que de verdad frena o no frena ────────────────────

test('🔴 con la tabla incompleta, un build de PRODUCCIÓN falla', () => {
  assert.equal(tablaListaParaProduccion(), false, 'si esto cambia, revisa el resto de la prueba')
  assert.equal(ejecutar({ VERCEL_ENV: 'production' }), 1)
  assert.equal(ejecutar({ DARMA_EXIGIR_TELEFONOS: '1' }), 1)
})

test('🔴 y con la tabla incompleta, CI y local NO fallan', () => {
  // Es la mitad que sostiene a la otra. Un guard que deja `main` en rojo durante
  // semanas enseña a fusionar por encima del CI, y entonces deja de frenar nada.
  assert.equal(ejecutar({}), 0)
  assert.equal(ejecutar({ VERCEL_ENV: 'preview' }), 0)
  assert.equal(ejecutar({ CI: 'true' }), 0)
})

// ── El informe ──────────────────────────────────────────────────────────────

test('el informe lista lo que falta y dice cómo cerrarlo', () => {
  const texto = formatearGate(evaluarGate({ VERCEL_ENV: 'production' }))
  assert.match(texto, /sin confirmar por una persona/)
  assert.match(texto, /verificadoPor/)
  assert.match(texto, /PENDIENTES_DECLARADOS/)
  // Y deja claro que este build concreto se detiene.
  assert.match(texto, /SE DETIENE AQUÍ/)
})

test('fuera de producción el informe dice que solo informa', () => {
  const texto = formatearGate(evaluarGate({}))
  assert.doesNotMatch(texto, /SE DETIENE AQUÍ/)
  assert.match(texto, /solo se informa/)
})

test('con la tabla lista el informe es una línea, no un muro', () => {
  const listo: EstadoGate = { listo: true, exigido: true, pendientes: [], caducados: [] }
  const texto = formatearGate(listo)
  assert.match(texto, /los 24 verificados/)
  assert.equal(texto.includes('═'), false)
})
