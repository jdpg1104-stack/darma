// ============================================================================
// Guard de hidratación · ni `loading.tsx` ni `<Suspense>` en app/** ni
// components/**
//
// app/SIN-LOADING.md documenta el fallo: el layout raíz es asíncrono (espera a
// `resolverLocale()` para poner el `lang`), y con CUALQUIER límite de Suspense
// por debajo —un `loading.tsx`, que es su azúcar sintáctico, o un `<Suspense>`
// escrito a mano— React nunca completa el intercambio del fallback y LA
// HIDRATACIÓN NO ARRANCA. La página se pinta, parece correcta, y ningún botón
// hace nada.
//
// Ha pasado DOS VECES. Primero fueron ocho `loading.tsx`; en la limpieza
// sobrevivieron dos `<Suspense>` manuales que dejaron el feed sin enseñar un
// solo post y el hilo sin poder responder. Ni tsc, ni el lint, ni las 1.233
// pruebas lo vieron, porque cada pieza es correcta por separado: el fallo solo
// existe al hidratar en un navegador de verdad. Las dos veces se encontró
// recorriendo la app a mano. Este guard convierte ese recorrido en un test que
// corre con la suite.
//
// QUÉ BUSCA, y por qué exactamente así:
//   · Archivos llamados `loading.{tsx,ts,jsx,js}` bajo app/** y components/**.
//     Por NOMBRE, no por contenido: para Next el nombre YA ES el límite de
//     Suspense, da igual lo que haya dentro.
//   · La cadena `<Suspense` (también cualificada: `<React.Suspense`) FUERA de
//     comentarios. Lo de «fuera de comentarios» no es un refinamiento: las
//     advertencias que hoy dicen «⛔ NO ENVUELVAS ESTO EN <Suspense>» viven en
//     comentarios de los propios archivos vigilados, y un guard que gritara por
//     la advertencia obligaría a borrar la advertencia.
//
// El día que el layout raíz deje de suspender (los dos caminos están en
// app/SIN-LOADING.md), se retira este guard EN EL MISMO CAMBIO. Hasta entonces,
// rojo aquí significa «la app entera se queda muda al hidratar».
// ============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Un límite de Suspense encontrado donde no puede haber ninguno. */
export interface HallazgoSinLoading {
  /** Ruta relativa a la raíz, con `/`. */
  archivo: string
  /** `archivo-loading`: el nombre del archivo es la infracción. `suspense`: la cadena en el código. */
  tipo: 'archivo-loading' | 'suspense'
  /** Línea (base 1) del `<Suspense`; `0` cuando la infracción es el archivo entero. */
  linea: number
}

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_POR_DEFECTO = join(AQUI, '..', '..')

/** Los dos árboles vigilados. `lib/` no renderiza JSX y no entra. */
const DIRS_VIGILADOS = ['app', 'components'] as const

const EXTENSIONES = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts'] as const

/** Los nombres que Next reconoce como archivo de carga del segmento. */
const NOMBRES_LOADING = new Set(['loading.tsx', 'loading.ts', 'loading.jsx', 'loading.js'])

/**
 * `<Suspense` o `<React.Suspense`. Sin `\s*` tras el `<` a propósito: JSX no
 * admite espacio ahí, y permitirlo convertiría la comparación `x < Suspense`
 * (un identificador cualquiera) en un falso positivo.
 */
const SUSPENSE_RE = /<(?:[A-Za-z_$][\w$]*\.)?Suspense\b/

const IGNORAR = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage'])

/**
 * Los tests colocados NO se escanean. No es una concesión: un `*.test.ts` no
 * forma parte de ningún bundle, así que un `<Suspense` ahí no puede matar la
 * hidratación — y los tests hablan de él legítimamente (el de `app/offline`
 * afirma con un regex `/<Suspense/` exactamente lo que este guard prohíbe).
 * Marcarlos obligaría a borrar esas afirmaciones: falsos positivos, y un guard
 * que grita en falso acaba desactivado.
 */
const ARCHIVO_DE_TEST_RE = /\.(?:test|spec)\.[cm]?[jt]sx?$/

// ── Utilidades ──────────────────────────────────────────────────────────────

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

/** ¿El NOMBRE del archivo es un `loading.*` de los que Next convierte en Suspense? */
export function esNombreLoading(nombre: string): boolean {
  return NOMBRES_LOADING.has(nombre.toLowerCase())
}

/**
 * Sustituye el interior de los comentarios —los de línea y los de bloque, que
 * incluyen los de JSX entre llaves— por espacios, PRESERVANDO los saltos de
 * línea para que los números de línea del informe sean los del archivo real.
 *
 * Es consciente de las cadenas: un `//` dentro de `'https://…'` no abre
 * comentario, y una comilla dentro de un comentario no abre cadena. Dos
 * aproximaciones asumidas y documentadas:
 *   · una comilla suelta en texto JSX («l'exemple») desalinearía el estado,
 *     así que las cadenas `'…'` y `"…"` se cierran también al fin de línea
 *     (en JavaScript no pueden abarcar dos líneas de todos modos);
 *   · dentro de una plantilla `` `…` `` no se rastrean las interpolaciones,
 *     de modo que un comentario DENTRO de un `${…}` no se elimina. Un
 *     `<Suspense` real ahí seguiría detectándose, que es el lado seguro.
 */
export function quitarComentarios(fuente: string): string {
  type Estado = 'codigo' | 'comentarioLinea' | 'comentarioBloque' | 'simple' | 'doble' | 'plantilla'
  let estado: Estado = 'codigo'
  const out: string[] = []

  for (let i = 0; i < fuente.length; i++) {
    const c = fuente[i]!
    const sig = fuente[i + 1]

    switch (estado) {
      case 'codigo':
        if (c === '/' && sig === '/') {
          estado = 'comentarioLinea'
          out.push('  ')
          i++
        } else if (c === '/' && sig === '*') {
          estado = 'comentarioBloque'
          out.push('  ')
          i++
        } else {
          if (c === "'") estado = 'simple'
          else if (c === '"') estado = 'doble'
          else if (c === '`') estado = 'plantilla'
          out.push(c)
        }
        break

      case 'comentarioLinea':
        if (c === '\n') {
          estado = 'codigo'
          out.push('\n')
        } else {
          out.push(' ')
        }
        break

      case 'comentarioBloque':
        if (c === '*' && sig === '/') {
          estado = 'codigo'
          out.push('  ')
          i++
        } else {
          out.push(c === '\n' ? '\n' : ' ')
        }
        break

      case 'simple':
      case 'doble':
      case 'plantilla':
        out.push(c)
        if (c === '\\' && sig !== undefined) {
          out.push(sig)
          i++
        } else if (
          (estado === 'simple' && (c === "'" || c === '\n')) ||
          (estado === 'doble' && (c === '"' || c === '\n')) ||
          (estado === 'plantilla' && c === '`')
        ) {
          estado = 'codigo'
        }
        break
    }
  }

  return out.join('')
}

/** Líneas (base 1) donde aparece `<Suspense` fuera de comentarios. */
export function buscarSuspense(fuente: string): number[] {
  const out: number[] = []
  quitarComentarios(fuente)
    .split('\n')
    .forEach((linea, i) => {
      if (SUSPENSE_RE.test(linea)) out.push(i + 1)
    })
  return out
}

// ── Recorrido ───────────────────────────────────────────────────────────────

/** Recorre app/** y components/** y devuelve TODAS las infracciones. */
export function detectarSinLoading(raiz: string): HallazgoSinLoading[] {
  const out: HallazgoSinLoading[] = []

  for (const dir of DIRS_VIGILADOS) {
    for (const archivo of listarArchivos(join(raiz, dir))) {
      if (ARCHIVO_DE_TEST_RE.test(basename(archivo))) continue

      const rel = aPosix(relative(raiz, archivo))

      if (esNombreLoading(basename(archivo))) {
        out.push({ archivo: rel, tipo: 'archivo-loading', linea: 0 })
        continue // el archivo entero ya es la infracción; su contenido da igual
      }

      let fuente: string
      try {
        fuente = readFileSync(archivo, 'utf8')
      } catch {
        continue
      }
      for (const linea of buscarSuspense(fuente)) {
        out.push({ archivo: rel, tipo: 'suspense', linea })
      }
    }
  }

  return out
}

// ── Informe ─────────────────────────────────────────────────────────────────

export function formatearInforme(hallazgos: readonly HallazgoSinLoading[]): string {
  if (hallazgos.length === 0) {
    return '[guardSinLoading] OK · ni loading.tsx ni <Suspense> bajo app/** ni components/**.'
  }

  const bloques: string[] = [
    `[guardSinLoading] ${hallazgos.length} hallazgo(s) que MATAN LA HIDRATACIÓN:`,
    '',
  ]

  for (const h of hallazgos) {
    if (h.tipo === 'archivo-loading') {
      bloques.push(`  ✗ ${h.archivo} · archivo loading.* (Next lo convierte en un límite de Suspense)`)
    } else {
      bloques.push(`  ✗ ${h.archivo}:${h.linea} · <Suspense> fuera de comentarios`)
    }
  }

  bloques.push(
    '',
    'Lee app/SIN-LOADING.md ANTES de tocar nada. El layout raíz es asíncrono y',
    'cualquier límite de Suspense por debajo deja la app pintada pero muerta:',
    'la hidratación no arranca y ningún componente de cliente cobra vida. Ya',
    'ocurrió dos veces y ningún otro check lo ve.',
    '',
    'Cómo arreglarlo: elimina el loading.tsx o el <Suspense> — el contenido se',
    'renderiza en el servidor sin esqueleto, que es el estado soportado. Si de',
    'verdad necesitas un esqueleto, primero hay que quitar el await del layout',
    'raíz (los dos caminos posibles están en app/SIN-LOADING.md) y retirar este',
    'guard en el mismo cambio.',
  )

  return bloques.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raiz = process.argv[2] ? resolve(process.argv[2]) : RAIZ_POR_DEFECTO
  const hallazgos = detectarSinLoading(raiz)
  console.error(formatearInforme(hallazgos))
  process.exit(hallazgos.length === 0 ? 0 : 1)
}
