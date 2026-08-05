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
//    test se rompe. Desde que las etiquetas son claves de catálogo, el guard de
//    `cosmeticos.test.ts` comprueba además el TEXTO que sale de LOS DOS idiomas
//    (aviso de PEDIDOS: un «Mentor Crown» solo en inglés no se vería mirando la
//    clave ni el español).
//
// ── ESTADO ──────────────────────────────────────────────────────────────────
// La propiedad SÍ se persiste desde `0220_1_b12_cosmeticos.sql`:
// `profiles.cosmetic_frame` y `profiles.cosmetic_palette` (NULL = ninguno),
// con la lista cerrada de este catálogo como CHECK — el espejo TS ≡ SQL lo
// vigila `cosmeticos.test.ts` leyendo el .sql, como `sincronia.test.ts` hace
// con 0121. La compra pasa por `comprar_cosmetico()` (solo `service_role`),
// que cobra con `spend_crystals()` y escribe la columna en la MISMA
// transacción: el cliente no puede escribirse cosméticos sin pagar, porque las
// columnas quedan fuera de su `grant update`.
//
// La categoría `tema` no tiene columna todavía (decisión de producto pendiente,
// anotada en PEDIDOS): la tienda la enseña como «próximamente» y
// `comprarCosmetico()` la rechaza antes de tocar la red.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { ErrorApi } from '../auth/errores.ts'
import type { KarmaLevel } from '../karma.ts'
import type { Limite } from './limites.ts'

export type CategoriaCosmetico = 'marco' | 'paleta' | 'tema'

/** Las categorías que HOY tienen columna en `profiles` y por tanto compra. */
export const CATEGORIAS_COMPRABLES = ['marco', 'paleta'] as const

export type CategoriaComprable = (typeof CATEGORIAS_COMPRABLES)[number]

export interface Cosmetico {
  id: string
  categoria: CategoriaCosmetico
  /**
   * Nombre de referencia en español. Sigue siendo un campo y no solo una clave
   * porque es la entrada histórica del guard anti-imitación (`lineaRoja.test.ts`
   * lo recorre); `cosmeticos.test.ts` comprueba que coincide letra a letra con
   * el texto de `es.json` para que no puedan divergir.
   */
  etiqueta: string
  /** Clave de `messages/*.json` con el nombre visible. La resuelve la vista. */
  claveEtiqueta: string
  /** Clave de `messages/*.json` con la descripción. La resuelve la vista. */
  claveDescripcion: string
  /** Coste en cristales. Nunca en karma: el karma no se gasta en decoración. */
  costeCristales: number
}

/** Los cuatro nombres de nivel. Ningún cosmético puede evocarlos. */
const NIVELES: readonly KarmaLevel[] = ['semilla', 'brote', 'guia', 'mentor'] as const

/**
 * Palabras que un cosmético no puede llevar en el id ni en ningún texto
 * visible. En los DOS idiomas: desde que las etiquetas se traducen, un nombre
 * limpio en español puede imitar un nivel solo en inglés («Seed», «Guide»…).
 */
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
  // Inglés: los niveles como los nombra `en.json` (Seed, Sprout, Guide, Mentor
  // — este último ya está arriba) y las mismas señales de rango.
  'seed',
  'sprout',
  'guide',
  'badge',
  'verified',
  'rank',
  'level',
  'crown',
  'golden star',
] as const

export const CATALOGO_COSMETICOS: readonly Cosmetico[] = [
  {
    id: 'marco_niebla',
    categoria: 'marco',
    etiqueta: 'Niebla',
    claveEtiqueta: 'karma.economia.cosmeticos.marco_niebla.etiqueta',
    claveDescripcion: 'karma.economia.cosmeticos.marco_niebla.descripcion',
    costeCristales: 120,
  },
  {
    id: 'marco_marea',
    categoria: 'marco',
    etiqueta: 'Marea',
    claveEtiqueta: 'karma.economia.cosmeticos.marco_marea.etiqueta',
    claveDescripcion: 'karma.economia.cosmeticos.marco_marea.descripcion',
    costeCristales: 120,
  },
  {
    id: 'paleta_amanecer',
    categoria: 'paleta',
    etiqueta: 'Amanecer',
    claveEtiqueta: 'karma.economia.cosmeticos.paleta_amanecer.etiqueta',
    claveDescripcion: 'karma.economia.cosmeticos.paleta_amanecer.descripcion',
    costeCristales: 200,
  },
  {
    id: 'paleta_musgo',
    categoria: 'paleta',
    etiqueta: 'Musgo',
    claveEtiqueta: 'karma.economia.cosmeticos.paleta_musgo.etiqueta',
    claveDescripcion: 'karma.economia.cosmeticos.paleta_musgo.descripcion',
    costeCristales: 200,
  },
  {
    id: 'tema_nocturno_profundo',
    categoria: 'tema',
    etiqueta: 'Nocturno profundo',
    claveEtiqueta: 'karma.economia.cosmeticos.tema_nocturno_profundo.etiqueta',
    claveDescripcion: 'karma.economia.cosmeticos.tema_nocturno_profundo.descripcion',
    costeCristales: 350,
  },
] as const

/**
 * Los ids comprables como TUPLA, no derivados: de ella salen a la vez el tipo
 * (`IdCosmeticoComprable`) y el `z.enum` de la ruta, igual que `MEDIOS_PAGO` en
 * `boosts.ts`. `cosmeticos.test.ts` comprueba que la tupla ≡ el catálogo ≡ los
 * CHECK del SQL, así que no puede quedarse vieja en silencio.
 */
export const IDS_MARCOS = ['marco_niebla', 'marco_marea'] as const
export const IDS_PALETAS = ['paleta_amanecer', 'paleta_musgo'] as const
export const IDS_COSMETICOS_COMPRABLES = [...IDS_MARCOS, ...IDS_PALETAS] as const

export type IdCosmeticoComprable = (typeof IDS_COSMETICOS_COMPRABLES)[number]

export function esIdCosmeticoComprable(valor: unknown): valor is IdCosmeticoComprable {
  return typeof valor === 'string' && (IDS_COSMETICOS_COMPRABLES as readonly string[]).includes(valor)
}

/**
 * Límite de peticiones de la ruta de compra. Vive aquí y no en `limites.ts`
 * SOLO por propiedad de archivos de esta ola (anotado en PEDIDOS para moverlo):
 * mismo criterio que sus vecinos — calibrado sobre uso humano, y la ruta pasa
 * `failClosed: true` porque es una ruta de dinero. Cuatro cosméticos comprables
 * hacen que 10/h sea ya varias veces la sesión de compras más entusiasta.
 */
export const LIMITE_PETICION_COSMETICO: Limite = { limite: 10, ventanaSegundos: 3600 }

/**
 * ¿Este cosmético imita un nivel de karma o la insignia de mentor?
 *
 * Se comprueba sobre el id Y sobre todo texto visible, porque todos se ven: el
 * id acaba en la url del recurso y los textos en la pantalla. Es una función y
 * no una revisión de código porque las revisiones se saltan y los tests no.
 *
 * @param textosVisibles los textos RESUELTOS de los catálogos (etiqueta y
 *        descripción en cada idioma). El guard de `cosmeticos.test.ts` los pasa
 *        para los dos locales; quien solo tiene el dato del catálogo puede
 *        llamar sin ellos y comprueba id + etiqueta de referencia.
 */
export function prohibidoPorqueImitaNivel(
  cosmetico: Pick<Cosmetico, 'id' | 'etiqueta'>,
  textosVisibles: readonly string[] = [],
): boolean {
  const texto = [cosmetico.id, cosmetico.etiqueta, ...textosVisibles].join(' ').toLowerCase()
  return PALABRAS_PROHIBIDAS.some((palabra) => texto.includes(palabra))
}

/** El catálogo, filtrado por la regla. Es lo que consume la UI. */
export function cosmeticosPublicables(): readonly Cosmetico[] {
  return CATALOGO_COSMETICOS.filter((c) => !prohibidoPorqueImitaNivel(c))
}

/** ¿Tiene columna en `profiles` y por tanto compra? El tema todavía no. */
export function esCategoriaComprable(categoria: CategoriaCosmetico): categoria is CategoriaComprable {
  return (CATEGORIAS_COMPRABLES as readonly string[]).includes(categoria)
}

export interface ResultadoCompraCosmetico {
  /**
   * `true` si esta llamada cobró y escribió; `false` si la persona YA llevaba
   * ese cosmético (reintento de un doble toque) y no se cobró nada.
   */
  comprado: boolean
  /** Saldo de cristales tras la operación. */
  saldo: number
  cosmeticoId: IdCosmeticoComprable
  categoria: CategoriaComprable
}

/**
 * Compra un cosmético. Cobro y escritura en la misma transacción de
 * `comprar_cosmetico()` (0217_1).
 *
 * @param supabase cliente **admin**: la función está concedida solo a
 *                 `service_role` y las columnas cosméticas están fuera del
 *                 `grant update` de `authenticated`. Es deliberado: si el
 *                 cliente RLS pudiera escribirlas, se pondría el cosmético sin
 *                 pagar.
 *
 * El coste NUNCA viene del cliente: se resuelve aquí contra el catálogo a
 * partir del id, igual que `enviarRegalo` resuelve el reparto.
 */
export async function comprarCosmetico(
  supabase: SupabaseClient,
  args: { userId: string; cosmeticoId: IdCosmeticoComprable },
): Promise<ResultadoCompraCosmetico> {
  const cosmetico = CATALOGO_COSMETICOS.find((c) => c.id === args.cosmeticoId)

  if (
    cosmetico === undefined ||
    !esCategoriaComprable(cosmetico.categoria) ||
    prohibidoPorqueImitaNivel(cosmetico)
  ) {
    // Antes de tocar la red: un id fuera del catálogo, un tema (sin columna
    // todavía) o algo que imite un nivel no llegan ni a Postgres. El CHECK de
    // 0217_1 lo pararía igual — y revertiría el cobro con él — pero rechazarlo
    // aquí devuelve un 422 explicable en vez de un error de motor.
    throw new ErrorApi('entrada_invalida', {
      causa: new Error(`cosmético no comprable: ${args.cosmeticoId}`),
    })
  }

  const { data, error } = await supabase.rpc('comprar_cosmetico', {
    p_user: args.userId,
    p_cosmetico: cosmetico.id,
    p_coste: cosmetico.costeCristales,
  })

  if (error) throw errorDeCosmetico(error)

  const fila = (Array.isArray(data) ? data[0] : data) as
    | { comprado: boolean; saldo: number }
    | undefined

  if (!fila) throw new ErrorApi('error_interno', { causa: new Error('comprar_cosmetico sin filas') })

  return {
    comprado: fila.comprado === true,
    saldo: Number(fila.saldo ?? 0),
    cosmeticoId: args.cosmeticoId,
    categoria: cosmetico.categoria,
  }
}

/** SQLSTATE propio → código público. El mensaje de Postgres no sale de aquí. */
export function errorDeCosmetico(causa: unknown): ErrorApi {
  const sqlstate =
    typeof causa === 'object' && causa !== null && 'code' in causa
      ? String((causa as { code?: unknown }).code ?? '')
      : ''

  switch (sqlstate) {
    case 'DA001':
      return new ErrorApi('saldo_insuficiente', { causa })
    case 'DA002':
      return new ErrorApi('no_encontrado', { causa })
    case 'DA006':
      return new ErrorApi('entrada_invalida', { causa })
    case '23514':
      // El CHECK de la lista cerrada, desde el propio motor. La transacción
      // entera se revirtió, cobro incluido: no se perdió dinero.
      return new ErrorApi('entrada_invalida', { causa })
    default:
      return new ErrorApi('error_interno', { causa })
  }
}
