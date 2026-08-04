import test from 'node:test'
import assert from 'node:assert/strict'

import {
  detectarSombra,
  formatearInforme,
  parsearEnv,
  refDeProyecto,
  revisarEntorno,
  sondearClave,
  verificarClaves,
  type Hallazgo,
} from './comprobacion.ts'

// Un entorno COMPLETO y sano. Cada prueba parte de aquí y rompe una cosa, que
// es la única forma de que «no hay hallazgos» signifique algo.
const HEX = 'a'.repeat(64)
const sano = (cambios: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_loquesea',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_loquesea',
  IDENTITY_PEPPER: HEX,
  TOTP_ENC_KEY: HEX,
  CRON_SECRET: 'x'.repeat(40),
  MODERATION_API_KEY: 'sk-loquesea',
  VAPID_PRIVATE_KEY: 'v',
  PUSH_UA_SALT: 's',
  ...cambios,
})

const de = (hallazgos: readonly Hallazgo[], variable: string): Hallazgo | undefined =>
  hallazgos.find((h) => h.variable === variable)

// ── Control positivo ────────────────────────────────────────────────────────

test('un entorno completo no produce ningún hallazgo', () => {
  assert.deepEqual(revisarEntorno(sano()), [])
})

// ── Presencia y forma ───────────────────────────────────────────────────────

test('una obligatoria que falta, o está vacía, es bloqueante', () => {
  for (const vacio of [undefined, '', '   ']) {
    const h = de(revisarEntorno(sano({ IDENTITY_PEPPER: vacio })), 'IDENTITY_PEPPER')
    assert.equal(h?.gravedad, 'bloqueante', `no detectó el valor ${JSON.stringify(vacio)}`)
  }
})

test('la URL del proyecto se valida por forma, no solo por presencia', () => {
  const malas = [
    'https://abcdefghijklmnopqrst.supabase.co/', // barra final
    'http://abcdefghijklmnopqrst.supabase.co', // sin TLS
    'https://midominio.com',
    'abcdefghijklmnopqrst.supabase.co', // sin esquema
  ]
  for (const url of malas) {
    const h = de(revisarEntorno(sano({ NEXT_PUBLIC_SUPABASE_URL: url })), 'NEXT_PUBLIC_SUPABASE_URL')
    assert.equal(h?.gravedad, 'bloqueante', `aceptó «${url}»`)
  }
  assert.equal(refDeProyecto('https://abcdefghijklmnopqrst.supabase.co'), 'abcdefghijklmnopqrst')
  assert.equal(refDeProyecto(undefined), null)
})

test('🔴 una clave SECRETA bajo NEXT_PUBLIC_ se caza, y el aviso manda rotarla', () => {
  // Es el fallo más caro que puede tener este archivo: NEXT_PUBLIC_ va al
  // bundle del navegador, y esa clave salta RLS y ve identity_vault.
  const h = de(
    revisarEntorno(sano({ NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_uy' })),
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  )
  assert.equal(h?.gravedad, 'bloqueante')
  assert.match(h!.problema, /navegador/)
  assert.match(h!.arreglo, /ROTA/)
})

test('la clave publicable puesta donde va la secreta también se caza', () => {
  const h = de(
    revisarEntorno(sano({ SUPABASE_SERVICE_ROLE_KEY: 'sb_publishable_uy' })),
    'SUPABASE_SERVICE_ROLE_KEY',
  )
  assert.equal(h?.gravedad, 'bloqueante')
})

test('los secretos hexadecimales exigen 32 bytes exactos', () => {
  for (const malo of ['a'.repeat(63), 'a'.repeat(65), 'z'.repeat(64), 'no-es-hex']) {
    const h = de(revisarEntorno(sano({ TOTP_ENC_KEY: malo })), 'TOTP_ENC_KEY')
    assert.equal(h?.gravedad, 'bloqueante', `aceptó «${malo.slice(0, 12)}…»`)
  }
})

test('lo que solo degrada es AVISO, no bloqueante, y dice qué se pierde', () => {
  const h = de(revisarEntorno(sano({ MODERATION_API_KEY: '' })), 'MODERATION_API_KEY')
  assert.equal(h?.gravedad, 'aviso')
  // El punto entero del aviso: que nadie descubra tres días después que el
  // karma no se movía.
  assert.match(h!.problema, /karma/)
})

// ── Sombra del entorno ──────────────────────────────────────────────────────

test('parsearEnv ignora comentarios y respeta los «=» del valor', () => {
  const pares = parsearEnv(['# comentario', '', 'A=1', '  B = dos  ', 'C=a=b=c', 'sinigual'].join('\n'))
  assert.equal(pares.get('A'), '1')
  assert.equal(pares.get('B'), 'dos')
  assert.equal(pares.get('C'), 'a=b=c')
  assert.equal(pares.has('sinigual'), false)
  assert.equal(pares.size, 3)
})

test('🔴 detecta que el proceso recibió un valor distinto al de .env.local', () => {
  // El fallo invisible: editas el archivo, guardas, reinicias, y sigue el viejo
  // porque el shell lo exporta y Next.js no sobrescribe process.env.
  const hallazgos = detectarSombra({ CLAVE: 'la_del_shell' }, 'CLAVE=la_del_archivo')
  assert.equal(hallazgos.length, 1)
  assert.equal(hallazgos[0]!.gravedad, 'bloqueante')
  assert.match(hallazgos[0]!.arreglo, /reinicia la terminal/)
})

test('no hay sombra cuando coinciden, ni cuando el entorno trae variables de más', () => {
  assert.deepEqual(detectarSombra({ A: '1' }, 'A=1'), [])
  assert.deepEqual(detectarSombra({ A: '1', OTRA: 'x' }, 'A=1'), [])
})

test('una variable del archivo que NO llegó al proceso también es sombra', () => {
  // Pasa cuando el archivo no se carga en absoluto. El síntoma es idéntico al
  // de una variable mal escrita, y conviene distinguirlos.
  assert.equal(detectarSombra({}, 'A=1').length, 1)
})

test('la sombra nunca imprime el valor de la variable', () => {
  const [h] = detectarSombra({ SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_REAL' }, 'SUPABASE_SERVICE_ROLE_KEY=sb_secret_OTRA')
  const texto = `${h!.problema} ${h!.arreglo}`
  assert.doesNotMatch(texto, /sb_secret_REAL|sb_secret_OTRA/)
})

// ── Sonda ───────────────────────────────────────────────────────────────────

const respuesta = (status: number, cuerpo: unknown = {}): Response =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } })

test('401 significa que la clave NO es de este proyecto', async () => {
  const r = await sondearClave('https://x.supabase.co', 'k', { fetchImpl: async () => respuesta(401) })
  assert.equal(r.valida, false)
})

test('200 valida la clave y trae si el alta anónima está activa', async () => {
  const r = await sondearClave('https://x.supabase.co', 'k', {
    fetchImpl: async () => respuesta(200, { external: { anonymous_users: false } }),
  })
  assert.equal(r.valida, true)
  assert.equal(r.altaAnonimaActiva, false)
})

test('🔴 un fallo de red NO se interpreta como clave inválida', async () => {
  // Si la sonda diera por mala una clave buena porque la red falló, el informe
  // gritaría en falso y en dos días nadie lo leería.
  const r = await sondearClave('https://x.supabase.co', 'k', {
    fetchImpl: async () => {
      throw new TypeError('fetch failed')
    },
  })
  assert.equal(r.valida, true)
  assert.match(r.incierto ?? '', /TypeError/)
})

test('la sonda no propaga el error, así que no puede tumbar el arranque', async () => {
  await assert.doesNotReject(
    sondearClave('https://x.supabase.co', 'k', {
      fetchImpl: async () => {
        throw new Error('lo que sea')
      },
    }),
  )
})

test('un 5xx deja la clave como incierta, no como inválida', async () => {
  const r = await sondearClave('https://x.supabase.co', 'k', { fetchImpl: async () => respuesta(503) })
  assert.equal(r.valida, true)
  assert.match(r.incierto ?? '', /503/)
})

test('verificarClaves nombra el proyecto que rechaza la clave', async () => {
  const hallazgos = await verificarClaves(sano(), { fetchImpl: async () => respuesta(401) })
  const h = de(hallazgos, 'SUPABASE_SERVICE_ROLE_KEY')
  assert.equal(h?.gravedad, 'bloqueante')
  assert.match(h!.problema, /abcdefghijklmnopqrst/)
})

test('el alta anónima desactivada se reporta como bloqueante', async () => {
  const hallazgos = await verificarClaves(sano(), {
    fetchImpl: async () => respuesta(200, { external: { anonymous_users: false } }),
  })
  const h = de(hallazgos, '(Supabase Auth)')
  assert.equal(h?.gravedad, 'bloqueante')
  assert.match(h!.arreglo, /anonymous sign-ins/i)
})

test('con el alta anónima activa y las claves buenas no se dice nada', async () => {
  const hallazgos = await verificarClaves(sano(), {
    fetchImpl: async () => respuesta(200, { external: { anonymous_users: true } }),
  })
  assert.deepEqual(hallazgos, [])
})

test('sin URL válida no se sondea: el aviso ya lo dio revisarEntorno', async () => {
  let llamadas = 0
  const hallazgos = await verificarClaves(sano({ NEXT_PUBLIC_SUPABASE_URL: 'no-es-url' }), {
    fetchImpl: async () => {
      llamadas += 1
      return respuesta(401)
    },
  })
  assert.deepEqual(hallazgos, [])
  assert.equal(llamadas, 0)
})

// ── Informe ─────────────────────────────────────────────────────────────────

test('sin hallazgos el informe es vacío: arrancar limpio no imprime ruido', () => {
  assert.equal(formatearInforme([]), '')
})

test('el informe separa lo que rompe de lo que solo degrada', () => {
  const texto = formatearInforme([
    { variable: 'A', gravedad: 'bloqueante', problema: 'p1', arreglo: 'a1' },
    { variable: 'B', gravedad: 'aviso', problema: 'p2', arreglo: 'a2' },
  ])
  assert.match(texto, /1 problema\(s\) que impiden/)
  assert.match(texto, /1 función\(es\) apagada\(s\)/)
  assert.ok(texto.indexOf('A') < texto.indexOf('B'), 'lo bloqueante debe ir primero')
})
