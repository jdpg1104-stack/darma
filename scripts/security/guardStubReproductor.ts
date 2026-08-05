// ============================================================================
// Guard del stub e2e del reproductor · lib/video/stubE2E.ts
//
// El stub sustituye al widget de youtube-nocookie SOLO en la suite E2E (el
// widget no emite eventos en headless; sin ellos el recorrido (f) no existe).
// Ese "solo" descansa en un fusible de dos cerrojos —bandera de build +
// hostname local— y en que la superficie del stub no crezca. Este guard
// convierte esas tres condiciones en un test que corre con la suite:
//
//  1. La bandera `NEXT_PUBLIC_E2E_STUB_PLAYER` solo puede nombrarse en el
//     módulo del fusible. Un segundo lector de la bandera es un segundo
//     comportamiento condicionado a "estamos en e2e", y esa clase crece sola.
//  2. El módulo del stub solo puede importarse desde TarjetaVideo. El día que
//     lo importe algo más, la revisión debe ser deliberada, no un grep tardío.
//  3. Los DOS cerrojos del fusible tienen que seguir escritos, literalmente:
//     la comparación de la bandera y la lista de hostnames locales. Borrar o
//     "relajar" cualquiera de los dos pone esto en rojo.
//
// El árbol vigilado es el que llega a un bundle: app/, components/ y lib/.
// e2e/, scripts/ y playwright.config.ts quedan fuera — ahí la bandera y el
// stub son exactamente lo que debe existir.
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface HallazgoStub {
  /** Ruta relativa a la raíz, con `/`. */
  archivo: string
  motivo:
    | 'bandera-fuera-del-fusible'
    | 'import-fuera-de-tarjeta'
    | 'cerrojo-de-bandera-ausente'
    | 'cerrojo-de-hostname-ausente'
  detalle: string
}

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_POR_DEFECTO = join(AQUI, '..', '..')

export const BANDERA = 'NEXT_PUBLIC_E2E_STUB_PLAYER'
export const MODULO_FUSIBLE = 'lib/video/stubE2E.ts'
export const IMPORTADOR_PERMITIDO = 'components/video/TarjetaVideo.tsx'

/** Los árboles que acaban en un bundle. */
const DIRS_VIGILADOS = ['app', 'components', 'lib'] as const

const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'] as const
const IGNORAR = new Set(['node_modules', '.next', '.git', '.claude', 'out', 'build', 'coverage'])

/** Los tests colocados no forman parte de ningún bundle y hablan del stub
 *  legítimamente (este guard incluido). */
const ARCHIVO_DE_TEST_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

/** Cualquier forma de nombrar el módulo del stub en un import o un require.
 *  Por el NOMBRE del módulo y no por su ruta completa: un re-export vecino
 *  (`from './stubE2E.ts'` dentro de lib/video) no lleva `video/` delante. */
const IMPORT_STUB_RE = /from\s+['"][^'"]*\bstubE2E(?:\.ts)?['"]|require\(\s*['"][^'"]*\bstubE2E/

// ── Los cerrojos, tal y como deben seguir escritos ──────────────────────────

/** Cerrojo 1: la bandera se compara inlinada, con el nombre completo. */
const CERROJO_BANDERA_RE = /process\.env\.NEXT_PUBLIC_E2E_STUB_PLAYER\s*===\s*'1'/

/** Cerrojo 2: la lista cerrada de hostnames locales, comparación exacta. */
const CERROJO_HOSTNAME_RE =
  /hostname\s*===\s*'localhost'[\s\S]{0,120}hostname\s*===\s*'127\.0\.0\.1'/

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
 * Escanea UN archivo (por ruta relativa y contenido). Exportada para poder
 * probar cada regla sin tocar el sistema de archivos.
 */
export function escanearContenido(rel: string, contenido: string): HallazgoStub[] {
  const out: HallazgoStub[] = []

  if (rel === MODULO_FUSIBLE) {
    if (!CERROJO_BANDERA_RE.test(contenido)) {
      out.push({
        archivo: rel,
        motivo: 'cerrojo-de-bandera-ausente',
        detalle:
          `El fusible ya no compara process.env.${BANDERA} === '1'. Sin ese literal ` +
          'Next no inlina la bandera y el cerrojo de build desaparece.',
      })
    }
    if (!CERROJO_HOSTNAME_RE.test(contenido)) {
      out.push({
        archivo: rel,
        motivo: 'cerrojo-de-hostname-ausente',
        detalle:
          'El fusible ya no exige un hostname local exacto (localhost / 127.0.0.1). ' +
          'Ese cerrojo es lo que mantiene el stub apagado aunque la bandera llegue a producción.',
      })
    }
    return out
  }

  if (contenido.includes(BANDERA)) {
    out.push({
      archivo: rel,
      motivo: 'bandera-fuera-del-fusible',
      detalle: `La bandera ${BANDERA} solo puede leerse en ${MODULO_FUSIBLE}.`,
    })
  }

  if (IMPORT_STUB_RE.test(contenido) && rel !== IMPORTADOR_PERMITIDO) {
    out.push({
      archivo: rel,
      motivo: 'import-fuera-de-tarjeta',
      detalle: `El stub solo puede importarlo ${IMPORTADOR_PERMITIDO}.`,
    })
  }

  return out
}

export function escanearArbol(raiz: string): HallazgoStub[] {
  const out: HallazgoStub[] = []

  for (const dir of DIRS_VIGILADOS) {
    for (const archivo of listarArchivos(join(raiz, dir))) {
      const rel = aPosix(relative(raiz, archivo))
      if (ARCHIVO_DE_TEST_RE.test(rel)) continue

      let contenido: string
      try {
        contenido = readFileSync(archivo, 'utf8')
      } catch {
        continue
      }
      out.push(...escanearContenido(rel, contenido))
    }
  }

  return out
}

export function formatearInforme(hallazgos: readonly HallazgoStub[]): string {
  if (hallazgos.length === 0) {
    return '[guardStubReproductor] OK · el fusible del stub e2e sigue intacto y contenido.'
  }

  return [
    `[guardStubReproductor] ${hallazgos.length} infracción(es):`,
    '',
    ...hallazgos.map((h) => `  ✗ ${h.archivo} · ${h.motivo} · ${h.detalle}`),
    '',
    'El stub del reproductor existe SOLO para la suite E2E. Si necesitas',
    'condicionar algo más a "estamos en e2e", no reutilices esta bandera:',
    'trae el caso a revisión (ver lib/video/stubE2E.ts, cabecera).',
  ].join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Uso: node --experimental-strip-types scripts/security/guardStubReproductor.ts [raiz]

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const argRaiz = process.argv[2]
  const raiz = argRaiz ? resolve(argRaiz) : RAIZ_POR_DEFECTO

  const hallazgos = escanearArbol(raiz)
  console.error(formatearInforme(hallazgos))
  process.exit(hallazgos.length === 0 ? 0 : 1)
}
