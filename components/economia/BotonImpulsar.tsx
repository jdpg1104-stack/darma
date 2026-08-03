'use client'

// ============================================================================
// El botón que dispara el impulso. Hoja `'use client'` más pequeña posible.
//
// Manda `postId`, el medio elegido y una clave de idempotencia. **No manda
// ningún importe**: el coste lo decide el servidor.
//
// La clave de idempotencia se genera UNA VEZ por montaje, no por clic: si se
// generara por clic, un doble toque produciría dos claves distintas y dos
// cobros. Ese es exactamente el bug que la clave existe para evitar.
// ============================================================================

import { useRef, useState } from 'react'

import { Boton } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import type { MedioPagoBoost } from '@/lib/billing/boosts'

import estilos from './economia.module.css'

export interface BotonImpulsarProps {
  postId: string
  medio: MedioPagoBoost
  etiqueta: string
}

export function BotonImpulsar({ postId, medio, etiqueta }: BotonImpulsarProps) {
  const t = useTraductor()
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // `useRef` y no `useState`: la clave no debe cambiar entre renders ni
  // provocar uno. Es la misma para todos los clics de este montaje, que es lo
  // que hace que el segundo toque devuelva el MISMO boost.
  const idempotencia = useRef<string>(crearClave())

  async function impulsar() {
    if (enCurso) return
    setEnCurso(true)
    setError(null)
    try {
      const respuesta = await fetch('/api/billing/boost', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId, medioPreferido: medio, idempotencia: idempotencia.current }),
      })

      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => null)) as {
          message?: string
          mensajeClave?: string
          mensajeParams?: Record<string, string | number>
        } | null
        // El mensaje viene ya redactado del servidor (lib/auth/errores.ts); no
        // se construye aquí ni se enseña nada del proveedor.
        // La CLAVE manda sobre el mensaje: el servidor no sabe en qué idioma
        // lee quien pregunta, así que `message` viene siempre en uno solo. Se
        // conserva como respaldo porque no todos los errores traen clave, y un
        // mensaje en el idioma equivocado sigue siendo mejor que ninguno.
        setError(
          cuerpo?.mensajeClave
            ? t(cuerpo.mensajeClave, cuerpo.mensajeParams ?? {})
            : (cuerpo?.message ?? t('karma.economia.boost.error')),
        )
        return
      }
      window.location.reload()
    } catch {
      setError(t('karma.economia.boost.error'))
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <>
      <Boton
        onClick={impulsar}
        cargando={enCurso}
        tamano="sm"
        aria-label={t('karma.economia.boost.impulsarEtiqueta', { etiqueta })}
      >
        {t('karma.economia.boost.impulsar')}
      </Boton>
      {error ? (
        <p className={estilos.error} role="status">
          {error}
        </p>
      ) : null}
    </>
  )
}

/**
 * `crypto.randomUUID` existe en todos los navegadores que soporta Next 16, pero
 * no en un contexto inseguro (http en una IP local). El respaldo no necesita
 * ser criptográfico: la clave solo tiene que ser única DENTRO de esta persona
 * —el índice único es `(user_id, idempotency_key)`— y una colisión entre dos
 * personas no significa nada.
 */
function crearClave(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
