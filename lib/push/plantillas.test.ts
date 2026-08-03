import { test } from 'node:test'
import assert from 'node:assert/strict'

import { construirCarga, todosLosTextos } from './plantillas.ts'
import { TIPOS_NOTIFICACION } from './preferencias.ts'

// ── CAMINO FELIZ ────────────────────────────────────────────────────────────

test('3 · con alias el título lo lleva; sin alias dice «alguien»', () => {
  const conAlias = construirCarga({
    tipo: 'te_escucharon',
    aliasEmisor: 'Kai_23',
    url: '/post/abc',
  })
  assert.ok(conAlias.titulo.includes('Kai_23'))

  const sinAlias = construirCarga({ tipo: 'te_escucharon', aliasEmisor: null, url: '/post/abc' })
  assert.match(sinAlias.titulo.toLowerCase(), /alguien/)
  assert.equal(sinAlias.titulo.includes('Kai_23'), false)
})

test('la agrupación se anuncia agregada y sin nombrar a nadie', () => {
  const carga = construirCarga({
    tipo: 'te_escucharon',
    aliasEmisor: 'Kai_23',
    agregados: 3,
    url: '/post/abc',
  })

  assert.match(carga.titulo, /3 personas te escucharon/)
  // En un grupo, nombrar a uno expone a esa persona y no a las demás.
  assert.equal(JSON.stringify(carga).includes('Kai_23'), false)
})

test('la carga solo tiene los cuatro campos del contrato', () => {
  const carga = construirCarga({ tipo: 'te_ayudo', aliasEmisor: null, url: '/perfil' })
  assert.deepEqual(Object.keys(carga).sort(), ['cuerpo', 'tipo', 'titulo', 'url'])
})

test('una url que no es una ruta interna cae a /feed', () => {
  for (const url of ['https://evil.example/x', '//evil.example', 'javascript:alert(1)', '']) {
    const carga = construirCarga({ tipo: 'te_escucharon', aliasEmisor: null, url })
    assert.equal(carga.url, '/feed', `no debería aceptar ${url}`)
  }
  assert.equal(
    construirCarga({ tipo: 'te_escucharon', aliasEmisor: null, url: '/post/abc' }).url,
    '/post/abc',
  )
})

// ── 11 · ANTIADICCIÓN ───────────────────────────────────────────────────────

test('11 · ninguna plantilla contiene vocabulario de enganche', () => {
  // Tosco a propósito: existe para romperse el día que alguien añada un gancho.
  const prohibido = [
    'racha',
    'te echamos de menos',
    'vuelve',
    'no leído',
    'no leídos',
    'sin leer',
    'hace ',
    'días sin',
    'no te pierdas',
    'última oportunidad',
    'te esperamos',
  ]

  const textos = todosLosTextos()
  assert.ok(textos.length >= TIPOS_NOTIFICACION.length * 2)

  for (const texto of textos) {
    const minus = texto.toLowerCase()
    for (const palabra of prohibido) {
      assert.equal(
        minus.includes(palabra),
        false,
        `«${palabra}» aparece en una plantilla: «${texto}»`,
      )
    }
  }
})

test('11b · toda plantilla se puede leer como «alguien hizo algo por ti»', () => {
  // Comprobación estructural del catálogo: los seis tipos tienen texto, y no
  // hay ninguno de más (un tipo nuevo sin plantilla revienta aquí).
  for (const tipo of TIPOS_NOTIFICACION) {
    const carga = construirCarga({ tipo, aliasEmisor: null, url: '/feed' })
    assert.ok(carga.titulo.length > 0, `${tipo} sin título`)
    assert.ok(carga.cuerpo.length > 0, `${tipo} sin cuerpo`)
    // Ninguna plantilla anuncia cifras de actividad ajena.
    assert.equal(/\d+\s+(posts?|mensajes? sin|novedades)/i.test(carga.cuerpo), false)
  }
})

// ── 12 · ANONIMATO DEL CONTENIDO ────────────────────────────────────────────

test('12 · un texto de post de 500 caracteres no aparece en la carga, venga por donde venga', () => {
  const desahogo =
    'Hoy no he podido levantarme de la cama y no sé cómo contárselo a nadie. '.repeat(8).slice(0, 500)
  assert.equal(desahogo.length, 500)

  for (const tipo of TIPOS_NOTIFICACION) {
    // El único campo de texto libre de la firma es `aliasEmisor`: si alguien
    // cuela ahí el cuerpo del post, el saneado lo convierte en «alguien».
    const carga = construirCarga({ tipo, aliasEmisor: desahogo, url: '/feed' })
    const serializada = JSON.stringify(carga)

    assert.equal(serializada.includes(desahogo), false, `${tipo} filtra el texto entero`)
    // Ni siquiera un fragmento reconocible.
    assert.equal(
      serializada.includes(desahogo.slice(0, 40)),
      false,
      `${tipo} filtra un fragmento del texto`,
    )
    assert.equal(carga.cuerpo.length < 120, true, `${tipo} tiene un cuerpo sospechosamente largo`)
  }
})

test('12b · con aliasEmisor null, el alias no aparece en ninguna parte de la carga', () => {
  for (const tipo of TIPOS_NOTIFICACION) {
    const carga = construirCarga({ tipo, aliasEmisor: null, url: '/feed' })
    const serializada = JSON.stringify(carga).toLowerCase()
    // No hay campo suelto con el alias, ni id de autor, ni de post.
    for (const clave of ['alias', 'authorid', 'author_id', 'postid', 'post_id', 'emisor']) {
      assert.equal(serializada.includes(clave), false, `${tipo} lleva «${clave}» en la carga`)
    }
  }
})

test('12c · un alias que no cumple la restricción de profiles se trata como null', () => {
  const invalidos = [
    'a', // demasiado corto
    'x'.repeat(25), // demasiado largo
    '<script>alert(1)</script>',
    'con\nsalto',
    'emoji 🙂 fuera de la clase',
  ]

  for (const alias of invalidos) {
    const carga = construirCarga({ tipo: 'te_escucharon', aliasEmisor: alias, url: '/feed' })
    assert.match(carga.titulo.toLowerCase(), /alguien/, `«${alias}» no debería revelarse`)
    // La comprobación de inclusión solo tiene sentido con cadenas
    // distintivas: buscar 'a' dentro de un texto en español siempre acierta.
    if (alias.length >= 5) {
      assert.equal(JSON.stringify(carga).includes(alias), false)
    }
  }
})
