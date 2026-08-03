// ============================================================================
// Test nº 13 de la ficha B14 · el gate de reciprocidad sobrevive a una siembra
// que falla a mitad.
//
//   SEED_ALLOW=1 node --test --experimental-strip-types scripts/seed/sembrar.test.ts
//
// ⚠️ NO lo ejecuta `npm test`: ese script solo recorre `lib/**`. Es deliberado
// —es un test de INTEGRACIÓN, necesita Postgres— y está anotado en
// HANDOFF/PEDIDOS.md para que B15 lo añada al workflow con una base levantada.
//
// POR QUÉ ESTE TEST EXISTE:
//
// `trg_posts_reciprocity` es la regla central de Darma: escuchar a 3 personas
// desbloquea 1 publicación. La siembra tiene que desactivarlo (con él activo
// muere en la fila 100 001). El riesgo no es que la siembra falle: es que falle
// A MITAD y deje el gate apagado. A partir de ahí, la base de esa persona
// permite publicar sin escuchar a nadie, la aplicación parece funcionar
// perfectamente, y la regla que sostiene el producto entero se ha convertido en
// decorativa sin que nada avise. Peor aún: cuando esa persona comparta su
// comando de siembra, el mismo estado se reproduce en la base de quien lo copie.
//
// Por eso no basta con el `finally` del script. Hace falta una prueba que
// intente insertar un post sin crédito y EXIJA la excepción.
//
// Las partes puras (distribución, alias, hot_score) sí se prueban sin base de
// datos, y esas corren siempre.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

import {
  aliasSembrado,
  autorDePost,
  colaLarga,
  creadoEn,
  crearAzar,
  cuerpoSintetico,
  estadoDePost,
  hotScore,
  idDeterminista,
  PREFIJO_SEED,
  riesgoDePost,
} from './perfilesFalsos.ts'

// ── Parte pura · siempre se ejecuta ─────────────────────────────────────────

test('la siembra es DETERMINISTA: misma semilla, mismos datos', () => {
  const a = crearAzar(42)
  const b = crearAzar(42)
  for (let i = 0; i < 100; i += 1) assert.equal(a(), b())
  // Un EXPLAIN solo es comparable contra otro EXPLAIN sobre los MISMOS datos.
  assert.notEqual(crearAzar(42)(), crearAzar(43)())
})

test('los ids no colisionan a escala de 100 000 filas', () => {
  const vistos = new Set<string>()
  for (let i = 0; i < 50_000; i += 1) vistos.add(idDeterminista(`7:perfil:${i}`))
  assert.equal(vistos.size, 50_000, 'colisión de uuid: el COPY moriría por la PK')
})

test('los alias sembrados son únicos y cumplen el CHECK de profiles.alias', () => {
  const patron = /^[a-zA-Z0-9_áéíóúñÁÉÍÓÚÑ ]+$/
  const vistos = new Set<string>()
  for (let i = 0; i < 20_000; i += 1) {
    const alias = aliasSembrado(i)
    assert.ok(alias.startsWith(PREFIJO_SEED), 'sin prefijo, --limpiar no sabría qué borrar')
    assert.ok(alias.length >= 3 && alias.length <= 24, `longitud inválida: ${alias}`)
    assert.match(alias, patron)
    vistos.add(alias)
  }
  assert.equal(vistos.size, 20_000)
})

test('los cuerpos sintéticos respetan los CHECK de longitud', () => {
  const azar = crearAzar(1)
  for (let i = 0; i < 500; i += 1) {
    const post = cuerpoSintetico(azar, 60, 400)
    assert.ok(post.length >= 20 && post.length <= 5000, `posts.body: ${post.length}`)
    const comentario = cuerpoSintetico(azar, 80, 600)
    assert.ok(comentario.length >= 40 && comentario.length <= 4000, `comments.body: ${comentario.length}`)
  }
})

test('la distribución de autores NO es uniforme: el 1 % concentra ~30 %', () => {
  const azar = crearAzar(20260803)
  const autores = 10_000
  const cuenta = new Int32Array(autores)
  const total = 200_000
  for (let i = 0; i < total; i += 1) cuenta[autorDePost(azar, autores)] += 1

  const ordenado = [...cuenta].sort((x, y) => y - x)
  const cima = ordenado.slice(0, autores * 0.01).reduce((a, b) => a + b, 0)
  const pct = (100 * cima) / total

  // Una siembra uniforme haría que todo pareciese rápido porque el planificador
  // acertaría siempre. Este test es la garantía de que eso no pasa.
  assert.ok(pct > 22 && pct < 45, `el 1 % de autores concentra ${pct.toFixed(1)} %, se esperaba ~30 %`)
})

test('las proporciones de estado y riesgo replican los índices parciales', () => {
  const azar = crearAzar(7)
  let noActivos = 0
  let riesgoAlto = 0
  const n = 100_000
  for (let i = 0; i < n; i += 1) {
    if (estadoDePost(azar) !== 'active') noActivos += 1
    const r = riesgoDePost(azar)
    if (r === 'high' || r === 'critical') riesgoAlto += 1
  }
  // ~5 % no activos: sin ellos, `where state = 'active'` no excluye nada y el
  // índice parcial no demuestra su valor.
  assert.ok(noActivos / n > 0.04 && noActivos / n < 0.06, `no activos: ${noActivos / n}`)
  // ~2 % de riesgo alto: el tamaño real de idx_posts_risk.
  assert.ok(riesgoAlto / n > 0.015 && riesgoAlto / n < 0.025, `riesgo alto: ${riesgoAlto / n}`)
})

test('hot_score replica compute_hot_score() de 0001_core.sql', () => {
  // Espejo exacto: s = 1·upvotes + 13,5·replies;
  //   score = sign(s)·log10(max(|s|,1)) + (epoch − 1767225600) / 45000
  const creado = new Date('2026-06-01T00:00:00Z')
  const esperado =
    Math.log10(Math.max(Math.abs(1 * 10 + 13.5 * 4), 1)) +
    (Math.floor(creado.getTime() / 1000) - 1767225600) / 45000
  assert.ok(Math.abs(hotScore(10, 4, creado) - esperado) < 1e-9)

  // Un post sin señal social puntúa SOLO por frescura (el término logarítmico
  // es 0 porque sign(0) = 0). Si esto fuese distinto de 0 para upvotes=0, el
  // índice del feed quedaría dominado por el signo y no por el tiempo.
  assert.equal(hotScore(0, 0, new Date(1767225600000)), 0)
})

test('la cola larga produce cola larga, no una recta', () => {
  const azar = crearAzar(3)
  const muestras = Array.from({ length: 50_000 }, () => colaLarga(azar, 1.25, 5000))
  const ceros = muestras.filter((x) => x === 0).length
  const maximo = Math.max(...muestras)
  // La mayoría de posts no recibe nada y unos pocos concentran la conversación:
  // es lo que separa los hot_score y hace que el keyset recorra de verdad el
  // índice en vez de encontrarlo todo agrupado en un puñado de valores.
  assert.ok(ceros / muestras.length > 0.3, `solo ${ceros} ceros: la cola es demasiado corta`)
  assert.ok(maximo > 100, `máximo ${maximo}: no hay cola larga`)
})

test('creadoEn reparte 18 meses con sesgo hacia lo reciente', () => {
  const azar = crearAzar(5)
  const ahora = new Date('2026-08-03T00:00:00Z')
  let recientes = 0
  const n = 20_000
  let masAntiguo = ahora.getTime()
  for (let i = 0; i < n; i += 1) {
    const d = creadoEn(azar, ahora).getTime()
    if (ahora.getTime() - d < 90 * 86400000) recientes += 1
    masAntiguo = Math.min(masAntiguo, d)
  }
  assert.ok(recientes / n > 0.35, 'sin sesgo hacia lo reciente la punta del índice no es densa')
  const diasDeHistoria = (ahora.getTime() - masAntiguo) / 86400000
  assert.ok(diasDeHistoria > 400, `solo ${diasDeHistoria.toFixed(0)} días de historia`)
})

// ── Parte de integración · necesita Postgres ────────────────────────────────

const CONEXION = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres'

/** ¿Hay una base local respondiendo? Si no, los tests de abajo se SALTAN. */
function hayBase(): boolean {
  try {
    execFileSync('psql', [CONEXION, '-tAc', 'select 1'], { stdio: 'pipe', timeout: 5000 })
    return true
  } catch {
    return false
  }
}

const SIN_BASE = !hayBase()
const MOTIVO =
  'no hay Postgres local en DATABASE_URL. Levanta la base con `supabase start` ' +
  'y vuelve a ejecutar: este test es el que garantiza que la siembra no deja el ' +
  'gate 3:1 apagado.'

function psql(sentencia: string): string {
  return execFileSync('psql', [CONEXION, '-tAc', sentencia], { encoding: 'utf8' }).trim()
}

test('13 · tras una siembra interrumpida, trg_posts_reciprocity sigue ACTIVO', { skip: SIN_BASE && MOTIVO }, () => {
  const desactivados = psql(`
    select count(*) from pg_trigger
     where tgname in ('trg_posts_reciprocity','trg_posts_hot',
                      'trg_refuge_messages_sync','trg_refuge_members_sync')
       and tgenabled = 'D';
  `)
  assert.equal(
    desactivados,
    '0',
    'HAY TRIGGERS DESACTIVADOS. El gate de reciprocidad de Darma podría estar apagado ' +
      'en esta base. Ejecuta: node --experimental-strip-types scripts/seed/sembrar.ts --verificar-triggers',
  )
})

test('13b · el gate rechaza de verdad un post sin crédito de escucha', { skip: SIN_BASE && MOTIVO }, () => {
  // Se crea un perfil con posts_published = 1 y listen_credits = 0: el primer
  // post es gratis, el segundo NO. Comprobar el estado del trigger en el
  // catálogo no basta — un trigger activo cuya función se reescribió mal
  // seguiría figurando como activo.
  const idUsuario = idDeterminista('test-reciprocidad-b14')
  const alias = `${PREFIJO_SEED}test_gate`

  try {
    psql(`
      insert into auth.users (instance_id, id, aud, role, email, encrypted_password, created_at, updated_at)
      values ('00000000-0000-0000-0000-000000000000', '${idUsuario}', 'authenticated', 'authenticated',
              '${PREFIJO_SEED}gate@darma.invalid', 'x', now(), now())
      on conflict (id) do nothing;
    `)
    psql(`
      insert into public.profiles (id, alias, posts_published, listen_credits)
      values ('${idUsuario}', '${alias}', 1, 0)
      on conflict (id) do update set posts_published = 1, listen_credits = 0;
    `)

    let excepcion = ''
    try {
      psql(`
        insert into public.posts (author_id, body)
        values ('${idUsuario}', 'texto de prueba del gate de reciprocidad, longitud suficiente');
      `)
    } catch (e) {
      excepcion = e instanceof Error ? `${e.message}` : String(e)
    }

    assert.match(
      excepcion,
      /reciprocidad/i,
      'EL GATE 3:1 NO RECHAZÓ LA PUBLICACIÓN. La regla central de Darma está desactivada en esta base.',
    )
  } finally {
    // Cascada desde auth.users: se lleva profiles y cualquier post que hubiera.
    psql(`delete from auth.users where id = '${idUsuario}';`)
  }
})
