// ============================================================================
// Pruebas del DISPARADOR del aviso «te ayudó» (B04 → B13)
//
//   node --test --experimental-strip-types "app/api/comments/[id]/util/avisoAyuda.test.ts"
//
// Lo que se fija aquí es el contrato del enganche, no la política de push (esa
// vive entera en `lib/push/despacho.test.ts`):
//
//   · el aviso se dispara SOLO tras devolver `marcar_comentario_util()` su
//     `estado = 'ok'` — nunca antes de la RPC, nunca en los caminos de error;
//   · lleva exactamente el contrato de PEDIDOS: destinatario = autor del
//     comentario, tipo `te_ayudo`, emisor = quien marca, url del post;
//   · nadie se avisa a sí mismo, aunque el rechazo del autocomentario de B04
//     cambiara algún día;
//   · un fallo del push JAMÁS rompe la respuesta de la marca.
//
// La parte que vive en `route.ts` no se puede importar aquí (arrastra imports
// `@/` que node --test no resuelve), así que se vigila igual que hace
// `avisoEscucha.test.ts`: leyendo el fuente y afirmando sobre él. La parte
// ejecutable —que los MISMOS argumentos de la ruta producen una entrega, y que
// un despacho roto no lanza— corre contra el `avisar()` real con el puerto y
// el transporte de mentira de las pruebas de B13.
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

test('route.ts avisa UNA sola vez, y solo tras el estado ok de la RPC', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  assert.equal(
    (fuente.match(/await avisar\(/g) ?? []).length,
    1,
    'una única llamada a avisar() en toda la ruta',
  )

  const iRpc = fuente.indexOf("admin.rpc('marcar_comentario_util'")
  const iConfirmado = fuente.indexOf("if (fila.estado !== 'ok')")
  const iAvisar = fuente.indexOf('await avisar(')
  const iRespuesta = fuente.indexOf('return sobreOk<RespuestaUtil>')

  assert.ok(iRpc > -1 && iConfirmado > -1 && iAvisar > -1 && iRespuesta > -1)
  assert.ok(iRpc < iAvisar, 'el aviso va DESPUÉS de la RPC que traslada la marca')
  assert.ok(
    iConfirmado < iAvisar,
    'y después del filtro de estado: los caminos no_encontrado y sin_permiso ya lanzaron',
  )
  assert.ok(iAvisar < iRespuesta, 'y antes de la respuesta, dentro del mismo manejador')
})

test('route.ts cumple el contrato de PEDIDOS campo a campo', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  const iAvisar = fuente.indexOf('await avisar(')
  const llamada = fuente.slice(iAvisar, fuente.indexOf('})', iAvisar))

  assert.ok(
    llamada.includes('destinatarioId: comentario.author_id'),
    'destinatario: quien escribió el comentario que ayudó',
  )
  assert.ok(llamada.includes("tipo: 'te_ayudo'"))
  assert.ok(llamada.includes('emisorId: userId'), 'emisor: quien marca, SIEMPRE de la sesión')
  assert.match(llamada, /url: `\/post\/\$\{comentario\.post_id\}`/, 'la url apunta al post de la marca')
})

test('route.ts defiende el autoaviso y envuelve el push para que no rompa nada', () => {
  const fuente = readFileSync(join(AQUI, 'route.ts'), 'utf8')

  assert.match(
    fuente,
    /if \(comentario\.author_id !== userId\) \{\s*try \{\s*await avisar\(/,
    'la guarda del autoaviso y el try envuelven la llamada, en ese orden',
  )
  assert.match(
    fuente,
    /catch \{\s*\/\/[^\n]*\n\s*console\.warn\('\[darma\]\[b13\] aviso te_ayudo no enviado'\)/,
    'el fallo se registra con prefijo estable y SIN uuids ni contenido',
  )
})

// ── 2. Los argumentos de la ruta, contra el avisar() real ───────────────────

const ENTORNO = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }

/** Mediodía UTC: fuera de las horas de silencio, pase cuando pase la suite. */
const MEDIODIA = new Date('2026-08-03T12:00:00.000Z')

const QUIEN_ESCUCHO = '11111111-2222-3333-4444-555555555555'
const QUIEN_MARCA = '99999999-8888-4777-8666-555555555555'
const POST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

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
    destinatarioId: QUIEN_ESCUCHO,
    tipo: 'te_ayudo',
    emisorId: QUIEN_MARCA,
    url: `/post/${POST_ID}`,
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

test('camino feliz: los argumentos de la ruta producen UNA entrega que apunta al post', async () => {
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
  const carga = cargas[0] as { url: string }
  assert.equal(carga.url, `/post/${POST_ID}`, 'tocar el aviso lleva al post donde ayudó')
})

test('FALLO: con el despacho entero caído, avisar() resuelve — la marca no puede romperse', async () => {
  configurarDespacho(puertoRoto())

  // Si esto lanzara, el POST devolvería error_interno con la marca YA hecha:
  // trasladada y con karma pagado, pero sin respuesta. Por eso el contrato es
  // NO lanzar (y aun así la ruta lo envuelve en su propio try).
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
