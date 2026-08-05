// ============================================================================
// Escáner de secretos · patrones específicos de Darma
//
// `gitleaks` (en `.github/workflows/seguridad.yml`) cubre lo genérico. Esto
// cubre lo NUESTRO, que es donde un escáner genérico se equivoca en las dos
// direcciones:
//
//  · FALSO POSITIVO que hay que evitar: la anon key de Supabase es un JWT
//    (`eyJhbGciOi…`) y es PÚBLICA POR DISEÑO — vive en el bundle y en
//    `.env.example`. Un escáner que marque «JWT en el repo» hace que el equipo
//    aprenda a ignorar el escáner, y entonces el escáner ya no protege nada.
//    Por eso aquí el JWT se DECODIFICA y solo se denuncia si el payload dice
//    `"role":"service_role"`.
//
//  · FALSO NEGATIVO que hay que evitar: la clave privada VAPID de push, el `.p8`
//    de Apple y `sk-ant-…` no siempre están en las firmas por defecto.
//
// REGLA INNEGOCIABLE: este escáner NUNCA imprime el secreto encontrado. Un log
// de CI es visible para todo el equipo (y para quien tenga acceso al repo). Se
// imprime archivo, línea y tipo. Nada más.
//
// ORDEN DE RESPUESTA SI ENCUENTRA ALGO — importa y no es negociable:
//   1. ROTA la clave. Ya está comprometida; el historial de git se replica en
//      cada clon, en cada fork y en la caché de GitHub.
//   2. DESPUÉS limpia el historial. Al revés solo consigues perder la evidencia
//      de qué se filtró mientras la clave sigue siendo válida.
//   Ver `.github/workflows/README.md`.
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export type TipoSecreto =
  | 'supabase_service_role_jwt'
  | 'anthropic_api_key'
  | 'vapid_private_key'
  | 'private_key_pem'
  | 'apple_p8_key'

export interface Hallazgo {
  archivo: string
  linea: number
  tipo: TipoSecreto
  /** Descripción legible. NUNCA contiene el secreto. */
  detalle: string
}

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_POR_DEFECTO = join(AQUI, '..', '..')

// `.claude` incluye los worktrees de git que crean las sesiones paralelas: son
// COPIAS del propio repositorio, así que escanearlas duplica cada hallazgo y,
// peor, denuncia como secreto el PEM de ejemplo que este mismo guard usa de
// fixture en su test. Un guard que se acusa a sí mismo enseña a ignorarlo.
// Lo que de verdad protege es el árbol real, y ese sí se recorre entero.
const IGNORAR_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  '.claude',
  'out',
  'build',
  'coverage',
  'dist',
])

/**
 * Este directorio se salta: contiene los PATRONES de detección y las cadenas de
 * prueba de sus tests. Escanearse a sí mismo genera hallazgos que no son
 * secretos y entrena al equipo a ignorar el informe.
 */
const RUTA_PROPIA = 'scripts/security/'

const EXT_BINARIAS = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|eot|pdf|zip|gz|mp4|webm)$/i

// ── Archivos de secretos locales ────────────────────────────────────────────

/**
 * `.env.local` (y variantes `.env.*.local`) son el ÚNICO sitio sancionado para
 * secretos reales en una máquina de desarrollo: Next los carga y `.gitignore`
 * los excluye del repositorio. Denunciar la clave que ese archivo existe para
 * guardar convierte cada máquina configurada en un falso positivo permanente —
 * y un guard que grita siempre enseña al equipo a ignorarlo (el mismo
 * argumento de la cabecera sobre la anon key).
 *
 * La exención NO es incondicional: `esEnvLocalIgnorado()` comprueba con
 * `git check-ignore` que el archivo sigue realmente ignorado. Si alguien lo
 * saca del `.gitignore` (y por tanto puede acabar en un commit), vuelve a
 * escanearse. Y si a pesar del ignore alguien lo forzó al historial con
 * `git add -f`, lo caza `escanearHistorial`, que no aplica esta exención.
 */
export const ENV_LOCAL_RE = /(^|\/)\.env(\.[^/]+)?\.local$/

export function esEnvLocalIgnorado(raiz: string, rel: string): boolean {
  if (!ENV_LOCAL_RE.test(rel)) return false
  try {
    execFileSync('git', ['check-ignore', '-q', rel], { cwd: raiz, stdio: 'ignore' })
    return true
  } catch {
    // Fuera de un repo de git, o no ignorado: se escanea. Fallar hacia
    // escanear de más es el lado seguro.
    return false
  }
}

function aPosix(p: string): string {
  return p.split(sep).join('/')
}

// ── JWT de Supabase ─────────────────────────────────────────────────────────

/** Un JWT con las tres partes en base64url. */
const JWT_RE = /eyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g

/**
 * ¿El payload de este JWT declara `role: service_role`?
 *
 * Decodificar en vez de comparar la cadena es lo que separa el secreto real de
 * la clave pública: las dos empiezan igual y solo se distinguen por dentro.
 */
export function esJwtServiceRole(token: string): boolean {
  const partes = token.split('.')
  if (partes.length !== 3) return false
  try {
    const payload = Buffer.from(partes[1]!, 'base64url').toString('utf8')
    const datos: unknown = JSON.parse(payload)
    if (typeof datos !== 'object' || datos === null) return false
    const rol = (datos as { role?: unknown }).role
    return rol === 'service_role'
  } catch {
    return false
  }
}

// ── Patrones simples ────────────────────────────────────────────────────────

interface Patron {
  tipo: TipoSecreto
  re: RegExp
  detalle: string
}

const PATRONES: readonly Patron[] = [
  {
    tipo: 'anthropic_api_key',
    // sk-ant- seguido de material de clave real: se exige longitud para que un
    // ejemplo tipo `sk-ant-xxx` en documentación no dispare.
    re: /sk-ant-[A-Za-z0-9_-]{24,}/,
    detalle: 'clave de API de Anthropic (sk-ant-…)',
  },
  {
    tipo: 'private_key_pem',
    re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/,
    detalle: 'bloque PEM de clave privada',
  },
  {
    tipo: 'vapid_private_key',
    // La clave privada VAPID (P-256, 32 bytes en base64url) se detecta por el
    // nombre de la variable: el valor suelto es indistinguible de cualquier
    // otro base64 y buscarlo a ciegas sería ruido puro.
    re: /VAPID[_A-Z]*PRIVATE[_A-Z]*KEY\s*[:=]\s*['"]?[A-Za-z0-9_-]{40,}/i,
    detalle: 'clave privada VAPID de Web Push',
  },
]

/**
 * Escanea el contenido de un archivo. Devuelve hallazgos SIN el secreto.
 * Exportada para poder testearla sin tocar el sistema de archivos.
 */
export function escanearTexto(contenido: string, archivo: string): Hallazgo[] {
  const out: Hallazgo[] = []
  const lineas = contenido.split('\n')

  lineas.forEach((linea, i) => {
    const nLinea = i + 1

    JWT_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = JWT_RE.exec(linea)) !== null) {
      if (esJwtServiceRole(m[0])) {
        out.push({
          archivo,
          linea: nLinea,
          tipo: 'supabase_service_role_jwt',
          // Ni un fragmento del token: un prefijo largo ya reduce el espacio de
          // búsqueda para quien lea el log.
          detalle: 'JWT de Supabase cuyo payload declara role=service_role',
        })
      }
    }

    for (const p of PATRONES) {
      if (p.re.test(linea)) {
        out.push({ archivo, linea: nLinea, tipo: p.tipo, detalle: p.detalle })
      }
    }
  })

  // Un `.p8` versionado es la clave de firma de APNs/Sign in with Apple: el
  // hallazgo es el ARCHIVO, no una línea concreta.
  if (archivo.endsWith('.p8')) {
    out.push({
      archivo,
      linea: 0,
      tipo: 'apple_p8_key',
      detalle: 'archivo .p8 de Apple versionado en el repositorio',
    })
  }

  return out
}

// ── Árbol de trabajo ────────────────────────────────────────────────────────

function listar(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR_DIRS.has(entrada)) continue
    const completo = join(dir, entrada)
    let st
    try {
      st = statSync(completo)
    } catch {
      continue
    }
    if (st.isDirectory()) listar(completo, acc)
    else acc.push(completo)
  }
  return acc
}

export function escanearArbol(raiz: string): Hallazgo[] {
  const out: Hallazgo[] = []

  for (const archivo of listar(raiz)) {
    const rel = aPosix(relative(raiz, archivo))
    if (rel.startsWith(RUTA_PROPIA)) continue
    if (EXT_BINARIAS.test(rel) && !rel.endsWith('.p8')) continue
    if (esEnvLocalIgnorado(raiz, rel)) continue

    let contenido: string
    try {
      contenido = readFileSync(archivo, 'utf8')
    } catch {
      continue
    }
    out.push(...escanearTexto(contenido, rel))
  }

  return out
}

// ── Historial de git ────────────────────────────────────────────────────────

/**
 * Escanea el HISTORIAL, no solo el árbol de trabajo. Un secreto borrado en un
 * commit posterior sigue en el repositorio, y en cada clon que alguien hizo
 * antes del borrado.
 *
 * Es caro, así que en CI corre SOLO en el job nocturno (ver
 * `.github/workflows/seguridad.yml`), nunca en cada PR.
 */
export function escanearHistorial(raiz: string): Hallazgo[] {
  let diff: string
  try {
    diff = execFileSync('git', ['log', '--all', '-p', '--no-color', '--unified=0'], {
      cwd: raiz,
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
    })
  } catch {
    return []
  }

  const out: Hallazgo[] = []
  let commit = '(desconocido)'
  let archivo = '(desconocido)'

  for (const linea of diff.split('\n')) {
    if (linea.startsWith('commit ')) {
      commit = linea.slice(7, 19)
      continue
    }
    if (linea.startsWith('+++ b/')) {
      archivo = linea.slice(6)
      continue
    }
    // Solo las líneas AÑADIDAS: una línea borrada ya se contó cuando se añadió.
    if (!linea.startsWith('+') || linea.startsWith('+++')) continue
    if (archivo.startsWith(RUTA_PROPIA)) continue

    for (const h of escanearTexto(linea.slice(1), `${archivo} @ ${commit}`)) {
      out.push({ ...h, linea: 0 })
    }
  }

  return out
}

// ── Informe ─────────────────────────────────────────────────────────────────

export function formatearInforme(hallazgos: readonly Hallazgo[]): string {
  if (hallazgos.length === 0) {
    return '[guardSecretos] OK · ningún secreto de Darma en el ámbito escaneado.'
  }

  const lineas = hallazgos.map(
    (h) => `  ✗ ${h.archivo}${h.linea > 0 ? `:${h.linea}` : ''} · ${h.tipo} · ${h.detalle}`,
  )

  return [
    `[guardSecretos] ${hallazgos.length} secreto(s) detectado(s):`,
    '',
    ...lineas,
    '',
    'QUÉ HACER, EN ESTE ORDEN (el orden importa):',
    '  1. ROTA la clave AHORA. Está comprometida desde el momento en que se',
    '     subió: el historial se replica en cada clon y en cada fork.',
    '  2. Limpia el historial DESPUÉS (git filter-repo / BFG) y fuerza el push.',
    '  3. Revisa los logs del proveedor por si ya se usó.',
    '',
    'El secreto NO se imprime aquí a propósito: un log de CI es visible para',
    'todo el equipo. Ábrelo tú en local, en el archivo y línea indicados.',
  ].join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Uso: node --experimental-strip-types scripts/security/guardSecretos.ts [--historial]

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const conHistorial = process.argv.includes('--historial')
  const argRaiz = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1])
  const raiz = argRaiz ? resolve(argRaiz) : RAIZ_POR_DEFECTO

  const hallazgos = [...escanearArbol(raiz), ...(conHistorial ? escanearHistorial(raiz) : [])]

  console.error(formatearInforme(hallazgos))
  process.exit(hallazgos.length === 0 ? 0 : 1)
}
