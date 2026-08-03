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
 * DEUDA CONOCIDA. Estos archivos son de OTROS bloques (F4, B01, B16) y hoy
 * llevan copy escrito a pelo. B17 no puede tocarlos —cada archivo tiene un solo
 * dueño—, así que se anota la deuda aquí y el pedido va en HANDOFF/PEDIDOS.md.
 *
 * El guard sigue siendo útil: falla en cuanto aparece un archivo NUEVO con texto
 * sin traducir. La lista solo puede encoger; cuando un dueño migre el suyo a
 * `t('...')`, que borre su línea de aquí.
 */
const DEUDA_LITERALES_CONOCIDA: readonly string[] = [
  // Ola 1 (F4, B01, B16)
  'app/layout.tsx',
  'app/page.tsx',
  'components/auth/AsistenteOnboarding.tsx',
  'components/auth/AvatarSemilla.tsx',
  'components/auth/PanelEntrada.tsx',
  'components/ui/MedidorKarma.tsx',
  // Ola 2 (B02, B03, B04, B05, B11). Los seis bloques se escribieron en
  // paralelo con B17, así que ninguno pudo consumir un catálogo que aún no
  // existía cuando empezaron. La deuda se anota entera de golpe y cada dueño
  // borra su línea al migrar a `t('...')`; el pedido está en PEDIDOS.md.
  'app/(admin)/moderacion/Acciones.tsx',
  'app/(admin)/moderacion/page.tsx',
  'app/(app)/feed/error.tsx',
  'app/(app)/feed/page.tsx',
  'app/(app)/perfil/editar/page.tsx',
  'app/(app)/perfil/page.tsx',
  'app/(app)/post/[id]/error.tsx',
  'app/(app)/publicar/page.tsx',
  'components/composer/Composer.tsx',
  'components/feed/ElementoTarjeta.tsx',
  'components/feed/FeedVacio.tsx',
  'components/feed/ScrollInfinito.tsx',
  'components/feed/SelectorCarril.tsx',
  'components/feed/SlotEncuesta.tsx',
  'components/feed/TarjetaPost.tsx',
  'components/perfil/FormularioEditar.tsx',
  'components/perfil/HistorialKarma.tsx',
  'components/perfil/PanelPrivado.tsx',
  'components/perfil/SelectorAvatar.tsx',
  'components/thread/BotonUtil.tsx',
  'components/thread/Comentario.tsx',
  'components/thread/CompositorRespuesta.tsx',
  'components/thread/EstadoValidacion.tsx',
  'components/thread/ListaComentarios.tsx',
  'components/video/TarjetaVideo.tsx',
  // Ola 3 (B06, B09, B10, B13, B20). Mismo motivo que la ola 2: se escribieron
  // en paralelo y ninguno pudo consumir el catálogo. Los de `refuge/` son los
  // que más prisa tienen de traducirse — incluyen las advertencias de la frase
  // de recuperación, que no se pueden entender a medias.
  'app/(app)/ranking/page.tsx',
  'app/(app)/refugios/page.tsx',
  'app/(legal)/layout.tsx',
  'app/(legal)/legal/_documento.tsx',
  'app/(legal)/legal/page.tsx',
  'components/polls/TarjetaEncuesta.tsx',
  'components/pwa/AvisoSinConexion.tsx',
  'components/pwa/OptInPush.tsx',
  'components/ranking/InsigniaMovimiento.tsx',
  'components/ranking/MiPosicion.tsx',
  'components/ranking/Podio.tsx',
  'components/ranking/SelectorPeriodo.tsx',
  'components/ranking/Tablero.tsx',
  'components/refuge/AvisoClaveCambiada.tsx',
  'components/refuge/Burbuja.tsx',
  'components/refuge/DialogoFraseRecuperacion.tsx',
  'components/refuge/Hilo.tsx',
  'components/refuge/MenuBloquear.tsx',
  'components/refuge/NumeroSeguridad.tsx',
  'components/refuge/Redactor.tsx',
  'components/refuge/TarjetaCrisis.tsx',
  // Ola 4 (B12, B19) e integración.
  'app/(admin)/_componentes/NavegacionAdmin.tsx',
  'app/(admin)/_componentes/Sparkline.tsx',
  'app/(admin)/_componentes/TablaSerie.tsx',
  'app/(admin)/panel/activacion/page.tsx',
  'app/(admin)/panel/crisis/page.tsx',
  'app/(admin)/panel/economia/page.tsx',
  'app/(admin)/panel/page.tsx',
  'app/(admin)/panel/reciprocidad/page.tsx',
  'app/(admin)/panel/roles/page.tsx',
  'components/economia/DialogoBoost.tsx',
  'components/economia/HistorialCompras.tsx',
  'components/economia/SaldoCristales.tsx',
  'components/economia/SelectorRegalo.tsx',
  // `/ayuda` encabeza la lista de lo que hay que traducir PRIMERO, y por un
  // motivo que no es de proceso: es la pantalla del botón de crisis. Alguien
  // que la abra en inglés y encuentre el texto en español está buscando un
  // teléfono en un idioma que no entiende, en el peor momento posible.
  'app/ayuda/page.tsx',
]

function relativo(absoluto: string): string {
  return absoluto.slice(RAIZ.length + 1).split('\\').join('/')
}

test('ningún archivo NUEVO de app/** o components/** trae texto sin traducir', () => {
  const inicio = Date.now()
  const hallazgos = buscarLiteralesSinTraducir([join(RAIZ, 'app'), join(RAIZ, 'components')])
  const ms = Date.now() - inicio

  const nuevos = hallazgos.filter((h) => !DEUDA_LITERALES_CONOCIDA.includes(relativo(h.archivo)))
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
