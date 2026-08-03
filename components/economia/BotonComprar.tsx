'use client'

// ============================================================================
// El único componente `'use client'` de la tienda.
//
// ── QUÉ HACE Y QUÉ NO ───────────────────────────────────────────────────────
// Lanza la compra nativa (StoreKit / Play Billing) a través del puente que
// expone la app contenedora, y manda al servidor **solo el identificador de la
// transacción**. Nunca una cantidad, nunca un precio. La cantidad la resuelve
// el servidor contra el catálogo a partir del `productId` que devuelve la
// TIENDA (ver `app/api/billing/verify/route.ts`).
//
// ── EL PUENTE NATIVO NO EXISTE TODAVÍA ──────────────────────────────────────
// `window.darmaIAP` lo inyectará el contenedor móvil. Mientras no exista, el
// botón se deshabilita y lo dice: es preferible un botón honesto y apagado a
// uno que abre un checkout web, que es exactamente lo que Apple y Google
// prohíben. Anotado en `HANDOFF/PEDIDOS.md`.
//
// ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
// El servidor es idempotente por `external_id`, así que un doble toque aquí no
// puede cobrar dos veces. El botón se bloquea igualmente mientras hay una
// compra en vuelo, pero eso es cortesía de UI, no la barrera: la barrera está
// en `uq_crystal_ledger_external`.
// ============================================================================

import { useState } from 'react'

import { Boton } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import type { SkuCristales } from '@/lib/billing/catalogo'

import estilos from './economia.module.css'

/** Puente que inyecta la app contenedora. `undefined` en web. */
interface PuenteIAP {
  comprar(sku: string): Promise<{ plataforma: 'apple' | 'google'; token: string } | null>
}

declare global {
  interface Window {
    darmaIAP?: PuenteIAP
  }
}

export interface BotonComprarProps {
  sku: SkuCristales
  etiqueta: string
  disponible: boolean
}

export function BotonComprar({ sku, etiqueta, disponible }: BotonComprarProps) {
  const t = useTraductor()
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const puente = typeof window === 'undefined' ? undefined : window.darmaIAP
  const puedeComprar = disponible && puente !== undefined

  async function comprar() {
    if (!puente || enCurso) return
    setEnCurso(true)
    setError(null)
    try {
      const compra = await puente.comprar(sku)
      if (!compra) {
        // Cancelar una compra no es un error: no se dice nada.
        return
      }

      const respuesta = await fetch('/api/billing/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Solo plataforma y token. Mandar `crystals` desde aquí sería pedirle
        // al servidor que se fíe del cliente sobre cuánto dinero ha entrado.
        body: JSON.stringify({ plataforma: compra.plataforma, token: compra.token }),
      })

      if (!respuesta.ok) {
        setError(t('karma.economia.tienda.error'))
        return
      }
      // El saldo lo repinta el servidor al revalidar; no se toca aquí.
      window.location.reload()
    } catch {
      setError(t('karma.economia.tienda.errorReintento'))
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <>
      <Boton
        onClick={comprar}
        disabled={!puedeComprar}
        cargando={enCurso}
        tamano="sm"
        bloque
        aria-label={t('karma.economia.tienda.comprarEtiqueta', { etiqueta })}
      >
        {t(puedeComprar ? 'karma.economia.tienda.comprar' : 'karma.economia.tienda.soloApp')}
      </Boton>
      {error ? (
        <p className={estilos.error} role="status">
          {error}
        </p>
      ) : null}
    </>
  )
}
