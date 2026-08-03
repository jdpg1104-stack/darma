'use client'

// ============================================================================
// BotonUtil — «me ayudó». Solo lo ve el autor del post.
//
// Que el botón solo se PINTE para el autor es comodidad, no seguridad: quien
// decide es `POST /api/comments/[id]/util`, que comprueba la autoría con una
// consulta, y por debajo `marcar_comentario_util()`, que la vuelve a comprobar
// dentro de Postgres. Un flag del cliente no autoriza nada aquí.
//
// La marca se TRASLADA: si ya había otra respuesta marcada, se le quita y se
// pone en esta. Por eso el componente avisa al padre para que actualice el
// resto de la lista sin recargar el hilo.
// ============================================================================

import { useState, useTransition } from 'react'
import { Boton } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'

export interface BotonUtilProps {
  comentarioId: string
  marcado: boolean
  /** Se llama con el id marcado para que la lista quite la marca anterior. */
  alMarcar?: (comentarioId: string) => void
}

export function BotonUtil({ comentarioId, marcado, alMarcar }: BotonUtilProps) {
  const t = useTraductor()
  const [error, setError] = useState<string | null>(null)
  const [enCurso, iniciar] = useTransition()

  if (marcado) {
    return (
      <Boton variante="secundario" tamano="sm" disabled aria-pressed>
        {t('hilo.meAyudoHecho')}
      </Boton>
    )
  }

  function marcar() {
    iniciar(async () => {
      setError(null)
      try {
        const respuesta = await fetch(`/api/comments/${comentarioId}/util`, { method: 'POST' })
        if (!respuesta.ok) throw new Error(String(respuesta.status))
        alMarcar?.(comentarioId)
      } catch {
        // Sin detalle: el mensaje del servidor ya está redactado para personas
        // y aquí no se puede saber si falló la red o el permiso.
        setError(t('hilo.utilError'))
      }
    })
  }

  return (
    <>
      <Boton variante="secundario" tamano="sm" onClick={marcar} cargando={enCurso}>
        {t('hilo.meAyudo')}
      </Boton>
      {error ? <span role="status">{error}</span> : null}
    </>
  )
}
