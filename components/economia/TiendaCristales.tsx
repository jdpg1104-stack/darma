// ============================================================================
// Tienda de cristales. Server Component con UN solo hijo `'use client'`.
//
// ── EL PRESUPUESTO ──────────────────────────────────────────────────────────
// CONTRATOS §11 da 120 KB de JS por ruta. La tienda es una rejilla de tarjetas
// con texto: no necesita un byte de JavaScript. Lo único que sí lo necesita es
// el acto de comprar (`BotonComprar`), y por eso es un componente aparte y la
// hoja más pequeña posible del árbol.
//
// ── DEGRADACIÓN, NO CHECKOUT ALTERNATIVO ────────────────────────────────────
// Si IAP no está disponible (web, o entorno sin configurar), la tienda dice
// «solo en la app» y **no ofrece otra forma de pagar**. Cobrar bienes digitales
// fuera de la compra integrada es motivo de retirada de la ficha en las dos
// plataformas (ver lib/billing/catalogo.ts).
//
// ── LA FRASE VA ARRIBA ──────────────────────────────────────────────────────
// Antes de los precios, no debajo del botón. Una promesa que se lee después de
// pagar no es una promesa.
// ============================================================================

import { Tarjeta } from '@/components/ui'
import type { PaqueteCristales } from '@/lib/billing/catalogo'
import { EXPLICACION_CRISTALES, TIENDA_SOLO_EN_LA_APP } from '@/lib/billing/textos'

import { BotonComprar } from './BotonComprar'
import { FraseLineaRoja } from './FraseLineaRoja'
import { SaldoCristales } from './SaldoCristales'
import estilos from './economia.module.css'

export interface TiendaCristalesProps {
  paquetes: readonly PaqueteCristales[]
  cristales: number
  karmaSpendable: number
  /** `false` en web o si Apple/Google no están configurados. */
  disponible: boolean
}

export function TiendaCristales({ paquetes, cristales, karmaSpendable, disponible }: TiendaCristalesProps) {
  return (
    <Tarjeta className={estilos.tienda}>
      <h2>Cristales</h2>
      <SaldoCristales cristales={cristales} karmaSpendable={karmaSpendable} />

      <FraseLineaRoja explicacion={disponible ? EXPLICACION_CRISTALES : TIENDA_SOLO_EN_LA_APP} />

      <ul className={estilos.paquetes}>
        {paquetes.map((paquete) => (
          <li key={paquete.sku} className={estilos.paquete}>
            <span className={estilos.cantidad}>{paquete.crystals}</span>
            <span className={estilos.etiqueta}>{paquete.etiqueta}</span>
            {/* Orden de magnitud, no precio: cada tienda localiza el suyo a
                partir del tier. Se dice con el «aprox.» delante para que nadie
                lo lea como el importe que va a pagar. */}
            <span className={estilos.referencia}>aprox. {paquete.precioReferencia}</span>
            <BotonComprar sku={paquete.sku} etiqueta={paquete.etiqueta} disponible={disponible} />
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}
