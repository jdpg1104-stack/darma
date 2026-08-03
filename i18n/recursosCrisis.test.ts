import test from 'node:test'
import assert from 'node:assert/strict'

import {
  RECURSOS_POR_PAIS,
  PAISES_SOPORTADOS,
  VENTANA_VERIFICACION_DIAS,
  PENDIENTES_DECLARADOS,
  recursosParaPais,
  recursosPendientesDeVerificacion,
  recursosCaducados,
  tablaListaParaProduccion,
  todosLosRecursos,
  idDeRecurso,
  diasDesde,
  CLAVE_EMERGENCIAS_LOCALES,
} from './recursosCrisis.ts'
import { aplanar, type Catalogo } from './catalogo.ts'
import mensajesEs from '../messages/es.json' with { type: 'json' }
import mensajesEn from '../messages/en.json' with { type: 'json' }
import type { CodigoPais } from './pais.ts'

const PAISES_OBLIGATORIOS = ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'US', 'GB'] as const

// ── EL requisito central del bloque: país, no idioma ────────────────────────

test('recursosParaPais("ES") da el 024 y el 112, los dos gratuitos', () => {
  const { recursos } = recursosParaPais('ES')
  const valores = recursos.map((r) => r.valor)
  assert.ok(valores.includes('024'), `esperaba el 024 en ES, hay: ${valores.join(', ')}`)
  assert.ok(valores.includes('112'), `esperaba el 112 en ES, hay: ${valores.join(', ')}`)
  for (const valor of ['024', '112']) {
    const recurso = recursos.find((r) => r.valor === valor)
    assert.equal(recurso?.gratuito, true, `${valor} debería ser gratuito`)
  }
})

test('recursosParaPais("US") da el 988', () => {
  const valores = recursosParaPais('US').recursos.map((r) => r.valor)
  assert.ok(valores.includes('988'), `esperaba el 988 en US, hay: ${valores.join(', ')}`)
})

test('EL REQUISITO DURO: el idioma NO cambia los recursos de un país', () => {
  // No hay ningún parámetro de idioma que pasar, y ese es el punto: la firma
  // pública no lo acepta. Se comprueba además que la respuesta es idéntica
  // llame quien la llame, y que un hispanohablante en EE. UU. NO recibe el 024.
  const us = recursosParaPais('US')
  assert.deepEqual(us, recursosParaPais('US'))
  assert.equal(us.pais, 'US')

  const valoresUs = us.recursos.map((r) => r.valor)
  assert.ok(valoresUs.includes('988'))
  assert.ok(!valoresUs.includes('024'), 'el 024 español no puede aparecer en US')
  assert.ok(!valoresUs.includes('112'), 'el 112 europeo no puede aparecer en US')

  // Y al revés: alguien que lee la app en inglés desde España sigue viendo el 024.
  const es = recursosParaPais('ES')
  assert.ok(es.recursos.some((r) => r.valor === '024'))
  assert.ok(!es.recursos.some((r) => r.valor === '988'), 'el 988 no puede aparecer en ES')

  // La línea estadounidense atiende en español; eso NO la convierte en la línea
  // de un hispanohablante en España. Idioma de atención ≠ país.
  const lifeline = us.recursos.find((r) => r.valor === '988')
  assert.ok(lifeline?.idiomasAtencion.includes('es'))
})

test('la firma de recursosParaPais RECHAZA un locale en tiempo de tipos', () => {
  // @ts-expect-error un Locale no es un país: el error no se puede ni escribir.
  const conLocale = recursosParaPais('es')
  // En ejecución cae al fallback, que es lo correcto: 'es' no es un país.
  assert.equal(conLocale.pais, 'INTERNACIONAL')

  // @ts-expect-error 'en' tampoco.
  assert.equal(recursosParaPais('en').pais, 'INTERNACIONAL')
})

// ── Camino de fallo ─────────────────────────────────────────────────────────

test('null, país desconocido y minúsculas → INTERNACIONAL, nunca vacío', () => {
  const casos: (CodigoPais | null)[] = [null, 'ZZ', 'es' as CodigoPais, 'xx' as CodigoPais, '']
  for (const caso of casos) {
    const resultado = recursosParaPais(caso)
    assert.equal(resultado.pais, 'INTERNACIONAL', `caso ${JSON.stringify(caso)}`)
    assert.ok(
      resultado.recursos.length > 0,
      'una tarjeta de crisis vacía es peor que no mostrarla',
    )
  }
})

test('claves peligrosas → INTERNACIONAL, ni función ni prototipo contaminado', () => {
  for (const clave of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
    const resultado = recursosParaPais(clave as CodigoPais)
    assert.equal(resultado.pais, 'INTERNACIONAL', `clave ${clave}`)
    assert.equal(typeof resultado, 'object')
    assert.ok(resultado.recursos.length > 0)
  }

  // El mapa no tiene prototipo: buscar una clave heredada no devuelve nada.
  assert.equal(Object.getPrototypeOf(RECURSOS_POR_PAIS), null)
  assert.equal(Object.hasOwn(RECURSOS_POR_PAIS, '__proto__'), false)

  // Y nada de lo anterior ha ensuciado Object.prototype.
  const sonda = {} as Record<string, unknown>
  assert.equal(sonda.pais, undefined)
})

test('el mapa está congelado: nadie cambia en caliente un número de crisis', () => {
  assert.equal(Object.isFrozen(RECURSOS_POR_PAIS), true)
  assert.equal(Object.isFrozen(RECURSOS_POR_PAIS.ES), true)
  assert.equal(Object.isFrozen(RECURSOS_POR_PAIS.ES.recursos), true)
  assert.throws(() => {
    RECURSOS_POR_PAIS.ES.recursos[0].valor = '000'
  }, TypeError)
})

// ── Cobertura y forma de los datos ──────────────────────────────────────────

test('cobertura: los 8 países del lanzamiento + INTERNACIONAL', () => {
  for (const pais of PAISES_OBLIGATORIOS) {
    assert.ok(Object.hasOwn(RECURSOS_POR_PAIS, pais), `falta el país ${pais}`)
    assert.ok(recursosParaPais(pais).recursos.length > 0, `${pais} sin recursos`)
  }
  assert.ok(Object.hasOwn(RECURSOS_POR_PAIS, 'INTERNACIONAL'))
  assert.deepEqual([...PAISES_SOPORTADOS].sort(), [...PAISES_OBLIGATORIOS].sort())
})

test('cada país lleva SIEMPRE su número de emergencias además de la línea', () => {
  for (const pais of PAISES_OBLIGATORIOS) {
    const recursos = recursosParaPais(pais).recursos
    assert.ok(
      recursos.some((r) => r.tipo === 'emergencias'),
      `${pais} no tiene número de emergencias: si la línea especializada está saturada no hay alternativa`,
    )
  }
})

test('formato: teléfonos sin espacios ni guiones; web y chat en https', () => {
  for (const clave of Object.keys(RECURSOS_POR_PAIS)) {
    for (const recurso of RECURSOS_POR_PAIS[clave].recursos) {
      const etiqueta = `${clave} · ${recurso.nombre}`

      if (recurso.tipo === 'telefono' || recurso.tipo === 'emergencias' || recurso.tipo === 'sms') {
        assert.ok(
          /^[+*#0-9]+$/.test(recurso.valor),
          `${etiqueta}: "${recurso.valor}" tiene espacios, guiones o letras y no se puede marcar`,
        )
      }

      if (recurso.tipo === 'web' || recurso.tipo === 'chat') {
        assert.ok(
          recurso.valor.startsWith('https://'),
          `${etiqueta}: "${recurso.valor}" no empieza por https://`,
        )
      }

      assert.ok(recurso.fuente.startsWith('https://'), `${etiqueta}: la fuente no es https`)
      assert.ok(recurso.idiomasAtencion.length > 0, `${etiqueta}: sin idiomas de atención`)
      for (const idioma of recurso.idiomasAtencion) {
        assert.match(idioma, /^[a-z]{2}$/, `${etiqueta}: idioma "${idioma}" no es ISO-639-1 base`)
      }
      assert.ok(recurso.nombre.trim().length > 0, `${etiqueta}: sin nombre`)
      assert.ok(recurso.horario.trim().length > 0, `${etiqueta}: sin horario`)
    }
  }
})

test('toda descripcionKey existe en los DOS catálogos', () => {
  const planos = {
    es: aplanar(mensajesEs as Catalogo),
    en: aplanar(mensajesEn as Catalogo),
  }
  for (const pais of Object.keys(RECURSOS_POR_PAIS)) {
    for (const recurso of RECURSOS_POR_PAIS[pais].recursos) {
      for (const [idioma, plano] of Object.entries(planos)) {
        assert.ok(
          plano.has(recurso.descripcionKey),
          `${pais} · ${recurso.nombre}: la clave "${recurso.descripcionKey}" no existe en ${idioma}.json`,
        )
      }
    }
  }

  for (const [idioma, plano] of Object.entries(planos)) {
    assert.ok(
      plano.has(CLAVE_EMERGENCIAS_LOCALES),
      `falta "${CLAVE_EMERGENCIAS_LOCALES}" en ${idioma}.json`,
    )
  }
})

// ── Caducidad y verificación humana ─────────────────────────────────────────

test('ningún recurso con verificadoEn de más de 180 días', () => {
  const caducados = recursosCaducados()
  const detalle = caducados
    .map((e) => `${e.pais} · ${e.nombre} (revisado ${e.verificadoEn})`)
    .join('\n  ')
  assert.equal(
    caducados.length,
    0,
    `estos recursos llevan más de ${VENTANA_VERIFICACION_DIAS} días sin revisar:\n  ${detalle}`,
  )
})

test('el guard de caducidad FALLA cuando debe: nombra país y organización', () => {
  // Un año después de la fecha de escritura, todo lo de la tabla está caducado.
  const dentroDeUnAno = new Date('2027-08-03T00:00:00Z')
  const caducados = recursosCaducados(dentroDeUnAno)
  assert.ok(caducados.length > 0, 'el guard no detecta nada caducado: es inútil')

  const primero = caducados.find((e) => e.pais === 'ES')
  assert.ok(primero, 'el informe debería incluir el país')
  assert.ok(primero.nombre.length > 0, 'el informe debería incluir la organización')

  // Y una fecha ilegible cuenta como caducada: ante la duda, revisar.
  assert.equal(diasDesde('no-es-una-fecha'), Number.POSITIVE_INFINITY)
})

test('inventario de verificación: nadie cuela un teléfono nuevo en silencio', () => {
  const pendientes = recursosPendientesDeVerificacion().map(idDeRecurso).sort()
  const declarados = [...PENDIENTES_DECLARADOS].sort()

  const sinDeclarar = pendientes.filter((id) => !declarados.includes(id))
  const declaradosDeMas = declarados.filter((id) => !pendientes.includes(id))

  assert.deepEqual(
    sinDeclarar,
    [],
    'hay recursos SIN verificar que no están en PENDIENTES_DECLARADOS. ' +
      'Añade un teléfono en dos sitios o no lo añadas.',
  )
  assert.deepEqual(
    declaradosDeMas,
    [],
    'PENDIENTES_DECLARADOS nombra recursos que ya no existen o que ya están ' +
      'verificados: actualiza el inventario.',
  )
})

test('la tabla NO está lista para producción y lo dice en voz alta', () => {
  // Esta prueba documenta el estado real: ningún número lo ha confirmado un
  // humano contra su fuente. Cuando alguien verifique los 24 recursos, esta
  // aserción se invierte a `true` y `tablaListaParaProduccion()` es el gate que
  // B15 puede colgar del despliegue a producción.
  assert.equal(tablaListaParaProduccion(), false)
  assert.equal(recursosPendientesDeVerificacion().length, todosLosRecursos().length)
  for (const entrada of recursosPendientesDeVerificacion()) {
    assert.equal(entrada.verificadoPor, null)
    assert.ok(entrada.fuente.startsWith('https://'), 'sin fuente no hay verificación posible')
  }
})
