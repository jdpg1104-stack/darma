// ============================================================================
// Tests del escáner de secretos.
//
// Las dos direcciones del error importan lo mismo:
//   · si marca la anon key (que es pública por diseño y vive en el bundle), el
//     equipo aprende a ignorar el escáner y entonces ya no protege nada;
//   · si no marca la service_role key, no sirve para lo único que existe.
//
// Y una regla que se testea explícitamente: NUNCA imprime el secreto.
// ============================================================================

import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  escanearTexto,
  escanearArbol,
  esJwtServiceRole,
  formatearInforme,
  ENV_LOCAL_RE,
  esEnvLocalIgnorado,
} from './guardSecretos.ts'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

/** Fabrica un JWT de juguete (firma inventada: nunca es válido en ningún sitio). */
function jwtFalso(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url')
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.${'x'.repeat(43)}`
}

const JWT_ANON = jwtFalso({ iss: 'supabase', role: 'anon', iat: 1, exp: 2 })
const JWT_SERVICE = jwtFalso({ iss: 'supabase', role: 'service_role', iat: 1, exp: 2 })

// ── La distinción que justifica escribir un escáner propio ──────────────────

test('la anon key NO es un hallazgo: es pública por diseño', () => {
  assert.equal(esJwtServiceRole(JWT_ANON), false)
  assert.deepEqual(escanearTexto(`NEXT_PUBLIC_SUPABASE_ANON_KEY=${JWT_ANON}`, '.env.example'), [])
})

test('la service_role key SÍ es un hallazgo', () => {
  assert.equal(esJwtServiceRole(JWT_SERVICE), true)

  const hallazgos = escanearTexto(`SUPABASE_SERVICE_ROLE_KEY=${JWT_SERVICE}`, '.env.local')
  assert.equal(hallazgos.length, 1)
  assert.equal(hallazgos[0]!.tipo, 'supabase_service_role_jwt')
  assert.equal(hallazgos[0]!.linea, 1)
})

test('EL SECRETO NUNCA SE IMPRIME (ni un fragmento)', () => {
  const hallazgos = escanearTexto(`clave = "${JWT_SERVICE}"`, 'config.ts')
  const informe = formatearInforme(hallazgos)

  assert.ok(!informe.includes(JWT_SERVICE), 'el informe no puede contener el token')
  // Ni siquiera un prefijo largo: reduciría el espacio de búsqueda de quien lea
  // el log de CI, que es visible para todo el equipo.
  assert.ok(!informe.includes(JWT_SERVICE.slice(0, 24)))
  assert.match(informe, /config\.ts:1/)
  assert.match(informe, /ROTA la clave/)
})

test('el informe dice el orden correcto: rotar primero, limpiar historial después', () => {
  const informe = formatearInforme(escanearTexto(`x=${JWT_SERVICE}`, 'a.ts'))
  const posRotar = informe.indexOf('ROTA la clave')
  const posLimpiar = informe.indexOf('Limpia el historial')
  assert.ok(posRotar > -1 && posLimpiar > -1)
  assert.ok(posRotar < posLimpiar, 'rotar tiene que ir ANTES de limpiar el historial')
})

// ── Los otros patrones ──────────────────────────────────────────────────────

test('detecta una clave de Anthropic', () => {
  const h = escanearTexto(`ANTHROPIC_API_KEY=sk-ant-${'a'.repeat(40)}`, 'lib/ai/cliente.ts')
  assert.equal(h.length, 1)
  assert.equal(h[0]!.tipo, 'anthropic_api_key')
})

test('no marca un `sk-ant-xxx` de documentación', () => {
  assert.deepEqual(escanearTexto('ANTHROPIC_API_KEY=sk-ant-xxx', 'README.md'), [])
})

test('detecta un bloque PEM de clave privada', () => {
  const h = escanearTexto('-----BEGIN PRIVATE KEY-----', 'claves/servidor.pem')
  assert.equal(h[0]?.tipo, 'private_key_pem')
})

test('detecta una clave privada VAPID por el nombre de la variable', () => {
  const h = escanearTexto(`VAPID_PRIVATE_KEY="${'b'.repeat(43)}"`, '.env.local')
  assert.equal(h[0]?.tipo, 'vapid_private_key')
})

test('detecta un .p8 de Apple por la extensión del archivo', () => {
  const h = escanearTexto('cualquier contenido', 'claves/AuthKey_ABC123.p8')
  assert.equal(h.length, 1)
  assert.equal(h[0]!.tipo, 'apple_p8_key')
})

// ── La exención de .env.local ───────────────────────────────────────────────
// El archivo existe PARA guardar secretos reales y .gitignore lo excluye del
// repositorio: denunciarlo convierte cada máquina configurada en un falso
// positivo permanente. La exención exige que git de verdad lo ignore.

test('ENV_LOCAL_RE reconoce exactamente las variantes de .env.local', () => {
  assert.ok(ENV_LOCAL_RE.test('.env.local'))
  assert.ok(ENV_LOCAL_RE.test('.env.development.local'))
  assert.ok(ENV_LOCAL_RE.test('apps/web/.env.local'))
  // Lo que NO se exime: la plantilla (se versiona), un .env a secas y un backup.
  assert.ok(!ENV_LOCAL_RE.test('.env.example'))
  assert.ok(!ENV_LOCAL_RE.test('.env'))
  assert.ok(!ENV_LOCAL_RE.test('.env.local.bak'))
})

test('.env.local del repo real está ignorado por git (la condición de la exención)', () => {
  // En este repo .gitignore cubre .env*.local; si alguien lo saca de ahí, este
  // test y el escaneo del árbol se ponen rojos A LA VEZ, que es lo que se quiere.
  assert.equal(esEnvLocalIgnorado(RAIZ, '.env.local'), true)
})

test('un archivo que no es .env.local nunca entra por la exención', () => {
  assert.equal(esEnvLocalIgnorado(RAIZ, '.env.example'), false)
  assert.equal(esEnvLocalIgnorado(RAIZ, 'lib/crisis.ts'), false)
})

// ── El árbol real ───────────────────────────────────────────────────────────

test('el repositorio no tiene secretos de Darma en el árbol de trabajo', () => {
  const hallazgos = escanearArbol(RAIZ)
  assert.deepEqual(hallazgos, [], formatearInforme(hallazgos))
})

test('el informe de éxito es explícito', () => {
  assert.match(formatearInforme([]), /OK/)
})
