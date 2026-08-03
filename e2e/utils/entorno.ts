import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Carga `.env.local` en `process.env` para el proceso de Playwright.
 *
 * Next lo hace solo para el servidor, pero el proceso de pruebas es otro
 * proceso: sin esto, `NEXT_PUBLIC_SUPABASE_URL` es `undefined` y el fusible
 * anti-producción cortaría por el motivo equivocado.
 *
 * No se sobrescribe nada que ya venga del entorno real: en CI mandan los
 * secretos del runner, no un archivo del disco.
 */
export function cargarEnvLocal(raiz = process.cwd()): void {
  let contenido: string
  try {
    contenido = readFileSync(resolve(raiz, '.env.local'), 'utf8')
  } catch {
    return
  }

  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim()
    if (!limpia || limpia.startsWith('#') || !limpia.includes('=')) continue
    const i = limpia.indexOf('=')
    const clave = limpia.slice(0, i).trim()
    const valor = limpia.slice(i + 1).trim().replace(/^["']|["']$/g, '')
    if (!clave || process.env[clave] != null) continue
    if (valor === '') continue
    process.env[clave] = valor
  }
}
