// ============================================================================
// Cosméticos de perfil — decoración, y solo decoración
//
// ── 🔴 LA REGLA QUE DEFINE ESTE CATÁLOGO ────────────────────────────────────
// Ningún cosmético puede parecerse a un nivel de karma (`semilla`, `brote`,
// `guia`, `mentor`) ni a la insignia de mentor. **Comprar algo que aparenta
// reputación es comprar reputación**, aunque la columna `karma_reputation` no
// se toque: quien lo ve por fuera no sabe distinguir, y esa confusión es
// exactamente el producto que no queremos vender.
//
// Por eso:
//  · Los nombres son de naturaleza y de luz, no de jerarquía ni de progresión.
//  · Ninguna paleta reutiliza `COLOR_POR_NIVEL` de `components/ui/tokens.ts`.
//  · No hay marcos con forma de insignia, ni corona, ni "verificado", ni nada
//    circular alrededor del avatar que un ojo pueda leer como rango.
//  · `prohibidoPorqueImitaNivel()` es una comprobación real con un test detrás,
//    no un comentario: el día que alguien añada `marco_mentor` al catálogo, el
//    test se rompe.
//
// ── ESTADO ──────────────────────────────────────────────────────────────────
// El catálogo existe y la validación también, pero **la propiedad de un
// cosmético todavía no se persiste**: haría falta una columna en `profiles`
// (`cosmetic_frame`, `cosmetic_palette`) y `profiles` es de los cimientos, no
// de este bloque. Está anotado en `HANDOFF/PEDIDOS.md`. Hasta entonces, la
// tienda los muestra como "próximamente" y no hay ruta de compra: es preferible
// a inventar un almacenamiento paralelo que luego haya que migrar.
// ============================================================================

import type { KarmaLevel } from '../karma.ts'

export type CategoriaCosmetico = 'marco' | 'paleta' | 'tema'

export interface Cosmetico {
  id: string
  categoria: CategoriaCosmetico
  etiqueta: string
  /** Coste en cristales. Nunca en karma: el karma no se gasta en decoración. */
  costeCristales: number
  descripcion: string
}

/** Los cuatro nombres de nivel. Ningún cosmético puede evocarlos. */
const NIVELES: readonly KarmaLevel[] = ['semilla', 'brote', 'guia', 'mentor'] as const

/** Palabras que un cosmético no puede llevar en el id ni en la etiqueta. */
const PALABRAS_PROHIBIDAS: readonly string[] = [
  ...NIVELES,
  'guía',
  'mentora',
  'insignia',
  'verificado',
  'rango',
  'nivel',
  'corona',
  'estrella dorada',
] as const

export const CATALOGO_COSMETICOS: readonly Cosmetico[] = [
  {
    id: 'marco_niebla',
    categoria: 'marco',
    etiqueta: 'Niebla',
    costeCristales: 120,
    descripcion: 'Un halo difuso alrededor de tu avatar.',
  },
  {
    id: 'marco_marea',
    categoria: 'marco',
    etiqueta: 'Marea',
    costeCristales: 120,
    descripcion: 'Un borde que se ondula despacio.',
  },
  {
    id: 'paleta_amanecer',
    categoria: 'paleta',
    etiqueta: 'Amanecer',
    costeCristales: 200,
    descripcion: 'Tonos cálidos para tu perfil.',
  },
  {
    id: 'paleta_musgo',
    categoria: 'paleta',
    etiqueta: 'Musgo',
    costeCristales: 200,
    descripcion: 'Verdes apagados, poca luz.',
  },
  {
    id: 'tema_nocturno_profundo',
    categoria: 'tema',
    etiqueta: 'Nocturno profundo',
    costeCristales: 350,
    descripcion: 'Un modo oscuro más oscuro todavía.',
  },
] as const

/**
 * ¿Este cosmético imita un nivel de karma o la insignia de mentor?
 *
 * Se comprueba sobre el id Y sobre la etiqueta porque los dos son visibles: el
 * id acaba en la url del recurso y la etiqueta en la pantalla. Es una función
 * y no una revisión de código porque las revisiones se saltan y los tests no.
 */
export function prohibidoPorqueImitaNivel(cosmetico: Pick<Cosmetico, 'id' | 'etiqueta'>): boolean {
  const texto = `${cosmetico.id} ${cosmetico.etiqueta}`.toLowerCase()
  return PALABRAS_PROHIBIDAS.some((palabra) => texto.includes(palabra))
}

/** El catálogo, filtrado por la regla. Es lo que consume la UI. */
export function cosmeticosPublicables(): readonly Cosmetico[] {
  return CATALOGO_COSMETICOS.filter((c) => !prohibidoPorqueImitaNivel(c))
}
