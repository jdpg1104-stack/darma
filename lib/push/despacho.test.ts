import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { avisar, configurarDespacho, type PuertoDatosPush } from './despacho.ts'
import { configurarEnvio, restaurarEnvio, type Suscripcion } from './enviar.ts'
import { PREFS_POR_DEFECTO } from './preferencias.ts'

/** Mediodía UTC: fuera de las horas de silencio. Se pasa SIEMPRE de forma
 *  explícita para que las pruebas no dependan de a qué hora se ejecuten. */
const MEDIODIA = new Date('2026-08-03T12:00:00.000Z')

const ENTORNO = { pub: process.env.VAPID_PUBLIC_KEY, priv: process.env.VAPID_PRIVATE_KEY }

const SUSCRIPCION: Suscripcion = {
  id: 'sub-1',
  endpoint: 'https://fcm.googleapis.com/fcm/send/uno',
  p256dh: 'clave',
  auth: 'secreto',
}

/** Puerto de mentira, con todo permitido salvo lo que se sobrescriba. */
function puerto(parciales: Partial<PuertoDatosPush> = {}): PuertoDatosPush & {
  acumulados: string[]
  anotados: string[]
  techoConsumido: number
} {
  const acumulados: string[] = []
  const anotados: string[] = []
  const contador = { techoConsumido: 0 }

  const base: PuertoDatosPush = {
    async hayBloqueo() {
      return false
    },
    async silenciadoEnRefugio() {
      return false
    },
    async ajustesDe() {
      return { prefs: { ...PREFS_POR_DEFECTO }, quietFrom: null, quietTo: null, tzOffset: 0 }
    },
    async aliasSiRevela() {
      return 'Kai_23'
    },
    async suscripcionesDe() {
      return [SUSCRIPCION]
    },
    async estadoDe() {
      return { ultimoMs: null, pendientes: 0 }
    },
    async consumirTecho() {
      contador.techoConsumido++
      return true
    },
    async anotarEnviado(_userId, tipo) {
      anotados.push(tipo)
    },
    async acumular(_userId, tipo) {
      acumulados.push(tipo)
    },
    ...parciales,
  }

  return Object.assign(base, {
    acumulados,
    anotados,
    get techoConsumido() {
      return contador.techoConsumido
    },
  })
}

/** Transporte que apunta lo que se le pidió entregar. */
function transporteEspia() {
  const cargas: unknown[] = []
  return {
    cargas,
    async entregar(_s: Suscripcion, carga: unknown) {
      cargas.push(carga)
      return 'ok' as const
    },
  }
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

// ── 14 · EL BLOQUEO SE APLICA ANTES DE ENVIAR ───────────────────────────────

test('14 · un destinatario que ha bloqueado al emisor recibe CERO envíos', async () => {
  const p = puerto({
    async hayBloqueo() {
      return true
    },
  })
  configurarDespacho(p)

  const espia = transporteEspia()
  configurarEnvio({ transporte: espia, repositorio: { async eliminar() { return 0 } } })

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/post/x',
    ahora: MEDIODIA,
  })

  assert.equal(r.enviado, false)
  assert.equal(r.motivo, 'bloqueado')
  assert.equal(r.entregas, 0)
  assert.deepEqual(espia.cargas, [], 'no se ha llegado a entregar nada')
  assert.equal(p.techoConsumido, 0, 'un aviso bloqueado no gasta el techo del día')
})

test('14b · el bloqueo se comprueba ANTES incluso de leer preferencias', async () => {
  let leyoAjustes = false
  const p = puerto({
    async hayBloqueo() {
      return true
    },
    async ajustesDe() {
      leyoAjustes = true
      return { prefs: {}, quietFrom: null, quietTo: null, tzOffset: 0 }
    },
  })
  configurarDespacho(p)

  await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: MEDIODIA,
  })
  assert.equal(leyoAjustes, false)
})

test('14c · la crisis TAMBIÉN respeta el bloqueo', async () => {
  // La crisis se salta el techo, la agrupación y el silencio, pero no esto:
  // quien bloqueó a alguien no puede recibir su aviso ni siquiera de madrugada.
  const p = puerto({
    async hayBloqueo() {
      return true
    },
  })
  configurarDespacho(p)

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'alma_afin_en_crisis',
    emisorId: 'bruno',
    url: '/refugios',
    ahora: MEDIODIA,
  })
  assert.equal(r.enviado, false)
  assert.equal(r.motivo, 'bloqueado')
})

// ── REFUGIO SILENCIADO ──────────────────────────────────────────────────────

test('un miembro con muted = true no recibe mensaje_refugio', async () => {
  const p = puerto({
    async silenciadoEnRefugio() {
      return true
    },
  })
  configurarDespacho(p)

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'mensaje_refugio',
    emisorId: 'bruno',
    url: '/refugios/r1',
    refugeId: 'r1',
    ahora: MEDIODIA,
  })

  assert.equal(r.enviado, false)
  assert.equal(r.motivo, 'silenciado_refugio')
})

// ── EL ALIAS ES DECISIÓN DEL EMISOR ─────────────────────────────────────────

test('si el emisor no revela su alias, el aviso llega como «alguien»', async () => {
  const p = puerto({
    async aliasSiRevela() {
      return null // esta persona desactivó revelar_alias
    },
  })
  configurarDespacho(p)

  const espia = transporteEspia()
  configurarEnvio({ transporte: espia, repositorio: { async eliminar() { return 0 } } })

  await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: MEDIODIA,
  })

  const carga = espia.cargas[0] as { titulo: string }
  assert.match(carga.titulo.toLowerCase(), /alguien/)
  assert.equal(JSON.stringify(espia.cargas).includes('Kai_23'), false)
})

test('si el emisor sí lo revela, el alias aparece', async () => {
  configurarDespacho(puerto())
  const espia = transporteEspia()
  configurarEnvio({ transporte: espia, repositorio: { async eliminar() { return 0 } } })

  await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: MEDIODIA,
  })

  const carga = espia.cargas[0] as { titulo: string }
  assert.ok(carga.titulo.includes('Kai_23'))
})

// ── EL TECHO SE CONSUME EN EL ORDEN CORRECTO ────────────────────────────────

test('el techo NO se consume cuando el aviso cae en horas de silencio', async () => {
  // `check_rate_limit()` cuenta al preguntar. Si se consultara antes que el
  // silencio nocturno, un aviso que nunca se entregó gastaría uno de los cuatro
  // del día y la persona se quedaría sin el que sí importaba.
  const p = puerto({
    async ajustesDe() {
      return { prefs: { ...PREFS_POR_DEFECTO }, quietFrom: 23 * 60, quietTo: 8 * 60, tzOffset: 0 }
    },
  })
  configurarDespacho(p)

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: new Date('2026-08-03T03:00:00.000Z'),
  })

  assert.equal(r.motivo, 'silencio')
  assert.equal(p.techoConsumido, 0)
  assert.deepEqual(p.acumulados, ['te_escucharon'], 'lo diferido queda acumulado')
})

test('la crisis no consulta el contador del techo en ningún caso', async () => {
  const p = puerto({
    async consumirTecho() {
      throw new Error('la crisis nunca debe preguntar por el techo')
    },
  })
  configurarDespacho(p)
  configurarEnvio({
    transporte: transporteEspia(),
    repositorio: { async eliminar() { return 0 } },
  })

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'alma_afin_en_crisis',
    emisorId: 'bruno',
    url: '/refugios',
    ahora: new Date('2026-08-03T03:00:00.000Z'),
  })

  assert.equal(r.enviado, true)
})

test('con el techo agotado, el motivo es «techo» y sale de decidirEnvio', async () => {
  const p = puerto({
    async consumirTecho() {
      return false
    },
  })
  configurarDespacho(p)

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: MEDIODIA,
  })

  assert.equal(r.enviado, false)
  assert.equal(r.motivo, 'techo')
})

// ── AGRUPACIÓN ──────────────────────────────────────────────────────────────

test('lo acumulado sale agregado en el siguiente aviso', async () => {
  const p = puerto({
    async estadoDe() {
      // Dos eventos quedaron sin anunciar; este es el tercero.
      return { ultimoMs: null, pendientes: 2 }
    },
  })
  configurarDespacho(p)

  const espia = transporteEspia()
  configurarEnvio({ transporte: espia, repositorio: { async eliminar() { return 0 } } })

  await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: MEDIODIA,
  })

  const carga = espia.cargas[0] as { titulo: string }
  assert.match(carga.titulo, /3 personas te escucharon/)
})

// ── APAGADO ─────────────────────────────────────────────────────────────────

test('sin llaves VAPID el despacho no hace nada y no lanza', async () => {
  delete process.env.VAPID_PUBLIC_KEY
  delete process.env.VAPID_PRIVATE_KEY

  let toco = false
  configurarDespacho(puerto({
    async hayBloqueo() {
      toco = true
      return false
    },
  }))

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'alma_afin_en_crisis',
    emisorId: 'bruno',
    url: '/refugios',
    ahora: MEDIODIA,
  })

  assert.equal(r.enviado, false)
  assert.equal(r.motivo, 'apagado')
  assert.equal(toco, false, 'ni siquiera consulta la base')
})

test('sin dispositivos registrados el motivo lo dice y no revienta', async () => {
  configurarDespacho(puerto({
    async suscripcionesDe() {
      return []
    },
  }))

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: MEDIODIA,
  })
  assert.equal(r.motivo, 'sin_dispositivos')
})

test('un fallo del puerto no propaga: la acción que lo provocó no puede romperse', async () => {
  configurarDespacho(puerto({
    async ajustesDe() {
      throw new Error('Postgres caído')
    },
  }))

  const r = await avisar({
    destinatarioId: 'ana',
    tipo: 'te_escucharon',
    emisorId: 'bruno',
    url: '/x',
    ahora: MEDIODIA,
  })
  assert.equal(r.enviado, false)
})
