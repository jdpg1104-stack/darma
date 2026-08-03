// Suite de intrusión contra darma-dev usando SOLO la clave anónima — la misma
// que va incrustada en cualquier navegador que abra la app. Cada caso AFIRMA
// que la operación FALLA. Un test de RLS que solo comprueba el camino permitido
// pasa igual con RLS desactivada.
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync('C:/Users/jdpg1/Desktop/Darma/.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    })
)

const URL_BASE = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const VICTIMA = '11111111-1111-1111-1111-111111111111'
const POST_VICTIMA = '22222222-2222-2222-2222-222222222222'

if (!URL_BASE || !ANON) throw new Error('faltan URL o anon key en .env.local')

// ── El atacante se registra como cualquiera ────────────────────────────────
const alta = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'atacante@ejemplo.com', password: 'Contrasena-De-Prueba-2026!' }),
}).then((r) => r.json())

const jwt = alta.access_token ?? null
const atacanteId = alta.user?.id ?? null
console.log(`sesión de atacante: ${jwt ? 'CONSEGUIDA (rol ' + JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()).role + ')' : 'NO — ' + JSON.stringify(alta).slice(0, 160)}`)
if (!jwt) { console.log('\n⛔ Sin sesión no hay prueba válida: todo saldría "bloqueado" por no tener permisos, no por RLS.'); process.exit(1) }

const cab = (auth) => ({
  apikey: ANON,
  authorization: `Bearer ${auth ?? ANON}`,
  'content-type': 'application/json',
})

const resultados = []
async function intento(nombre, esperado, fn) {
  try {
    const r = await fn()
    const cuerpo = await r.text()
    const bloqueado = !r.ok
    resultados.push({
      caso: nombre,
      http: r.status,
      veredicto: bloqueado === esperado.debeFallar ? '✅ BLOQUEADO' : '🔴 PERMITIDO',
      detalle: cuerpo.slice(0, 150),
    })
  } catch (e) {
    resultados.push({ caso: nombre, http: '—', veredicto: '⚠️ ERROR', detalle: String(e).slice(0, 120) })
  }
}

// Caso especial: un 200 con [] también es un bloqueo efectivo (RLS filtra filas).
async function intentoLectura(nombre, url, auth) {
  const r = await fetch(url, { headers: cab(auth) })
  const cuerpo = await r.text()
  const vacio = cuerpo.trim() === '[]'
  resultados.push({
    caso: nombre,
    http: r.status,
    veredicto: !r.ok || vacio ? '✅ BLOQUEADO' : '🔴 FILTRADO',
    detalle: cuerpo.slice(0, 150),
  })
}

// 1. Leer el saldo gastable y los cristales de otra persona.
await intentoLectura('1 · leer karma_spendable y crystals ajenos',
  `${URL_BASE}/rest/v1/profiles?select=alias,karma_spendable,crystals&id=eq.${VICTIMA}`, jwt)

// 2. Leer la bóveda de identidad (el vínculo alias ↔ persona real).
await intentoLectura('2 · leer identity_vault', `${URL_BASE}/rest/v1/identity_vault?select=*`, jwt)

// 3. Regalarse reputación.
await intento('3 · escribirse karma_reputation', { debeFallar: true }, () =>
  fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${atacanteId}`, {
    method: 'PATCH', headers: cab(jwt), body: JSON.stringify({ karma_reputation: 999999 }),
  }))

// 4. Regalarse cristales.
await intento('4 · escribirse crystals', { debeFallar: true }, () =>
  fetch(`${URL_BASE}/rest/v1/profiles?id=eq.${atacanteId}`, {
    method: 'PATCH', headers: cab(jwt), body: JSON.stringify({ crystals: 100000 }),
  }))

// 5. Publicar suplantando a otra persona.
await intento('5 · publicar como la victima', { debeFallar: true }, () =>
  fetch(`${URL_BASE}/rest/v1/posts`, {
    method: 'POST', headers: cab(jwt),
    body: JSON.stringify({ author_id: VICTIMA, body: 'Suplantacion de identidad con longitud suficiente.' }),
  }))

// 6. Validar su propio comentario para cobrar karma (is_validated no está en el grant).
await intento('6 · autovalidarse un comentario', { debeFallar: true }, () =>
  fetch(`${URL_BASE}/rest/v1/comments`, {
    method: 'POST', headers: cab(jwt),
    body: JSON.stringify({ post_id: POST_VICTIMA, author_id: atacanteId, is_validated: true,
      body: 'Comentario que intenta nacer ya validado para cobrar karma sin que nadie lo revise.' }),
  }))

// 7. Escribir directo en el ledger de karma.
await intento('7 · insertar en karma_events', { debeFallar: true }, () =>
  fetch(`${URL_BASE}/rest/v1/karma_events`, {
    method: 'POST', headers: cab(jwt),
    body: JSON.stringify({ user_id: atacanteId, kind: 'comment_validated', delta_reputation: 5000, delta_spendable: 5000 }),
  }))

// 8. Marcar contenido como completado para farmear el +1 sin verlo.
await intento('8 · farmear content_views (completed=true)', { debeFallar: true }, () =>
  fetch(`${URL_BASE}/rest/v1/content_views`, {
    method: 'POST', headers: cab(jwt),
    body: JSON.stringify({ content_id: '33333333-3333-3333-3333-333333333333', user_id: atacanteId, completed: true }),
  }))

// 9. Llamar sin sesión a la función que devuelve saldos.
await intento('9 · mi_perfil_privado() sin sesión', { debeFallar: true }, () =>
  fetch(`${URL_BASE}/rest/v1/rpc/mi_perfil_privado`, { method: 'POST', headers: cab(null), body: '{}' }))

// 10. Control positivo: lo que SÍ debe funcionar. Si esto falla, la suite
//     estaría dando verdes falsos (todo "bloqueado" porque nada funciona).
await intentoLectura('10 · CONTROL: leer el perfil público de la victima',
  `${URL_BASE}/rest/v1/profiles?select=alias,karma_reputation,level&id=eq.${VICTIMA}`, jwt)

console.table(resultados.map((r) => ({ caso: r.caso, http: r.http, veredicto: r.veredicto })))
for (const r of resultados) console.log(`\n${r.caso}\n  → ${r.veredicto} [${r.http}] ${r.detalle}`)
