// ============================================================================
// B19 · Mapa de precios de los paquetes de cristales — STUB LOCAL
//
// ⚠️ ESTO NO ES LA FUENTE DE VERDAD Y NO DEBE SERLO NUNCA.
//
// `crystal_ledger` guarda el DELTA de cristales, no el precio. Para calcular
// ingreso y ARPPU hay dos caminos:
//
//   1. El `raw_receipt` jsonb de la compra, cuando trae `price_cents`. Ese es
//      el dato REAL: lo que Apple o Google cobraron de verdad, con su moneda y
//      sus impuestos ya aplicados. El rollup lo suma aparte
//      (`ingreso_centimos_recibo`).
//   2. Cuando no hay recibo —compras antiguas, entornos de prueba, un webhook
//      que llegó sin cuerpo—, se ESTIMA con este mapa.
//
// Por eso `Economia.ingresoEstimado` existe y la UI lo dice en voz alta: un
// número de ingreso que no distingue lo medido de lo supuesto es un número que
// alguien acabará metiendo en una previsión.
//
// PEDIDO ABIERTO A B12 (anotado en HANDOFF/PEDIDOS.md): exponer el catálogo
// real desde `lib/billing/`. En cuanto exista, este archivo se reduce a un
// re-export y estas cifras desaparecen.
//
// La clave es el TAMAÑO DEL PAQUETE (número de cristales), no un nombre
// comercial: los nombres los cambia marketing y romperían la serie histórica
// de `admin_metrics_daily`, que ya está escrita en disco.
// ============================================================================

/** Céntimos de euro por paquete, indexado por cristales del paquete. */
export const PRECIOS_PAQUETE_CENTIMOS: Readonly<Record<number, number>> = {
  100: 199,
  550: 999,
  1200: 1999,
  3000: 4999,
} as const

/** ¿Está activo el stub? Mientras lo esté, la UI marca el ingreso como estimado. */
export const PRECIOS_SON_ESTIMADOS = true

/**
 * Céntimos estimados de un paquete. `0` si no está en el catálogo: preferimos
 * subestimar el ingreso antes que inventar una cifra por interpolación. Un
 * ingreso que se queda corto se investiga; uno inflado se celebra.
 */
export function precioEstimadoCentimos(cristalesDelPaquete: number): number {
  return PRECIOS_PAQUETE_CENTIMOS[cristalesDelPaquete] ?? 0
}

/**
 * Suma en céntimos de un mapa `{ tamañoDePaquete: número de compras }`, tal
 * como lo guarda el rollup en `paquetes_sin_recibo`.
 */
export function estimarIngresoCentimos(paquetes: Readonly<Record<string, number>>): number {
  let total = 0
  for (const [tamano, compras] of Object.entries(paquetes)) {
    const cristales = Number(tamano)
    const n = Number(compras)
    if (!Number.isFinite(cristales) || !Number.isFinite(n) || n <= 0) continue
    total += precioEstimadoCentimos(cristales) * Math.trunc(n)
  }
  return total
}
