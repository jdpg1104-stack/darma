import test from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  buscarLiteralesEnFuente,
  buscarLiteralesSinTraducir,
  listarTsx,
  EXCLUSIONES_LITERALES,
} from './validacion.ts'

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..')

// ── El guard falla cuando debe fallar ───────────────────────────────────────

test('un literal visible en JSX se detecta', () => {
  const hallazgos = buscarLiteralesEnFuente('<p>Hola qué tal</p>', 'Prueba.tsx')
  assert.equal(hallazgos.length, 1)
  assert.equal(hallazgos[0].texto, 'Hola qué tal')
  assert.equal(hallazgos[0].donde, 'jsx')
  assert.equal(hallazgos[0].archivo, 'Prueba.tsx')
  assert.equal(hallazgos[0].linea, 1)
})

test('lo que viene de t(...) y los nombres propios NO se detectan', () => {
  assert.deepEqual(buscarLiteralesEnFuente("<p>{t('comun.hola')}</p>"), [])
  assert.deepEqual(buscarLiteralesEnFuente('<p>Darma</p>'), [])
  assert.deepEqual(buscarLiteralesEnFuente('<span>Samaritans</span>'), [])
  // Cadenas cortas, símbolos y una sola palabra sin acentos: heurística
  // conservadora a propósito, para que el guard no cansa y nadie lo apague.
  assert.deepEqual(buscarLiteralesEnFuente('<span>·</span>'), [])
  assert.deepEqual(buscarLiteralesEnFuente('<span>Ok</span>'), [])
  assert.deepEqual(buscarLiteralesEnFuente('<span>Total</span>'), [])
  assert.deepEqual(buscarLiteralesEnFuente('<span>→</span>'), [])
})

test('los atributos accesibles también se vigilan', () => {
  const fuente = [
    '<button aria-label="Cerrar el diálogo">x</button>',
    '<input placeholder="Escribe aquí" />',
    '<img alt="Retrato de perfil" />',
    '<a title="Ir al feed">f</a>',
  ].join('\n')

  const hallazgos = buscarLiteralesEnFuente(fuente, 'Componente.tsx')
  const donde = hallazgos.map((h) => h.donde).sort()
  assert.deepEqual(donde, ['alt', 'aria-label', 'placeholder', 'title'])
  assert.ok(hallazgos.every((h) => h.linea >= 1 && h.linea <= 4))
})

test('un atributo alimentado por t(...) no dispara nada', () => {
  const fuente = [
    '<button aria-label={t("comun.cerrar")}>x</button>',
    '<input placeholder={t("publicar.marcador")} />',
  ].join('\n')
  assert.deepEqual(buscarLiteralesEnFuente(fuente), [])
})

test('el número de línea que reporta es el de verdad', () => {
  const fuente = ['<div>', '  {contenido}', '  <p>Esto está sin traducir</p>', '</div>'].join('\n')
  const hallazgos = buscarLiteralesEnFuente(fuente, 'X.tsx')
  assert.equal(hallazgos.length, 1)
  assert.equal(hallazgos[0].linea, 3)
})

test('la lista de exclusiones es explícita y contiene el nombre del producto', () => {
  assert.ok(EXCLUSIONES_LITERALES.includes('Darma'))
})

// ── El guard sobre el árbol real ────────────────────────────────────────────

/**
 * Archivos con copy escrito a pelo que el guard tolera. La lista solo puede
 * encoger, y hoy está vacía.
 */
const DEUDA_LITERALES_CONOCIDA: readonly string[] = [
  // VACÍA, y es una buena noticia: toda la interfaz está en el catálogo.
  //
  // Aquí llegó a haber 52 archivos. Se llenó porque los veinte bloques se
  // escribieron en paralelo con el de traducción y ninguno pudo consumir un
  // catálogo que aún no existía; se vació cuando cuatro sesiones migraron los
  // 52 y el escáner aprendió a distinguir el copy del código que se le parece.
  //
  // Mantenerla vacía es lo que hace que el guard proteja: con un solo archivo
  // dentro, la siguiente persona que añada texto sin traducir puede meterlo en
  // la lista «como los demás» y nadie lo notará. Si vuelve a hacer falta añadir
  // una línea, que sea con fecha y con quién la va a quitar.
]

/**
 * Copy deliberadamente EN INGLÉS, que NO es deuda y no debe migrar al catálogo:
 * su destinatario se define por el idioma del texto, no por el locale de la
 * interfaz. Ponerlo en el catálogo lo mostraría en el idioma que la UI crea
 * vigente — escondiéndolo justo de quien lo necesita.
 *
 *  · legal/page.tsx: el enlace «Read these documents in English» existe para
 *    quien NO lee español; traducido al español desaparece su función.
 *  · legal/en/page.tsx: el aviso de que las versiones inglesas son traducción
 *    de trabajo y el español prevalece tiene que leerse en inglés SIEMPRE.
 *
 * A diferencia de la deuda, esta lista es estable: solo crece con una razón de
 * este calibre escrita al lado (añadido 2026-08-05, sesión de integración).
 */
const COPY_DELIBERADAMENTE_EN_INGLES: readonly string[] = [
  'app/(legal)/legal/page.tsx',
  'app/(legal)/legal/en/page.tsx',
]

function relativo(absoluto: string): string {
  return absoluto.slice(RAIZ.length + 1).split('\\').join('/')
}

test('ningún archivo NUEVO de app/** o components/** trae texto sin traducir', () => {
  const inicio = Date.now()
  const hallazgos = buscarLiteralesSinTraducir([join(RAIZ, 'app'), join(RAIZ, 'components')])
  const ms = Date.now() - inicio

  const nuevos = hallazgos.filter(
    (h) =>
      !DEUDA_LITERALES_CONOCIDA.includes(relativo(h.archivo)) &&
      !COPY_DELIBERADAMENTE_EN_INGLES.includes(relativo(h.archivo)),
  )
  const detalle = nuevos
    .map((h) => `${relativo(h.archivo)}:${h.linea} [${h.donde}] «${h.texto}»`)
    .join('\n  ')

  assert.deepEqual(
    [...new Set(nuevos.map((h) => relativo(h.archivo)))],
    [],
    `texto literal sin traducir. Usa t('...') del catálogo de messages/, o añade el ` +
      `caso a EXCLUSIONES_LITERALES si es un nombre propio:\n  ${detalle}`,
  )

  // Presupuesto de la ficha: < 3 s en un repo de 500 archivos.
  assert.ok(ms < 3000, `el guard tardó ${ms} ms`)
})

test('la deuda conocida sigue ahí: el guard la ve, no la ignora', () => {
  // Si esto falla es una BUENA noticia (alguien tradujo lo suyo): borra su línea
  // de DEUDA_LITERALES_CONOCIDA. Está aquí para que la lista no se quede
  // eternamente nombrando archivos ya limpios.
  const hallazgos = buscarLiteralesSinTraducir([join(RAIZ, 'app'), join(RAIZ, 'components')])
  const conDeuda = new Set(hallazgos.map((h) => relativo(h.archivo)))
  const yaLimpios = DEUDA_LITERALES_CONOCIDA.filter((f) => !conDeuda.has(f))
  assert.deepEqual(yaLimpios, [], 'ya están traducidos: quítalos de DEUDA_LITERALES_CONOCIDA')
})

test('el recorrido salta node_modules y no explota si el directorio no existe', () => {
  assert.deepEqual(listarTsx(join(RAIZ, 'no', 'existe', 'este', 'directorio')), [])
  const tsx = listarTsx(RAIZ)
  assert.ok(!tsx.some((f) => f.includes('node_modules')), 'no debe entrar en node_modules')
  assert.ok(!tsx.some((f) => f.includes('.next')), 'no debe entrar en .next')
})
