// ============================================================================
// Catálogo de cristales — los SKU viven AQUÍ y solo aquí
//
// ── POR QUÉ IAP (Apple / Google) Y NO STRIPE ────────────────────────────────
// Darma se distribuye como app móvil, y los cristales son un bien digital que
// se consume DENTRO de la app. La regla 3.1.1 de la App Store y la política de
// pagos de Google Play obligan a venderlos con la compra integrada de la
// plataforma. Cobrar con Stripe por cristales no es "más barato": es motivo de
// retirada de la ficha, y una app retirada no atiende a nadie.
//
// Cuatro implicaciones que el producto tiene que asumir, no negociar:
//
//  1. **Comisión del 30 %** (15 % en el Small Business Program y en
//     suscripciones tras 12 meses). El precio que ve la persona ya la incluye:
//     de un paquete de 4,99 € llegan ~3,49 €. Ese número aparece aquí como
//     `COMISION_TIENDA` y es DOCUMENTAL — no se usa para cobrar nada.
//  2. **El precio no lo fijamos en euros libres.** Se elige un *tier* de precio
//     de la plataforma y cada tienda lo localiza (impuestos, redondeos y
//     divisa incluidos). Por eso este catálogo guarda el `sku` y la cantidad de
//     CRISTALES, y **nunca un importe en dinero**: cualquier cálculo de euros a
//     partir de un precio escrito a mano estaría mal en la mayoría de países.
//     `precioReferencia` existe solo para pintar un orden de magnitud en la
//     tienda y va marcado como tal.
//  3. **No hay webhook con un importe fiable del lado del cliente.** La fuente
//     de verdad es la verificación servidor-a-servidor (`apple.ts`,
//     `google.ts`). El cliente manda un token; el servidor decide qué vale.
//  4. **Un usuario web no puede comprar cristales.** Si algún día existe la web,
//     la tienda degrada a "solo disponible en la app" — nunca a un checkout
//     alternativo, que es exactamente lo que las dos plataformas prohíben.
//
// ── LA REGLA DE SEGURIDAD DE ESTE ARCHIVO ───────────────────────────────────
// **El cliente manda un identificador de producto; el SERVIDOR resuelve la
// cantidad contra este catálogo.** Aceptar `amount`, `crystals` o `price` del
// body es la forma más rápida de imprimir moneda que existe en una app de este
// tipo. `resolverPaquete()` es la única función que convierte una cadena de
// fuera en una cantidad, y solo devuelve algo si la cadena está en la tabla.
//
// 🔴 LÍNEA ROJA: aquí no hay ningún paquete que dé karma, ni reputación, ni
// prioridad. Los cristales son una moneda separada (`profiles.crystals`,
// `crystal_ledger`) para que la conversión no sea siquiera expresable.
// ============================================================================

/** Los cuatro paquetes. Es un tipo unión: un SKU inventado no compila. */
export type SkuCristales = 'crystals_100' | 'crystals_550' | 'crystals_1200' | 'crystals_3000'

export interface PaqueteCristales {
  sku: SkuCristales
  /** Cristales que se acreditan. Lo decide el servidor, nunca el cliente. */
  crystals: number
  /** Identificador del producto en App Store Connect. */
  skuApple: string
  /** Identificador del producto en Google Play Console. */
  skuGoogle: string
  /**
   * CLAVE del catálogo i18n, no el nombre. El nombre del paquete es un dato de
   * este módulo pero se LEE en una pantalla, y esa pantalla puede estar en
   * inglés: guardar aquí «Bolsa de cristales» metería una frase en español en
   * una tienda ya traducida. Mismo trato que `KARMA_WEIGHTS[kind].description`
   * → `karma.tipos.<kind>`. La resuelve la vista con su locale.
   */
  claveEtiqueta: string
  /**
   * Orden de magnitud en euros, SOLO para ordenar la tienda y dar contexto.
   * El precio real lo localiza cada tienda a partir de su tier: nunca se cobra
   * ni se contabiliza a partir de este número (ver implicación 2).
   */
  precioReferencia: string
}

export const CATALOGO: Readonly<Record<SkuCristales, PaqueteCristales>> = {
  crystals_100: {
    sku: 'crystals_100',
    crystals: 100,
    skuApple: 'app.darma.crystals.100',
    skuGoogle: 'app_darma_crystals_100',
    claveEtiqueta: 'karma.economia.paquetes.crystals_100',
    precioReferencia: '~1,09 €',
  },
  crystals_550: {
    sku: 'crystals_550',
    crystals: 550,
    skuApple: 'app.darma.crystals.550',
    skuGoogle: 'app_darma_crystals_550',
    claveEtiqueta: 'karma.economia.paquetes.crystals_550',
    precioReferencia: '~4,99 €',
  },
  crystals_1200: {
    sku: 'crystals_1200',
    crystals: 1200,
    skuApple: 'app.darma.crystals.1200',
    skuGoogle: 'app_darma_crystals_1200',
    claveEtiqueta: 'karma.economia.paquetes.crystals_1200',
    precioReferencia: '~9,99 €',
  },
  crystals_3000: {
    sku: 'crystals_3000',
    crystals: 3000,
    skuApple: 'app.darma.crystals.3000',
    skuGoogle: 'app_darma_crystals_3000',
    claveEtiqueta: 'karma.economia.paquetes.crystals_3000',
    precioReferencia: '~24,99 €',
  },
} as const

/**
 * Comisión de la tienda, en tanto por uno. **DOCUMENTAL: no se usa para
 * cobrar.** Está aquí para que quien lea el catálogo sepa qué parte del precio
 * no llega a Darma, y para poder explicarlo en el panel de B19. La comisión de
 * los REGALOS es otra cosa distinta y vive en `regalos.ts`.
 */
export const COMISION_TIENDA = 0.30

/** Lista ordenada de menor a mayor, que es como se pinta la tienda. */
export const PAQUETES: readonly PaqueteCristales[] = [
  CATALOGO.crystals_100,
  CATALOGO.crystals_550,
  CATALOGO.crystals_1200,
  CATALOGO.crystals_3000,
] as const

/** ¿Es esta cadena uno de nuestros SKU? Guarda de tipo, no una comprobación suelta. */
export function esSkuCristales(valor: unknown): valor is SkuCristales {
  return typeof valor === 'string' && Object.prototype.hasOwnProperty.call(CATALOGO, valor)
}

/**
 * La ÚNICA conversión de "algo que viene de fuera" a "cantidad de cristales".
 *
 * Acepta el sku interno o el identificador de producto de cualquiera de las dos
 * tiendas, porque eso es lo que devuelve un recibo verificado. Devuelve `null`
 * ante cualquier cosa desconocida: fail-closed, el valor por defecto seguro es
 * "no dar cristales".
 */
export function resolverPaquete(identificador: string | null | undefined): PaqueteCristales | null {
  if (!identificador) return null
  if (esSkuCristales(identificador)) return CATALOGO[identificador]

  for (const paquete of PAQUETES) {
    if (paquete.skuApple === identificador) return paquete
    if (paquete.skuGoogle === identificador) return paquete
  }
  return null
}
