// ============================================================================
// Guard de tipos generados · `lib/supabase/database.types.ts` sin diff
//
// CONTRATOS.md §3: «El tipado de Supabase se genera, no se escribe a mano».
// Eso solo es cierto si algo lo comprueba. Este guard regenera los tipos contra
// una Supabase local con las migraciones aplicadas y compara con el archivo
// versionado. Si difieren, el CI falla con EL COMANDO EXACTO de regeneración.
//
// Qué problema resuelve de verdad: una migración nueva que entra sin sus tipos.
// A partir de ese momento el compilador deja de proteger a los doce bloques que
// consumen `Database`, y lo hace EN SILENCIO — el código sigue compilando
// porque el tipo viejo sigue siendo válido, solo que ya no describe la base.
// Eso es peor que un error: es una mentira que compila.
// ============================================================================

import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ_POR_DEFECTO = join(AQUI, '..', '..')

export const RUTA_TIPOS = 'lib/supabase/database.types.ts'

/** El comando que hay que ejecutar. Se imprime tal cual en el fallo. */
export const COMANDO_REGENERAR = `npx supabase gen types typescript --local > ${RUTA_TIPOS}`

export interface ResultadoTipos {
  ok: boolean
  /** Mensaje listo para stdout, con el comando exacto cuando hay que actuar. */
  mensaje: string
  /** Primeras líneas que difieren, para orientar sin volcar el archivo entero. */
  primerasDiferencias: string[]
}

/**
 * Normaliza antes de comparar.
 *
 * Solo se ignoran finales de línea y espacios en blanco al final: en Windows el
 * archivo se guarda con CRLF y el CLI genera LF, y esa diferencia no significa
 * nada. NO se ignoran los comentarios de cabecera a propósito — si alguien edita
 * la cabecera del archivo generado, queremos enterarnos.
 */
export function normalizar(contenido: string): string {
  return contenido.replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').trimEnd()
}

/** Compara el archivo versionado con lo que produciría el generador. */
export function compararTipos(actual: string, generado: string): ResultadoTipos {
  const a = normalizar(actual).split('\n')
  const b = normalizar(generado).split('\n')

  if (a.length === b.length && a.every((l, i) => l === b[i])) {
    return { ok: true, mensaje: `[guardTipos] OK · ${RUTA_TIPOS} está sincronizado con las migraciones.`, primerasDiferencias: [] }
  }

  const diffs: string[] = []
  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max && diffs.length < 10; i++) {
    if (a[i] !== b[i]) {
      diffs.push(`  línea ${i + 1}:`)
      diffs.push(`    en el repo:  ${a[i] ?? '(no existe)'}`)
      diffs.push(`    regenerado:  ${b[i] ?? '(no existe)'}`)
    }
  }

  return {
    ok: false,
    primerasDiferencias: diffs,
    mensaje: [
      `[guardTipos] ${RUTA_TIPOS} NO coincide con el esquema de las migraciones.`,
      '',
      ...diffs,
      '',
      'Cómo arreglarlo — ejecuta EXACTAMENTE esto y commitea el resultado:',
      '',
      `    supabase start`,
      `    supabase db reset`,
      `    ${COMANDO_REGENERAR}`,
      '',
      'No edites el archivo a mano: es generado y el siguiente CI lo revierte.',
      'Si acabas de añadir una migración, este fallo es el sistema funcionando:',
      'los tipos van EN EL MISMO commit que el cambio de esquema.',
    ].join('\n'),
  }
}

/** Ejecuta el generador contra la Supabase local. Lanza si el CLI falla. */
export function generarTipos(raiz: string): string {
  return execFileSync('npx', ['supabase', 'gen', 'types', 'typescript', '--local'], {
    cwd: raiz,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** Camino completo: genera y compara contra el archivo del repositorio. */
export function comprobarRepositorio(raiz: string = RAIZ_POR_DEFECTO): ResultadoTipos {
  const ruta = join(raiz, RUTA_TIPOS)

  if (!existsSync(ruta)) {
    return {
      ok: false,
      primerasDiferencias: [],
      mensaje: [
        `[guardTipos] falta ${RUTA_TIPOS}.`,
        '',
        'Doce bloques lo consumen (CONTRATOS.md §3). Genéralo con:',
        '',
        `    ${COMANDO_REGENERAR}`,
      ].join('\n'),
    }
  }

  let generado: string
  try {
    generado = generarTipos(raiz)
  } catch (e) {
    return {
      ok: false,
      primerasDiferencias: [],
      mensaje: [
        '[guardTipos] no se pudo generar los tipos.',
        `  ${(e as Error).message.split('\n')[0]}`,
        '',
        '¿Está la Supabase local levantada? `supabase start` y `supabase db reset`.',
        'Sin base de datos este guard no puede afirmar nada, así que falla en vez',
        'de dar por bueno lo que no ha comprobado.',
      ].join('\n'),
    }
  }

  return compararTipos(readFileSync(ruta, 'utf8'), generado)
}

// ── CLI ─────────────────────────────────────────────────────────────────────

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const raiz = process.argv[2] ? resolve(process.argv[2]) : RAIZ_POR_DEFECTO
  const r = comprobarRepositorio(raiz)
  console.error(r.mensaje)
  process.exit(r.ok ? 0 : 1)
}
