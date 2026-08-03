import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assessCrisisRisk,
  escalate,
  requiresIntervention,
  helpResourcesFor,
  helpHoursKey,
  crisisMessage,
  HELP_RESOURCES,
  INTERNATIONAL_FALLBACK,
  RECURSOS_POR_PAIS,
  tablaListaParaProduccion,
  type RiskLevel,
} from './crisis.ts'

// ── La regla de oro ─────────────────────────────────────────────────────────

test('escalate: SOLO sube, nunca baja', () => {
  const niveles: RiskLevel[] = ['none', 'low', 'high', 'critical']
  for (const a of niveles) {
    for (const b of niveles) {
      const r = escalate(a, b)
      const orden = niveles.indexOf(r)
      assert.ok(orden >= niveles.indexOf(a), `escalate(${a}, ${b}) bajó el riesgo a ${r}`)
      assert.ok(orden >= niveles.indexOf(b), `escalate(${a}, ${b}) ignoró la señal entrante`)
    }
  }
})

test('escalate: es idempotente y conmutativo (es un máximo)', () => {
  assert.equal(escalate('high', 'high'), 'high')
  assert.equal(escalate('low', 'critical'), escalate('critical', 'low'))
})

test('requiresIntervention: a partir de high', () => {
  assert.equal(requiresIntervention('none'), false)
  assert.equal(requiresIntervention('low'), false)
  assert.equal(requiresIntervention('high'), true)
  assert.equal(requiresIntervention('critical'), true)
})

// ── Detección ───────────────────────────────────────────────────────────────

test('texto neutro: sin riesgo y sin señales', () => {
  const r = assessCrisisRisk('Hoy he ido al parque con mi perro y me he encontrado con una amiga.')
  assert.equal(r.risk_level, 'none')
  assert.deepEqual(r.signals, [])
  assert.equal(r.requiresIntervention, false)
})

test('ideación explícita en español → high', () => {
  for (const texto of [
    'quiero morirme',
    'me quiero morir y no se lo he dicho a nadie',
    'llevo semanas pensando en suicidarme',
    'no quiero seguir viviendo así',
    'me corto cuando no puedo con la ansiedad',
  ]) {
    const r = assessCrisisRisk(texto)
    assert.ok(['high', 'critical'].includes(r.risk_level), `"${texto}" debería marcar riesgo alto, dio ${r.risk_level}`)
    assert.equal(r.requiresIntervention, true)
  }
})

test('ideación explícita en inglés → high', () => {
  for (const texto of [
    'i want to die',
    'sometimes i think about killing myself',
    'i feel suicidal lately',
    'they would be better off without me',
  ]) {
    const r = assessCrisisRisk(texto)
    assert.ok(['high', 'critical'].includes(r.risk_level), `"${texto}" dio ${r.risk_level}`)
  }
})

test('mayúsculas y tildes no esquivan la detección', () => {
  assert.equal(assessCrisisRisk('QUIERO MORÍRME!!!').risk_level, 'high')
  assert.equal(assessCrisisRisk('Quiero Morirme...').risk_level, 'high')
})

test('plan, medio o despedida → critical', () => {
  for (const texto of [
    'esta noche voy a acabar con todo',
    'gracias por todo, adios',
    'he comprado pastillas suficientes',
    'tonight i will end it',
  ]) {
    const r = assessCrisisRisk(texto)
    assert.equal(r.risk_level, 'critical', `"${texto}" dio ${r.risk_level}`)
  }
})

test('desesperanza sin ideación → low (no bloquea nada, solo ofrece recursos)', () => {
  const r = assessCrisisRisk('no puedo mas con todo esto, estoy agotado')
  assert.equal(r.risk_level, 'low')
  assert.equal(r.requiresIntervention, false)
})

test('el nivel es el MÁXIMO de las señales, no la suma', () => {
  const r = assessCrisisRisk('estoy completamente solo, no puedo mas, soy una carga para todos')
  // Tres señales 'low' NO equivalen a una 'high'.
  assert.ok(r.signals.length >= 2)
  assert.equal(r.risk_level, 'low')
})

test('las señales vienen ordenadas de más grave a menos', () => {
  const r = assessCrisisRisk('no puedo mas, quiero morirme, estoy completamente solo')
  assert.equal(r.risk_level, 'high')
  assert.equal(r.signals[0]!.level, 'high')
})

test('tercera persona: modula critical → high, pero NUNCA descarta', () => {
  const r = assessCrisisRisk('mi hermana ya ha escrito una carta de despedida')
  assert.equal(r.thirdPartyContext, true)
  assert.equal(r.risk_level, 'high', 'debe seguir exigiendo intervención')
  assert.equal(r.requiresIntervention, true)
})

test('tercera persona: NO baja de high a low ni a none', () => {
  // Señal de ideación (high) con contexto de tercera persona: sigue siendo high.
  const r = assessCrisisRisk('mi amiga me ha dicho que tiene ideas suicidas y no se que hacer')
  assert.equal(r.thirdPartyContext, true)
  assert.equal(r.risk_level, 'high')
  assert.equal(r.requiresIntervention, true)
})

test('tercera persona: el único efecto permitido es critical → high', () => {
  // Mismo texto crítico, con y sin marca de tercera persona: como mucho baja un
  // escalón, y nunca por debajo de high.
  const conTercero = assessCrisisRisk('mi hermana ya ha escrito una carta de despedida')
  const sinTercero = assessCrisisRisk('ya ha escrito una carta de despedida')
  assert.equal(sinTercero.risk_level, 'critical')
  assert.equal(conTercero.risk_level, 'high')
})

test('primera persona clara mantiene el nivel crítico aunque se cite a un familiar', () => {
  const r = assessCrisisRisk('mi hermana no lo sabe pero yo ya he escrito la carta')
  assert.equal(r.risk_level, 'critical')
})

test('es determinista y no depende del reloj', () => {
  const texto = 'quiero morirme y no puedo mas'
  assert.deepEqual(assessCrisisRisk(texto), assessCrisisRisk(texto))
})

test('falsos positivos aceptables: se prefiere marcar de más', () => {
  // Frase coloquial y no literal. Que la marque como 'low' es el
  // comportamiento deseado, no un bug.
  const r = assessCrisisRisk('este examen me ha matado, no puedo mas')
  assert.equal(r.risk_level, 'low')
  assert.equal(r.requiresIntervention, false, 'un falso positivo no debe bloquear nada')
})

// ── Recursos ────────────────────────────────────────────────────────────────

test('nunca se devuelve una lista de recursos vacía', () => {
  for (const pais of ['ES', 'MX', 'AR', 'CO', 'CL', 'PE', 'US', 'GB', 'ZZ', 'xx', null, undefined, '']) {
    const recursos = helpResourcesFor(pais)
    assert.ok(recursos.length > 0, `${pais} se quedó sin recursos`)
  }
})

test('un país desconocido cae en el directorio internacional', () => {
  assert.deepEqual(helpResourcesFor('ZZ'), INTERNATIONAL_FALLBACK)
  assert.deepEqual(helpResourcesFor(null), INTERNATIONAL_FALLBACK)
  assert.deepEqual(helpResourcesFor('basura'), INTERNATIONAL_FALLBACK)
})

test('el directorio internacional no lleva NINGÚN teléfono nacional', () => {
  // Dar el 024 a alguien en Manila es peor que no dar nada.
  for (const r of INTERNATIONAL_FALLBACK) {
    assert.equal(r.phone, undefined, `${r.name} cuela un teléfono en el bloque internacional`)
  }
})

test('un LOCALE no es un país: `es` NO devuelve los teléfonos de España', () => {
  // Este era el bug: `toUpperCase()` convertía el idioma español en el país ES,
  // así que alguien en Estados Unidos con la interfaz en español podía acabar
  // viendo el 024. El eje del idioma no puede elegir el teléfono.
  assert.deepEqual(helpResourcesFor('es'), INTERNATIONAL_FALLBACK)
  assert.deepEqual(helpResourcesFor('en'), INTERNATIONAL_FALLBACK)
  // Y el país en mayúsculas sigue funcionando, que es como llega de verdad
  // (`lib/auth/peticion.ts` normaliza la cabecera del edge).
  assert.deepEqual(helpResourcesFor('ES'), HELP_RESOURCES.ES)
})

test('todo recurso tiene teléfono o url, y fecha de revisión', () => {
  const todos = [...Object.values(HELP_RESOURCES).flat(), ...INTERNATIONAL_FALLBACK]
  for (const r of todos) {
    assert.ok(r.phone || r.url, `${r.name} no tiene forma de contacto`)
    assert.match(r.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${r.name} sin fecha de revisión válida`)
    assert.ok(r.hours.length > 0)
    assert.ok(r.source.startsWith('https://'), `${r.name} sin fuente contra la que verificar`)
  }
})

test('los números NO se dan por verificados: `verifiedBy` sigue en null', () => {
  // Si esto falla porque alguien verificó de verdad, quita su entrada aquí y en
  // `PENDIENTES_DECLARADOS`. Si falla porque alguien puso un nombre sin abrir la
  // fuente, es exactamente lo que este test existe para impedir.
  const todos = [...Object.values(HELP_RESOURCES).flat(), ...INTERNATIONAL_FALLBACK]
  assert.ok(todos.every((r) => r.verifiedBy === null))
  assert.equal(tablaListaParaProduccion(), false)
})

// ── Que la tabla sea UNA sola ───────────────────────────────────────────────

test('los recursos son EXACTAMENTE los de i18n/recursosCrisis.ts', () => {
  // El adaptador cambia la FORMA, nunca el dato. Si algún día vuelve a haber
  // dos tablas, este test lo dice antes que un usuario.
  for (const clave of Object.keys(RECURSOS_POR_PAIS)) {
    const original = RECURSOS_POR_PAIS[clave]!.recursos
    const adaptados = clave === 'INTERNACIONAL' ? INTERNATIONAL_FALLBACK : HELP_RESOURCES[clave]!
    assert.equal(adaptados.length, original.length, `${clave}: se pierden recursos por el camino`)
    for (const [i, r] of original.entries()) {
      const a = adaptados[i]!
      assert.equal(a.name, r.nombre)
      assert.equal(a.hours, r.horario)
      assert.equal(a.verifiedAt, r.verificadoEn)
      // El valor aparece intacto en `phone` o dentro de la `url` (`sms:`).
      assert.ok(
        a.phone === r.valor || a.url === r.valor || a.url === `sms:${r.valor}`,
        `${clave}/${r.nombre}: el valor se transformó (${a.phone ?? a.url} ≠ ${r.valor})`,
      )
    }
  }
})

test('helpResourcesFor delega en recursosParaPais para todos los países', () => {
  for (const clave of Object.keys(RECURSOS_POR_PAIS)) {
    if (clave === 'INTERNACIONAL') continue
    const porNombre = helpResourcesFor(clave).map((r) => r.name)
    assert.deepEqual(porNombre, [...RECURSOS_POR_PAIS[clave]!.recursos].map((r) => r.nombre))
  }
})

test('cada país tiene su número de EMERGENCIAS, no solo la línea de escucha', () => {
  // En la tabla vieja de este archivo faltaba en PE, US y GB: si la línea está
  // saturada —y en crisis lo están— tiene que haber otra puerta en la misma
  // tarjeta.
  for (const clave of Object.keys(HELP_RESOURCES)) {
    assert.ok(
      HELP_RESOURCES[clave]!.some((r) => r.type === 'emergencias'),
      `${clave} no ofrece número de emergencias`,
    )
  }
})

test('España sigue dando el 024 y el 112; Estados Unidos el 988 y el 911', () => {
  const es = HELP_RESOURCES.ES!.map((r) => r.phone)
  assert.ok(es.includes('024'))
  assert.ok(es.includes('112'))
  const us = HELP_RESOURCES.US!.map((r) => r.phone)
  assert.ok(us.includes('988'))
  assert.ok(us.includes('911'), 'el 988 sin el 911 deja fuera el peligro inmediato')
})

test('las líneas de SMS no se pintan como `tel:`', () => {
  // Marcar un número de SMS abre el teléfono y no llama a nadie.
  const sms = Object.values(HELP_RESOURCES)
    .flat()
    .filter((r) => r.type === 'sms')
  assert.ok(sms.length > 0, 'la tabla tenía líneas de SMS; si ya no, borra este test')
  for (const r of sms) {
    assert.equal(r.phone, undefined, `${r.name} se ofrece como teléfono marcable`)
    assert.match(r.url ?? '', /^sms:/)
  }
})

// ── Horarios: dato en español dentro de pantallas traducidas ────────────────

test('los horarios traducibles traen su clave de catálogo', () => {
  assert.equal(helpHoursKey('24/7'), 'crisis.horario.veinticuatroSiete')
  assert.equal(helpHoursKey('Según el país'), 'crisis.horario.segunPais')
  // Lo que no está en la lista cerrada se pinta literal, nunca como clave suelta.
  assert.equal(helpHoursKey('De 9 a 21'), null)

  const todos = [...Object.values(HELP_RESOURCES).flat(), ...INTERNATIONAL_FALLBACK]
  for (const r of todos) {
    assert.equal(r.hoursKey, helpHoursKey(r.hours), `${r.name}: hoursKey descuadra`)
  }
})

test('el mensaje nunca promete que Darma sustituye a un profesional', () => {
  for (const level of ['none', 'low', 'high', 'critical'] as const) {
    const msg = crisisMessage(level)
    assert.ok(msg.length > 0)
    assert.ok(!/te vamos a curar|te curaremos/i.test(msg))
    // Si aparece "somos profesionales", tiene que ser negado.
    assert.ok(!/(?<!no )somos profesionales/i.test(msg), `mensaje ambiguo: "${msg}"`)
  }
  assert.match(crisisMessage('critical'), /no somos profesionales/)
  assert.match(crisisMessage('high'), /no sustituye/)
})

test('el mensaje no suena a vigilancia', () => {
  for (const level of ['low', 'high', 'critical'] as const) {
    assert.ok(!/hemos detectado/i.test(crisisMessage(level)))
  }
})
