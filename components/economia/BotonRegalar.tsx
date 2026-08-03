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
import { useTraductor } from '@/i18n/Proveedor'
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
  const t = useTraductor()
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
        const cuerpo = (await respuesta.json().catch(() => null)) as {
          message?: string
          mensajeClave?: string
          mensajeParams?: Record<string, string | number>
        } | null
        // La CLAVE manda sobre el mensaje: el servidor no sabe en qué idioma
        // lee quien pregunta, así que `message` viene siempre en uno solo. Se
        // conserva como respaldo porque no todos los errores traen clave, y un
        // mensaje en el idioma equivocado sigue siendo mejor que ninguno.
        setError(
          cuerpo?.mensajeClave
            ? t(cuerpo.mensajeClave, cuerpo.mensajeParams ?? {})
            : (cuerpo?.message ?? t('karma.economia.regalo.error')),
        )
        return
      }
      setEnviado(true)
    } catch {
      setError(t('karma.economia.regalo.error'))
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
        aria-label={t('karma.economia.regalo.enviarEtiqueta', { etiqueta })}
      >
        {t(enviado ? 'karma.economia.regalo.enviado' : 'karma.economia.regalo.enviar')}
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
