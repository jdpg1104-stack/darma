// ============================================================================
// El informe de configuración — parte que SOLO existe en Node
//
// Vive separado de `instrumentation.ts` por una razón de empaquetado, no de
// diseño: `instrumentation.ts` se compila para los DOS runtimes, y el análisis
// estático de Turbopack ve `node:fs/promises` y avisa en cada petición aunque
// la guarda de runtime impida que llegue a ejecutarse. Un aviso que sale cien
// veces al día y que hay que ignorar entrena a la gente a ignorar los avisos,
// que es justo lo contrario de lo que pretende este módulo.
//
// Con el `fs` aquí dentro, el edge no tiene ningún motivo para mirar: alcanzar
// este archivo exige un import dinámico que solo ocurre tras comprobar
// NEXT_RUNTIME.
// ============================================================================

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import {
  detectarSombra,
  formatearInforme,
  revisarEntorno,
  verificarClaves,
  type Hallazgo,
} from './comprobacion.ts'

/**
 * Ruta de `.env.local`, resuelta EN TIEMPO DE EJECUCIÓN.
 *
 * ⚠️ NO uses `new URL('../../.env.local', import.meta.url)`. Turbopack lo trata
 * como una referencia a un módulo y trata de resolverlo AL COMPILAR; como
 * `.env.local` no se versiona, el build de CI muere con «Module not found» y en
 * local pasa desapercibido porque el archivo sí está. Lo cazó el CI, no yo.
 *
 * `process.cwd()` es la raíz del proyecto cuando corre Next, y al ser una
 * llamada no puede resolverse estáticamente.
 */
function rutaEnvLocal(): string {
  return join(process.cwd(), '.env.local')
}

/**
 * Reúne los hallazgos y devuelve el informe listo para imprimir.
 *
 * Se expone aparte de `informarDeConfiguracion()` para poder probarla sin
 * capturar la consola.
 */
export async function reunirHallazgos(
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<Hallazgo[]> {
  const hallazgos: Hallazgo[] = [...revisarEntorno(env)]

  // La sombra solo se puede ver comparando con el archivo. Si no existe
  // —Vercel, un contenedor con las variables inyectadas— no hay nada con lo que
  // comparar y tampoco puede haber sombra: silencio deliberado.
  try {
    hallazgos.push(...detectarSombra(env, await readFile(rutaEnvLocal(), 'utf8')))
  } catch {
    // Sin .env.local no hay discrepancia posible.
  }

  // La única parte con red. Se salta si ya hay bloqueantes de forma: preguntar
  // por una clave que sabemos malformada no añade nada y retrasa el arranque.
  if (!hallazgos.some((h) => h.gravedad === 'bloqueante')) {
    hallazgos.push(...(await verificarClaves(env)))
  }

  return hallazgos
}

/** Imprime el informe si hay algo que decir. No lanza nunca (ver instrumentation.ts). */
export async function informarDeConfiguracion(): Promise<void> {
  try {
    const hallazgos = await reunirHallazgos()
    const informe = formatearInforme(hallazgos)
    if (informe === '') return

    if (hallazgos.some((h) => h.gravedad === 'bloqueante')) console.error(informe)
    else console.warn(informe)
  } catch (causa) {
    // Que el diagnóstico se rompa no puede impedir que la app arranque: lo que
    // se pierde es el informe, no el servicio. Y `/ayuda` —los teléfonos de
    // crisis, sin sesión y sin base— tiene que seguir en pie pase lo que pase.
    console.warn('[darma] no se pudo comprobar la configuración:', causa instanceof Error ? causa.name : 'error')
  }
}
