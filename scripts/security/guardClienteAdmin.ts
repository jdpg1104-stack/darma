// ============================================================================
// Guard de fuga del cliente admin · `'use client'` × `lib/supabase/admin`
//
// `lib/supabase/admin.ts` construye un cliente con la service_role key, que
// SALTA TODAS LAS POLÍTICAS RLS — incluida la ausencia deliberada de políticas
// sobre `identity_vault`, la única tabla que vincula un alias con una persona
// real. Si esa clave acaba en un bundle de navegador, cualquiera con las
// devtools abiertas des-anonimiza a gente que escribió sobre su salud mental
// creyéndose anónima. No es un bug de permisos: es el peor fallo posible de
// esta aplicación.
//
// POR QUÉ EL GRAFO TIENE QUE SER TRANSITIVO. Un guard que mire solo los imports
// directos no sirve para nada, porque la fuga real nunca es directa:
//
//     Componente('use client') → utils/formato → helpers/perfil → supabase/admin
//
// Nadie escribe `import { createAdminClient }` en un componente cliente: eso lo
// caza la revisión de código a la primera. Lo que pasa de verdad es que alguien
// añade una función de conveniencia a un módulo compartido que ya se importaba
// desde cliente. Por eso aquí se resuelve la cadena completa y se reporta
// ENTERA: sin la cadena, el hallazgo no es accionable.
//
// La guarda de runtime de `lib/supabase/admin.ts` (el `typeof window`) es la
// última red. Ésta es la que lo detecta ANTES de desplegar.
// ============================================================================

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Una cadena de imports que lleva de un componente cliente al cliente admin. */
export interface FugaAdmin {
  /** El archivo que lleva `'use client'`. Ruta relativa a la raíz, con `/`. */
  archivoCliente: string
  /** Ruta completa de imports hasta `lib/supabase/admin` (incluidos los extremos). */
  cadena: string[]
}

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_POR_DEFECTO = join(AQUI, '..', '..')

/** Directorios donde puede vivir un componente cliente. */
const DIRS_CLIENTE = ['app', 'components'] as const

/** Extensiones que se resuelven al seguir un import sin extensión. */
const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'] as const

/** Los dos destinos prohibidos. */
const MODULO_ADMIN = 'lib/supabase/admin'
const SECRETO = 'SUPABASE_SERVICE_ROLE_KEY'

const IGNORAR = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage'])

// ── Utilidades de sistema de archivos ───────────────────────────────────────

function aPosix(p: string): string {
  return p.split(sep).join('/')
}

function listarArchivos(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc
  for (const entrada of readdirSync(dir)) {
    if (IGNORAR.has(entrada)) continue
    const completo = join(dir, entrada)
    const st = statSync(completo)
    if (st.isDirectory()) listarArchivos(completo, acc)
    else if (EXTENSIONES.some((e) => entrada.endsWith(e))) acc.push(completo)
  }
  return acc
}

/**
 * Resuelve un especificador de import a una ruta absoluta de archivo.
 * Devuelve `null` para paquetes de node_modules (no son nuestro problema: la
 * service_role key no vive en una dependencia).
 */
export function resolverImport(especificador: string, desde: string, raiz: string): string | null {
  let base: string

  if (especificador.startsWith('@/')) {
    base = join(raiz, especificador.slice(2))
  } else if (especificador.startsWith('.')) {
    base = resolve(dirname(desde), especificador)
  } else {
    return null // paquete externo
  }

  // Import con extensión explícita (el repo usa `.ts` en los imports de tests).
  if (EXTENSIONES.some((e) => base.endsWith(e)) && existsSync(base)) return base

  // Un import a `./x` puede apuntar a `./x.ts` o a `./x/index.ts`.
  for (const ext of EXTENSIONES) {
    const candidato = base + ext
    if (existsSync(candidato)) return candidato
  }
  for (const ext of EXTENSIONES) {
    const candidato = join(base, 'index' + ext)
    if (existsSync(candidato)) return candidato
  }

  // `@/lib/supabase/admin.ts` escrito con extensión pero el archivo no existe:
  // se devuelve la ruta igualmente para que la cadena sea legible en el informe.
  return existsSync(base) ? base : null
}

const IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)/g

/** Especificadores importados por un archivo (estáticos, dinámicos y require). */
export function extraerImports(fuente: string): string[] {
  const out: string[] = []
  IMPORT_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = IMPORT_RE.exec(fuente)) !== null) {
    const esp = m[1] ?? m[2] ?? m[3]
    if (esp) out.push(esp)
  }
  return out
}

/** ¿El archivo declara `'use client'` en su cabecera? */
export function esComponenteCliente(fuente: string): boolean {
  // Solo cuenta como directiva si está antes de cualquier sentencia real; se
  // aproxima mirando las primeras líneas no vacías y no comentadas.
  const lineas = fuente.split('\n')
  for (const cruda of lineas) {
    const linea = cruda.trim()
    if (linea === '' || linea.startsWith('//') || linea.startsWith('/*') || linea.startsWith('*')) continue
    return /^['"]use client['"]\s*;?$/.test(linea)
  }
  return false
}

// ── Recorrido del grafo ─────────────────────────────────────────────────────

interface Contexto {
  raiz: string
  /** Memo: archivo → cadena hasta el admin (relativa al archivo), o null. */
  memo: Map<string, string[] | null>
  /** Archivos en la pila actual, para cortar ciclos de imports. */
  enCurso: Set<string>
}

/**
 * ¿Este archivo alcanza `lib/supabase/admin` (o menciona la service_role key)?
 * Devuelve la cadena de rutas relativas, o `null`.
 *
 * MEMOIZA POR ARCHIVO. Sin esto, en un repo con doce bloques activos el
 * recorrido es exponencial y el guard tarda minutos, que es como decir que
 * nadie lo va a ejecutar.
 */
function alcanzaAdmin(archivo: string, ctx: Contexto): string[] | null {
  const memo = ctx.memo.get(archivo)
  if (memo !== undefined) return memo

  // Ciclo de imports: no es una fuga por sí mismo. Se devuelve null SIN
  // memoizar, para que el resultado real se calcule por el otro camino.
  if (ctx.enCurso.has(archivo)) return null

  const rel = aPosix(relative(ctx.raiz, archivo))

  // Caso base: es el propio módulo admin.
  if (rel === `${MODULO_ADMIN}.ts` || rel === `${MODULO_ADMIN}.tsx` || rel.startsWith(`${MODULO_ADMIN}/`)) {
    const cadena = [rel]
    ctx.memo.set(archivo, cadena)
    return cadena
  }

  let fuente: string
  try {
    fuente = readFileSync(archivo, 'utf8')
  } catch {
    ctx.memo.set(archivo, null)
    return null
  }

  // Caso base 2: el archivo lee la service_role key directamente, sin pasar por
  // lib/supabase/admin.ts. Un `createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY)`
  // escrito a mano filtra exactamente igual y se salta la guarda de runtime.
  if (fuente.includes(SECRETO)) {
    const cadena = [rel]
    ctx.memo.set(archivo, cadena)
    return cadena
  }

  ctx.enCurso.add(archivo)
  let resultado: string[] | null = null

  for (const esp of extraerImports(fuente)) {
    const destino = resolverImport(esp, archivo, ctx.raiz)
    if (!destino) continue
    const sub = alcanzaAdmin(destino, ctx)
    if (sub) {
      resultado = [rel, ...sub]
      break
    }
  }

  ctx.enCurso.delete(archivo)
  ctx.memo.set(archivo, resultado)
  return resultado
}

/**
 * Busca cadenas `'use client'` → … → `lib/supabase/admin` bajo `app/**` y
 * `components/**`.
 */
export function detectarFugasAdmin(raiz: string): FugaAdmin[] {
  const ctx: Contexto = { raiz, memo: new Map(), enCurso: new Set() }
  const fugas: FugaAdmin[] = []

  for (const dir of DIRS_CLIENTE) {
    for (const archivo of listarArchivos(join(raiz, dir))) {
      let fuente: string
      try {
        fuente = readFileSync(archivo, 'utf8')
      } catch {
        continue
      }
      if (!esComponenteCliente(fuente)) continue

      const cadena = alcanzaAdmin(archivo, ctx)
      if (cadena && cadena.length > 0) {
        fugas.push({ archivoCliente: aPosix(relative(raiz, archivo)), cadena })
      }
    }
  }

  return fugas
}

// ── NEXT_PUBLIC_ × service_role ─────────────────────────────────────────────

/** Un secreto expuesto por llevar (o asignarse a) un nombre `NEXT_PUBLIC_*`. */
export interface FugaPublica {
  archivo: string
  linea: number
  detalle: string
}

/**
 * Busca `SUPABASE_SERVICE_ROLE_KEY` bajo cualquier `NEXT_PUBLIC_`. El prefijo
 * `NEXT_PUBLIC_` es exactamente lo que hace que Next inline el valor en el
 * bundle de cliente: una sola línea así anula todo lo demás.
 *
 * `.env.example` se salta a propósito: ahí el nombre aparece dentro del aviso
 * que explica por qué NO debe prefijarse.
 */
export function detectarNextPublicServiceRole(raiz: string): FugaPublica[] {
  const out: FugaPublica[] = []
  const objetivos = [
    ...listarArchivos(join(raiz, 'app')),
    ...listarArchivos(join(raiz, 'components')),
    ...listarArchivos(join(raiz, 'lib')),
    ...listarArchivos(join(raiz, 'scripts')),
  ]

  for (const archivo of objetivos) {
    let fuente: string
    try {
      fuente = readFileSync(archivo, 'utf8')
    } catch {
      continue
    }

    fuente.split('\n').forEach((linea, i) => {
      // El patrón peligroso es el nombre de variable, no la mención: se exige
      // `NEXT_PUBLIC_` inmediatamente pegado a un identificador que contenga
      // SERVICE_ROLE.
      if (/NEXT_PUBLIC_[A-Z0-9_]*SERVICE_ROLE/.test(linea)) {
        out.push({
          archivo: aPosix(relative(raiz, archivo)),
          linea: i + 1,
          detalle: 'variable de entorno con SERVICE_ROLE bajo el prefijo NEXT_PUBLIC_',
        })
      }
    })
  }

  return out
}

// ── Informe ─────────────────────────────────────────────────────────────────

export function formatearInforme(fugas: readonly FugaAdmin[], publicas: readonly FugaPublica[] = []): string {
  if (fugas.length === 0 && publicas.length === 0) {
    return '[guardClienteAdmin] OK · ningún componente cliente alcanza lib/supabase/admin.'
  }

  const bloques: string[] = [
    `[guardClienteAdmin] ${fugas.length + publicas.length} hallazgo(s) de SEGURIDAD CRÍTICA:`,
    '',
  ]

  for (const f of fugas) {
    bloques.push(`  ✗ ${f.archivoCliente} ('use client') alcanza el cliente admin:`)
    bloques.push(`      ${f.cadena.join('\n        → ')}`)
    bloques.push('')
  }

  for (const p of publicas) {
    bloques.push(`  ✗ ${p.archivo}:${p.linea} · ${p.detalle}`)
    bloques.push('')
  }

  bloques.push(
    'Cómo arreglarlo: mueve el uso del cliente admin a un Route Handler o a una',
    'Server Action y corta la cadena en el eslabón compartido. Si un módulo lo',
    'necesitan cliente y servidor, pártelo en dos: la parte que toca admin no',
    'puede quedar en un archivo que el bundle de cliente pueda alcanzar.',
    '',
    'Recuerda: la service_role key salta RLS y ve identity_vault. Si esta cadena',
    'llegó a desplegarse, ROTA LA CLAVE PRIMERO y arregla el código después.',
  )

  return bloques.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raiz = process.argv[2] ? resolve(process.argv[2]) : RAIZ_POR_DEFECTO
  const fugas = detectarFugasAdmin(raiz)
  const publicas = detectarNextPublicServiceRole(raiz)
  console.error(formatearInforme(fugas, publicas))
  process.exit(fugas.length === 0 && publicas.length === 0 ? 0 : 1)
}
