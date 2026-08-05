// ============================================================================
// B10 · Pruebas del dominio de creación de círculos.
//
// Lo que se prueba es la LÓGICA PURA de la selección (límites 2..7 personas
// contando a quien crea, tope al marcar, invitadas sin sobre) y que una
// selección que este dominio da por buena produce un cuerpo que
// `esquemaCrearRefugio` acepta: el techo del cliente tiene que caber SIEMPRE
// dentro del techo del servidor, y este test es lo que impide que diverjan sin
// que nadie lo note.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_INVITADOS_CIRCULO,
  MAX_MIEMBROS_CIRCULO,
  MIN_INVITADOS_CIRCULO,
  MIN_MIEMBROS_CIRCULO,
  TITULO_MAX,
  aliasesDe,
  alternarInvitado,
  invitadosSinSobre,
  miembrosTotales,
  normalizarTitulo,
  validarSeleccion,
} from './circulo.dominio.ts'
import { esquemaCrearRefugio } from '../../app/api/refuges/_dominio/validacion.ts'

/** uuids válidos y deterministas: `indice` 1..n. */
function uuidDePrueba(indice: number): string {
  return `00000000-0000-4000-8000-${String(indice).padStart(12, '0')}`
}

function seleccionDe(n: number): ReadonlySet<string> {
  return new Set(Array.from({ length: n }, (_, i) => uuidDePrueba(i + 1)))
}

// ── Límites 2..7 ────────────────────────────────────────────────────────────

test('los límites del círculo: de 2 a 7 personas contando a quien crea', () => {
  assert.equal(MIN_MIEMBROS_CIRCULO, 2)
  assert.equal(MAX_MIEMBROS_CIRCULO, 7)
  // Los topes de invitadas son SIEMPRE los de miembros menos quien crea: si
  // alguien cambia uno sin el otro, esto es lo que se pone rojo.
  assert.equal(MIN_INVITADOS_CIRCULO, MIN_MIEMBROS_CIRCULO - 1)
  assert.equal(MAX_INVITADOS_CIRCULO, MAX_MIEMBROS_CIRCULO - 1)
})

test('una selección de 1 a 6 invitadas es válida; 0 y 7 no', () => {
  assert.deepEqual(validarSeleccion(seleccionDe(0)), { ok: false, motivo: 'sin_nadie' })

  for (let n = MIN_INVITADOS_CIRCULO; n <= MAX_INVITADOS_CIRCULO; n++) {
    assert.deepEqual(validarSeleccion(seleccionDe(n)), { ok: true }, `${n} invitadas`)
    const total = miembrosTotales(seleccionDe(n))
    assert.ok(
      total >= MIN_MIEMBROS_CIRCULO && total <= MAX_MIEMBROS_CIRCULO,
      `${total} personas en total cabe en 2..7`,
    )
  }

  // Un set de 7 no puede salir de `alternarInvitado`, pero el validador no se
  // fía de quién construyó el set.
  assert.deepEqual(validarSeleccion(seleccionDe(7)), { ok: false, motivo: 'demasiada_gente' })
})

test('el techo del cliente cabe dentro del techo del servidor (1..7 invitadas)', () => {
  assert.ok(MAX_INVITADOS_CIRCULO <= 7, 'el esquema de la ruta acepta hasta 7 miembros')
  assert.ok(MIN_INVITADOS_CIRCULO >= 1, 'el esquema de la ruta exige al menos 1')
})

// ── alternarInvitado ────────────────────────────────────────────────────────

test('marcar y desmarcar: inmutable, y el tope se aplica solo al añadir', () => {
  const vacia: ReadonlySet<string> = new Set()

  const conUna = alternarInvitado(vacia, uuidDePrueba(1))
  assert.equal(conUna.has(uuidDePrueba(1)), true)
  assert.equal(vacia.size, 0, 'el set original no se toca')

  const otraVez = alternarInvitado(conUna, uuidDePrueba(1))
  assert.equal(otraVez.size, 0, 'volver a marcar a la misma persona la quita')

  const llena = seleccionDe(MAX_INVITADOS_CIRCULO)
  const trasIntento = alternarInvitado(llena, uuidDePrueba(99))
  assert.equal(trasIntento, llena, 'con el cupo lleno, añadir devuelve el MISMO set')
  assert.equal(trasIntento.has(uuidDePrueba(99)), false)

  // Quitar con el cupo lleno SÍ funciona: siempre se puede hacer sitio.
  const trasQuitar = alternarInvitado(llena, uuidDePrueba(1))
  assert.equal(trasQuitar.size, MAX_INVITADOS_CIRCULO - 1)
})

// ── Invitadas sin sobre ─────────────────────────────────────────────────────

test('invitadosSinSobre: quién se quedó sin sobre, en el orden de la selección', () => {
  const invitados = [uuidDePrueba(1), uuidDePrueba(2), uuidDePrueba(3)]
  const sobres = [{ recipientId: uuidDePrueba(2) }]

  assert.deepEqual(invitadosSinSobre(invitados, sobres), [uuidDePrueba(1), uuidDePrueba(3)])
  assert.deepEqual(
    invitadosSinSobre(invitados, invitados.map((id) => ({ recipientId: id }))),
    [],
    'con un sobre por invitada no falta nadie',
  )
  assert.deepEqual(invitadosSinSobre(invitados, []), invitados, 'sin sobres faltan todas')
})

test('aliasesDe: alias en el orden pedido, y los ids desconocidos se omiten', () => {
  const almas = [
    { id: uuidDePrueba(1), alias: 'Brisa' },
    { id: uuidDePrueba(2), alias: 'Roble' },
  ]
  assert.deepEqual(aliasesDe([uuidDePrueba(2), uuidDePrueba(1)], almas), ['Roble', 'Brisa'])
  assert.deepEqual(aliasesDe([uuidDePrueba(3)], almas), [])
})

// ── Título ──────────────────────────────────────────────────────────────────

test('normalizarTitulo: recorta, convierte el vacío en null y respeta el tope', () => {
  assert.equal(normalizarTitulo('  Los martes  '), 'Los martes')
  assert.equal(normalizarTitulo(''), null)
  assert.equal(normalizarTitulo('   '), null)

  const largo = 'a'.repeat(TITULO_MAX + 20)
  const normalizado = normalizarTitulo(largo)
  assert.equal(normalizado?.length, TITULO_MAX)
})

// ── El contrato con la ruta ─────────────────────────────────────────────────

test('una selección válida del dominio produce un cuerpo que la API acepta', () => {
  for (const n of [MIN_INVITADOS_CIRCULO, MAX_INVITADOS_CIRCULO]) {
    const cuerpo = {
      kind: 'circulo',
      title: normalizarTitulo('  Los martes  '),
      miembros: [...seleccionDe(n)],
      sobres: [],
    }
    assert.equal(esquemaCrearRefugio.safeParse(cuerpo).success, true, `${n} invitadas`)
  }

  // Y sin título: `null`, no cadena vacía (min(1) del esquema).
  const sinTitulo = {
    kind: 'circulo',
    title: normalizarTitulo('   '),
    miembros: [...seleccionDe(2)],
    sobres: [],
  }
  assert.equal(esquemaCrearRefugio.safeParse(sinTitulo).success, true)
  assert.equal(
    esquemaCrearRefugio.safeParse({ ...sinTitulo, title: '' }).success,
    false,
    'la cadena vacía NO pasa: por eso normalizarTitulo devuelve null',
  )
})
