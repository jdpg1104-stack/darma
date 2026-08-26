// ============================================================================
// Pruebas del DISPARADOR del aviso «mensaje_refugio» (B10 → B13)
//
//   node --test --experimental-strip-types "app/api/refuges/[id]/mensajes/avisoMensaje.test.ts"
//
// Lo que se fija aquí es el contrato del enganche, no la política de push (esa
// vive entera en `lib/push/despacho.test.ts`):
//
//   · el aviso se dispara SOLO tras confirmarse el INSERT del mensaje — nunca
//     antes, y nunca en el GET;
//   · va a los DEMÁS miembros: quien escribe se excluye, y quien silenció la
//     sala (`refuge_members.muted`) se descarta ya en la ruta — además de la
//     segunda capa que `avisar()` aplica por dentro con el `refugeId`;
//   · REGLA INNEGOCIABLE (pedido B10 → B13): al aviso NO se le pasa contenido,
//     ni preview, ni alias, ni título del refugio. Solo ids y la ruta interna.
//     El servidor recibe un blob AES-256-GCM y no tiene la clave; este test
//     existe para romperse el día que alguien «resuelva» ese hueco con un
//     campo en claro;
//   · un fallo del push JAMÁS rompe un mensaje que ya está guardado.
//
// La parte que vive en `route.ts` no se puede importar aquí (arrastra imports
// `@/` que node --test no resuelve), así que se vigila igual que hace
// `avisoEscucha.test.ts`: leyendo el fuente y afirmando sobre él. La parte
// ejecutable corre contra el `avisar()` real con el puerto y el transporte de
// mentira de las pruebas de B13.
// ============================================================================

import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  avisar,
  configurarDespacho,
  type PuertoDatosPush,
} from '../../../../../lib/push/despacho.ts'
import {
  configurarEnvio,
  restaurarEnvio,
  type Suscripcion,
} from '../../../../../lib/push/enviar.ts'
import { PREFS_POR_DEFECTO } from '../../../../../lib/push/preferencias.ts'

const AQUI = import.meta.dirname

// ── 1. El fuente de route.ts: dónde está la llamada y dónde NO ──────────────

test('route.ts avisa UNA sola vez, y solo con el INSERT ya confirmado', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  assert.equal(
    (fuente.match(/await avisar\(/g) ?? []).length,
    1,
    'una única llamada a avisar() en toda la ruta',
  )

  const iInsert = fuente.indexOf('.insert({')
  const iConfirmado = fuente.lastIndexOf('if (error) throw codigoDesdeErrorDeRefugio(error)')
  const iAvisar = fuente.indexOf('await avisar(')
  const iRespuesta = fuente.indexOf('return sobreOk({ mensaje')

  assert.ok(iInsert > -1 && iConfirmado > -1 && iAvisar > -1 && iRespuesta > -1)
  assert.ok(iInsert < iAvisar, 'el aviso va DESPUÉS del INSERT del mensaje')
  assert.ok(iConfirmado < iAvisar, 'y después del throw que descarta el INSERT fallido')
  assert.ok(iAvisar < iRespuesta, 'y antes de la respuesta, dentro del mismo manejador')
})

test('route.ts cumple el contrato de PEDIDOS campo a campo', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  const iAvisar = fuente.indexOf('await avisar(')
  const llamada = fuente.slice(iAvisar, fuente.indexOf('})', iAvisar))

  assert.ok(llamada.includes('destinatarioId: miembro.user_id'), 'destinatario: cada miembro restante')
  assert.ok(llamada.includes("tipo: 'mensaje_refugio'"))
  assert.ok(
    llamada.includes('emisorId: ctx.sesion.userId'),
    'emisor: quien escribe, SIEMPRE de la sesión',
  )
  assert.match(llamada, /\n\s*refugeId,\r?\n/, 'lleva el refugeId para la capa de muted de avisar()')
  assert.match(llamada, /url: `\/refugios\/\$\{refugeId\}`/, 'la url es el enlace profundo a la sala')
})

test('REGLA B10 → B13: al aviso no se le pasa contenido, ni alias, ni título', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  const iAvisar = fuente.indexOf('await avisar(')
  const llamada = fuente.slice(iAvisar, fuente.indexOf('})', iAvisar))

  // Ni el blob (aunque cifrado), ni ningún campo con pinta de texto legible.
  for (const prohibido of ['ciphertext', 'nonce', 'body', 'cuerpo', 'preview', 'alias', 'title', 'titulo', 'topic']) {
    assert.ok(
      !llamada.includes(prohibido),
      `la llamada a avisar() no puede llevar «${prohibido}»`,
    )
  }
  // Y la ruta tampoco fabrica cargas por su cuenta: la plantilla vive en B13 y
  // su firma ni siquiera acepta contenido.
  assert.ok(!fuente.includes('construirCarga('), 'la ruta no construye ninguna carga a mano')
})

test('route.ts excluye a quien escribe y a quien silenció la sala, y envuelve el push', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  assert.match(
    fuente,
    /if \(miembro\.user_id === ctx\.sesion\.userId\) continue/,
    'quien escribe no se avisa a sí mismo',
  )
  assert.match(
    fuente,
    /if \(miembro\.muted === true\) continue/,
    'refuge_members.muted se respeta ya en la ruta, sin una consulta por destinatario',
  )
  assert.match(
    fuente,
    /try \{\s*const \{ data: miembros \} = await ctx\.supabase\s*\n\s*\.from\('refuge_members'\)/,
    'el try envuelve TODO el bloque, incluida la consulta de miembros (cliente RLS, jamás admin)',
  )
  assert.match(
    fuente,
    /catch \{\s*\/\/[^\n]*\n\s*console\.warn\('\[darma\]\[b13\] aviso mensaje_refugio no enviado'\)/,
    'el fallo se registra con prefijo estable y SIN uuids ni contenido',
  )
})

// ── 2. Los argumentos de la ruta, contra el avisar() real ───────────────────

const ENTORNO = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }

/** Mediodía UTC: fuera de las horas de silencio, pase cuando pase la suite. */
const MEDIODIA = new Date('2026-08-03T12:00:00.000Z')

const OTRO_MIEMBRO = '11111111-2222-3333-4444-555555555555'
const QUIEN_ESCRIBE = '99999999-8888-4777-8666-555555555555'
const REFUGE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

const SUSCRIPCION: Suscripcion = {
  id: 'sub-1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/uno',
  p256dh: 'clave',
  auth: 'secreto',
}

/** Puerto con todo a favor: la política entera dice que sí. */
function puertoAbierto(): PuertoDatosPush {
  return {
    async hayBloqueo() { return false },
    async silenciadoEnRefugio() { return false },
    async ajustesDe() {
      return { prefs: { ...PREFS_POR_DEFECTO }, quietFrom: null, quietTo: null, tzOffset: 0 }
    },
    async aliasSiRevela() { return null },
    async suscripcionesDe() { return [SUSCRIPCION] },
    async estadoDe() { return { ultimoMs: null, pendientes: 0 } },
    async consumirTecho() { return true },
    async anotarEnviado() {},
    async acumular() {},
  }
}

/** Puerto en el que TODO Postgres está caído: cada método rechaza. */
function puertoRoto(): PuertoDatosPush {
  const caida = async (): Promise<never> => {
    throw new Error('postgres caído')
  }
  return {
    hayBloqueo: caida,
    silenciadoEnRefugio: caida,
    ajustesDe: caida,
    aliasSiRevela: caida,
    suscripcionesDe: caida,
    estadoDe: caida,
    consumirTecho: caida,
    anotarEnviado: caida,
    acumular: caida,
  }
}

/** La llamada de route.ts, con sus MISMOS argumentos. */
function avisoDeLaRuta() {
  return avisar({
    destinatarioId: OTRO_MIEMBRO,
    tipo: 'mensaje_refugio',
    emisorId: QUIEN_ESCRIBE,
    refugeId: REFUGE_ID,
    url: `/refugios/${REFUGE_ID}`,
    ahora: MEDIODIA,
  })
}

beforeEach(() => {
  process.env.VAPID_PUBLIC_KEY = 'BPublicaDePrueba'
  process.env.VAPID_PRIVATE_KEY = 'PrivadaDePrueba'
  restaurarEnvio()
  configurarDespacho(null)
})

afterEach(() => {
  restaurarEnvio()
  configurarDespacho(null)
  if (ENTORNO.pub === undefined) delete process.env.VAPID_PUBLIC_KEY
  else process.env.VAPID_PUBLIC_KEY = ENTORNO.pub
  if (ENTORNO.priv === undefined) delete process.env.VAPID_PRIVATE_KEY
  else process.env.VAPID_PRIVATE_KEY = ENTORNO.priv
})

test('camino feliz: UNA entrega hacia la sala, y la carga no dice NADA del mensaje', async () => {
  configurarDespacho(puertoAbierto())
  const cargas: unknown[] = []
  configurarEnvio({
    transporte: {
      async entregar(_s, carga) {
        cargas.push(carga)
        return 'ok' as const
      },
    },
    repositorio: { async eliminar() { return 0 } },
  })

  const r = await avisoDeLaRuta()

  assert.equal(r.enviado, true)
  assert.equal(r.entregas, 1)
  const carga = cargas[0] as { titulo: string; cuerpo: string; url: string }
  assert.equal(carga.url, `/refugios/${REFUGE_ID}`, 'tocar el aviso lleva a la sala')
  // Lo ÚNICO que puede salir por la red es la frase genérica de la plantilla:
  // ni contenido, ni alias (el emisor no reveló), ni título del refugio.
  assert.equal(carga.titulo, 'Tienes un mensaje en un refugio')
  assert.equal(carga.cuerpo, 'Te han escrito. El contenido solo se ve dentro.')
})

test('la sala silenciada NO vibra: avisar() aplica refuge_members.muted con el refugeId', async () => {
  const puerto = puertoAbierto()
  puerto.silenciadoEnRefugio = async () => true
  configurarDespacho(puerto)

  const r = await avisoDeLaRuta()

  assert.equal(r.enviado, false)
  assert.equal(r.motivo, 'silenciado_refugio')
  assert.equal(r.entregas, 0)
})

test('FALLO: con el despacho entero caído, avisar() resuelve — el mensaje no puede romperse', async () => {
  configurarDespacho(puertoRoto())

  // Si esto lanzara, el POST devolvería error_interno con el mensaje YA
  // guardado en la sala. Por eso el contrato es NO lanzar (y aun así la ruta
  // lo envuelve en su propio try).
  const r = await avisoDeLaRuta()

  assert.equal(r.enviado, false)
  assert.equal(r.entregas, 0)
})

test('sin llaves VAPID (el estado real de hoy) es un no-op silencioso', async () => {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  configurarDespacho(puertoAbierto())

  const r = await avisoDeLaRuta()

  assert.equal(r.enviado, false)
  assert.equal(r.motivo, 'apagado')
})
