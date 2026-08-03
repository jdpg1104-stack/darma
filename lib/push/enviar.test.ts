import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  configurarEnvio,
  enviarA,
  enviarAVarias,
  pushConfigurado,
  restaurarEnvio,
  type RepositorioSuscripciones,
  type ResultadoEnvio,
  type Suscripcion,
} from './enviar.ts'
import { construirCarga } from './plantillas.ts'
import { clavePublicaVapid, configuracionVapid } from './vapid.ts'

const CARGA = construirCarga({ tipo: 'te_escucharon', aliasEmisor: null, url: '/feed' })

function sub(id: string): Suscripcion {
  return {
    id,
    endpoint: `https://fcm.googleapis.com/fcm/send/${id}`,
    p256dh: 'clave-publica-del-navegador',
    auth: 'secreto-de-auth',
  }
}

/** Repositorio de mentira: registra qué se le pidió borrar. */
function repositorioFalso(): RepositorioSuscripciones & { borrados: string[]; oks: string[] } {
  const borrados: string[] = []
  const oks: string[] = []
  return {
    borrados,
    oks,
    async eliminar(ids) {
      borrados.push(...ids)
      return ids.length
    },
    async marcarOk(ids) {
      oks.push(...ids)
    },
  }
}

/** Transporte de mentira: responde según un mapa id → resultado. */
function transporteFalso(respuestas: Record<string, ResultadoEnvio>) {
  const intentos: string[] = []
  return {
    intentos,
    async entregar(s: Suscripcion): Promise<ResultadoEnvio> {
      intentos.push(s.id)
      return respuestas[s.id] ?? 'ok'
    },
  }
}

const ENTORNO = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }

function conLlaves(): void {
  process.env.VAPID_PUBLIC_KEY = 'BPublicaDePrueba'
  process.env.VAPID_PRIVATE_KEY = 'PrivadaDePrueba'
}

function sinLlaves(): void {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
}

beforeEach(() => restaurarEnvio())

afterEach(() => {
  restaurarEnvio()
  if (ENTORNO.pub === undefined) delete process.env.VAPID_PUBLIC_KEY
  else process.env.VAPID_PUBLIC_KEY = ENTORNO.pub
  if (ENTORNO.priv === undefined) delete process.env.VAPID_PRIVATE_KEY
  else process.env.VAPID_PRIVATE_KEY = ENTORNO.priv
})

// ── CAMINO FELIZ ────────────────────────────────────────────────────────────

test('4 · enviarAVarias con 3 suscripciones correctas → {enviadas:3, eliminadas:0}', async () => {
  conLlaves()
  const repo = repositorioFalso()
  configurarEnvio({ transporte: transporteFalso({}), repositorio: repo })

  const resultado = await enviarAVarias([sub('a'), sub('b'), sub('c')], CARGA)

  assert.deepEqual(resultado, { enviadas: 3, eliminadas: 0 })
  assert.deepEqual(repo.borrados, [], 'nada que limpiar')
  assert.deepEqual(repo.oks.sort(), ['a', 'b', 'c'])
})

test('enviarA devuelve «ok» y marca la entrega', async () => {
  conLlaves()
  const repo = repositorioFalso()
  configurarEnvio({ transporte: transporteFalso({}), repositorio: repo })

  assert.equal(await enviarA(sub('uno'), CARGA), 'ok')
  assert.deepEqual(repo.oks, ['uno'])
})

// ── 5 · SIN VAPID: APAGADO Y SILENCIOSO ─────────────────────────────────────

test('5 · sin llaves VAPID: pushConfigurado() es false y enviarA devuelve «error» sin lanzar', async () => {
  sinLlaves()

  assert.equal(pushConfigurado(), false)
  assert.equal(configuracionVapid(), null)
  // Es la señal que apaga la UI de opt-in y la que hace que /api/push/key
  // devuelva {publicKey:null} con 200 en vez de un 500.
  assert.equal(clavePublicaVapid(), null)

  const repo = repositorioFalso()
  const transporte = transporteFalso({})
  configurarEnvio({ transporte, repositorio: repo })

  // No lanza. Y no llega ni a intentar la entrega.
  assert.equal(await enviarA(sub('a'), CARGA), 'error')
  assert.deepEqual(transporte.intentos, [], 'el camino apagado no toca el transporte')

  assert.deepEqual(await enviarAVarias([sub('a'), sub('b')], CARGA), {
    enviadas: 0,
    eliminadas: 0,
  })
})

test('5b · con llaves, configuracionVapid trae subject, pública y privada', () => {
  conLlaves()
  const config = configuracionVapid()
  assert.ok(config)
  assert.equal(config.publicKey, 'BPublicaDePrueba')
  assert.equal(config.privateKey, 'PrivadaDePrueba')
  assert.match(config.subject, /^(mailto:|https:)/, 'RFC 8292 exige mailto: o https:')
})

// ── 6 · 410 GONE ────────────────────────────────────────────────────────────

test('6 · un 410 devuelve «gone» y enviarAVarias borra esa fila → {enviadas:2, eliminadas:1}', async () => {
  conLlaves()
  const repo = repositorioFalso()
  configurarEnvio({
    transporte: transporteFalso({ b: 'gone' }),
    repositorio: repo,
  })

  const resultado = await enviarAVarias([sub('a'), sub('b'), sub('c')], CARGA)

  assert.deepEqual(resultado, { enviadas: 2, eliminadas: 1 })
  assert.deepEqual(repo.borrados, ['b'], 'se limpia exactamente la caducada')
  assert.deepEqual(repo.oks.sort(), ['a', 'c'])
})

test('6b · enviarA con 410 borra la fila él mismo', async () => {
  conLlaves()
  const repo = repositorioFalso()
  configurarEnvio({ transporte: transporteFalso({ x: 'gone' }), repositorio: repo })

  assert.equal(await enviarA(sub('x'), CARGA), 'gone')
  assert.deepEqual(repo.borrados, ['x'])
})

// ── OTROS CAMINOS DE FALLO ──────────────────────────────────────────────────

test('un transporte que LANZA se trata como error, no propaga', async () => {
  conLlaves()
  const repo = repositorioFalso()
  configurarEnvio({
    transporte: {
      async entregar() {
        throw new Error('DNS caído')
      },
    },
    repositorio: repo,
  })

  assert.equal(await enviarA(sub('a'), CARGA), 'error')

  const resultado = await enviarAVarias([sub('a'), sub('b')], CARGA)
  assert.deepEqual(resultado, { enviadas: 0, eliminadas: 0 })
  assert.deepEqual(repo.borrados, [], 'un error de red NO borra suscripciones')
})

test('un destinatario que falla no impide que los demás reciban', async () => {
  conLlaves()
  const repo = repositorioFalso()
  configurarEnvio({
    transporte: transporteFalso({ b: 'error', c: 'gone' }),
    repositorio: repo,
  })

  const resultado = await enviarAVarias([sub('a'), sub('b'), sub('c'), sub('d')], CARGA)
  assert.deepEqual(resultado, { enviadas: 2, eliminadas: 1 })
})

test('lista vacía: ni una consulta, ni un borrado', async () => {
  conLlaves()
  const repo = repositorioFalso()
  configurarEnvio({ transporte: transporteFalso({}), repositorio: repo })

  assert.deepEqual(await enviarAVarias([], CARGA), { enviadas: 0, eliminadas: 0 })
  assert.deepEqual(repo.borrados, [])
})

test('el envío masivo se trocea en lotes y no deja a nadie fuera', async () => {
  conLlaves()
  const repo = repositorioFalso()
  const subs = Array.from({ length: 250 }, (_, i) => sub(`s${i}`))
  const transporte = transporteFalso({ s7: 'gone', s150: 'gone' })
  configurarEnvio({ transporte, repositorio: repo })

  const resultado = await enviarAVarias(subs, CARGA)

  assert.equal(transporte.intentos.length, 250)
  assert.deepEqual(resultado, { enviadas: 248, eliminadas: 2 })
  // UN solo borrado con todos los ids, no N borrados.
  assert.deepEqual(repo.borrados.sort(), ['s150', 's7'])
})
