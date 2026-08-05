'use client'

// ============================================================================
// La hoja de cliente de la tienda de cosméticos.
//
// ── QUÉ HACE Y QUÉ NO ───────────────────────────────────────────────────────
// Manda al servidor **solo el id del cosmético**. Nunca una cantidad, nunca un
// precio: el coste lo resuelve el servidor contra el catálogo
// (`lib/billing/cosmeticos.ts`) y el cobro más la escritura de la columna
// ocurren en una transacción de Postgres (`comprar_cosmetico`, 0217_1).
//
// A diferencia de `BotonComprar`, aquí NO hay puente IAP: se paga con el saldo
// de cristales que ya está en la cuenta, así que esto funciona también en web y
// no toca StoreKit ni Play Billing.
//
// ── IDEMPOTENCIA ────────────────────────────────────────────────────────────
// El servidor es idempotente por (persona, cosmético): un doble toque devuelve
// `comprado: false` con el saldo intacto. El botón se bloquea mientras hay una
// compra en vuelo, pero eso es cortesía de UI, no la barrera: la barrera está
// en `comprar_cosmetico()`, que mira la columna ANTES de cobrar.
// ============================================================================

import { useState } from 'react'

import { Boton } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import type { IdCosmeticoComprable } from '@/lib/billing/cosmeticos'

import estilos from './economia.module.css'

export interface BotonCosmeticoProps {
  cosmeticoId: IdCosmeticoComprable
  etiqueta: string
}

export function BotonCosmetico({ cosmeticoId, etiqueta }: BotonCosmeticoProps) {
  const t = useTraductor()
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function comprar() {
    if (enCurso) return
    setEnCurso(true)
    setError(null)
    try {
      const respuesta = await fetch('/api/billing/cosmetico', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Solo el id. Mandar un coste desde aquí sería pedirle al servidor que
        // se fíe del cliente sobre cuánto vale la decoración.
        body: JSON.stringify({ cosmeticoId }),
      })

      if (!respuesta.ok) {
        setError(t('karma.economia.cosmeticos.error'))
        return
      }
      // El estado nuevo (columna y saldo) lo repinta el servidor al recargar;
      // no se toca aquí. Mismo criterio que BotonComprar.
      window.location.reload()
    } catch {
      setError(t('karma.economia.cosmeticos.error'))
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <>
      <Boton
        onClick={comprar}
        disabled={enCurso}
        cargando={enCurso}
        tamano="sm"
        bloque
        aria-label={t('karma.economia.cosmeticos.comprarEtiqueta', { etiqueta })}
      >
        {t('karma.economia.cosmeticos.comprar')}
      </Boton>
      {error ? (
        <p className={estilos.error} role="status">
          {error}
        </p>
      ) : null}
    </>
  )
}
