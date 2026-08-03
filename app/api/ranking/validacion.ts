// ============================================================================
// B06 · Validación de entrada de las tres rutas de /api/ranking.
//
// Separada de los handlers a propósito: así los casos de fallo (limite=500,
// cursor corrupto, periodo inventado) se prueban con `node --test` sin levantar
// Next ni tocar la base de datos, que es justo lo que hace que se prueben.
// ============================================================================

import { z } from 'zod'

// Rutas relativas con extensión `.ts`, no el alias `@/`: es lo que hace que
// este módulo se pueda cargar desde `node --test --experimental-strip-types`,
// que no resuelve los paths de tsconfig. Los casos de fallo de aquí (limite=500,
// cursor corrupto) son justo los que no se prueban si hay que levantar Next.
import { ErrorApi } from '../../../lib/auth/errores.ts'
import { decodificarCursor, type CursorTablero } from '../../../lib/ranking/cursor.ts'
import { esFechaIso } from '../../../lib/ranking/periodos.ts'
import { LIMITE_MAXIMO, LIMITE_POR_DEFECTO } from '../../../lib/ranking/consulta.ts'
import { PERIODOS, type PeriodoRanking } from '../../../lib/ranking/tipos.ts'

/** `z.enum` necesita una tupla no vacía; `PERIODOS` es un array de solo lectura. */
const PERIODO = z.enum(PERIODOS as unknown as [PeriodoRanking, ...PeriodoRanking[]])

const PARAMETROS_TABLERO = z.object({
  // Sin periodo, la semana. Es el corte que más se mira y el único que se
  // reinicia lo bastante a menudo como para que entrar sea posible para alguien
  // que llega hoy.
  periodo: PERIODO.default('semana'),
  // El tope está en zod Y en el `least` de la función SQL. Duplicado a
  // propósito: la validación es la buena experiencia, el `least` es la garantía.
  limite: z.coerce.number().int().min(1).max(LIMITE_MAXIMO).default(LIMITE_POR_DEFECTO),
  cursor: z.string().max(128).optional(),
})

export interface ParametrosTablero {
  periodo: PeriodoRanking
  limite: number
  cursor: CursorTablero | null
}

/**
 * @throws {ErrorApi} `entrada_invalida` (422) con un mensaje que NO dice qué
 *         campo falló ni por qué. El cliente que llega aquí o es el nuestro
 *         —y entonces es un bug nuestro— o está probando la superficie.
 */
export function parsearParametrosTablero(params: URLSearchParams): ParametrosTablero {
  const crudo = {
    periodo: params.get('periodo') ?? undefined,
    limite: params.get('limite') ?? undefined,
    cursor: params.get('cursor') ?? undefined,
  }

  const resultado = PARAMETROS_TABLERO.safeParse(crudo)
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }

  let cursor: CursorTablero | null
  try {
    cursor = decodificarCursor(resultado.data.cursor)
  } catch (causa) {
    // Un cursor corrupto es 422, no «primera página». Ver la cabecera de
    // lib/ranking/cursor.ts: en un tablero, repetir el podio en bucle mientras
    // el botón «cargar más» parece funcionar es peor que un error visible.
    throw new ErrorApi('entrada_invalida', { causa })
  }

  return { periodo: resultado.data.periodo, limite: resultado.data.limite, cursor }
}

const PARAMETROS_FILA = z.object({ periodo: PERIODO.default('semana') })

export function parsearPeriodo(params: URLSearchParams): PeriodoRanking {
  const resultado = PARAMETROS_FILA.safeParse({ periodo: params.get('periodo') ?? undefined })
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data.periodo
}

const CUERPO_SNAPSHOT = z
  .object({
    periodo: PERIODO.optional(),
    // `corte` solo existe para reconstruir a mano un corte pasado. Se valida
    // como fecha REAL (no solo con la forma YYYY-MM-DD): un 2026-02-31 pasaría
    // la expresión regular y produciría una foto vacía sin que nada lo señalara.
    corte: z.string().refine(esFechaIso, 'fecha inválida').optional(),
  })
  .strict()

export interface CuerpoSnapshot {
  periodo?: PeriodoRanking
  corte?: string
}

/**
 * El body es OPCIONAL: el cron dispara sin cuerpo. Un JSON ilegible sí es 422 —
 * si alguien se molestó en enviar algo, tiene que ser algo válido.
 */
export function parsearCuerpoSnapshot(crudo: unknown): CuerpoSnapshot {
  if (crudo == null) return {}

  const resultado = CUERPO_SNAPSHOT.safeParse(crudo)
  if (!resultado.success) {
    throw new ErrorApi('entrada_invalida', { causa: resultado.error })
  }
  return resultado.data
}
