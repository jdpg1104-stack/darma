'use client'

// ============================================================================
// El botón que envía el regalo. Manda el TIPO, nunca el precio.
//
// Misma decisión que en `BotonImpulsar`: la clave de idempotencia se genera una
// vez por montaje, no por clic, para que un doble toque devuelva el mismo
// regalo en vez de cobrar dos veces.
// ============================================================================

import { useRef, useState } from 'react'

import { Boton } from '@/components/ui'
import type { ReferenciaRegalo, TipoRegalo } from '@/lib/billing/regalos'

import estilos from './economia.module.css'

export interface BotonRegalarProps {
  recipientId: string
  giftKind: TipoRegalo
  etiqueta: string
  refType?: ReferenciaRegalo
  refId?: string
}

export function BotonRegalar({ recipientId, giftKind, etiqueta, refType, refId }: BotonRegalarProps) {
  const [enCurso, setEnCurso] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [enviado, setEnviado] = useState(false)
  const idempotencia = useRef<string>(crearClave())

  async function regalar() {
    if (enCurso || enviado) return
    setEnCurso(true)
    setError(null)
    try {
      const respuesta = await fetch('/api/billing/gift', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipientId,
          giftKind,
          ...(refType ? { refType } : {}),
          ...(refId ? { refId } : {}),
          idempotencia: idempotencia.current,
        }),
      })

      if (!respuesta.ok) {
        const cuerpo = (await respuesta.json().catch(() => null)) as { message?: string } | null
        setError(cuerpo?.message ?? 'No hemos podido enviarlo ahora mismo.')
        return
      }
      setEnviado(true)
    } catch {
      setError('No hemos podido enviarlo ahora mismo.')
    } finally {
      setEnCurso(false)
    }
  }

  return (
    <>
      <Boton
        onClick={regalar}
        cargando={enCurso}
        disabled={enviado}
        tamano="sm"
        bloque
        aria-label={`Enviar ${etiqueta}`}
      >
        {enviado ? 'Enviado' : 'Enviar'}
      </Boton>
      {error ? (
        <p className={estilos.error} role="status">
          {error}
        </p>
      ) : null}
    </>
  )
}

function crearClave(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
