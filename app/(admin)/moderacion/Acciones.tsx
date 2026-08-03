'use client'

// ============================================================================
// Las ÚNICAS piezas de cliente del panel.
//
// La hoja más pequeña posible del árbol (CONTRATOS §1): la lista entera se
// renderiza en el servidor y envía 0 bytes de JS; solo estos botones necesitan
// estado y un evento.
//
// Ningún dato sensible pasa por aquí: solo identificadores. La autorización se
// vuelve a comprobar EN EL SERVIDOR en cada ruta — que estos botones existan
// en el DOM no autoriza nada, y quien los invoque desde la consola se
// encontrará el mismo `sin_permiso` que cualquiera.
// ============================================================================

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Boton } from '@/components/ui'

type Estado = 'inicial' | 'hecho' | 'error'

async function enviar(ruta: string, cuerpo: unknown): Promise<boolean> {
  try {
    const respuesta = await fetch(ruta, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    })
    const datos: unknown = await respuesta.json()
    return (
      respuesta.ok && typeof datos === 'object' && datos !== null && (datos as { ok?: boolean }).ok === true
    )
  } catch {
    return false
  }
}

export function AccionesCrisis({ eventoId }: { eventoId: string }) {
  const [estado, setEstado] = useState<Estado>('inicial')
  const [outcome, setOutcome] = useState('')
  const [pendiente, iniciar] = useTransition()
  const router = useRouter()

  if (estado === 'hecho') return <p role="status">Atendido.</p>

  return (
    <div>
      <label htmlFor={`outcome-${eventoId}`}>Qué se hizo</label>
      <input
        id={`outcome-${eventoId}`}
        value={outcome}
        maxLength={500}
        onChange={(e) => setOutcome(e.target.value)}
        placeholder="Contactado, recursos enviados, derivado…"
      />
      <Boton
        variante="primario"
        cargando={pendiente}
        // Sin texto no se puede cerrar un evento de crisis: una fila atendida
        // sin explicación no sirve para responder ante nadie más adelante.
        disabled={outcome.trim().length === 0}
        onClick={() =>
          iniciar(async () => {
            const ok = await enviar('/api/moderation/crisis/attend', {
              eventoId,
              outcome: outcome.trim(),
            })
            setEstado(ok ? 'hecho' : 'error')
            if (ok) router.refresh()
          })
        }
      >
        Marcar atendido
      </Boton>
      {estado === 'error' && <p role="alert">No se ha podido guardar. Inténtalo otra vez.</p>}
    </div>
  )
}

export function AccionesFlag({ flagId, sujetoId }: { flagId: string; sujetoId: string | null }) {
  const [estado, setEstado] = useState<Estado>('inicial')
  const [pendiente, iniciar] = useTransition()
  const router = useRouter()

  if (estado === 'hecho') return <p role="status">Resuelto.</p>

  const resolver = (accion: 'resolved' | 'dismissed', sancionar: boolean) =>
    iniciar(async () => {
      const ok = await enviar('/api/moderation/resolve', {
        flagId,
        accion,
        sancionar,
        ...(sancionar && sujetoId ? { sujetoId } : {}),
      })
      setEstado(ok ? 'hecho' : 'error')
      if (ok) router.refresh()
    })

  return (
    <div>
      <Boton variante="secundario" cargando={pendiente} onClick={() => resolver('dismissed', false)}>
        Descartar
      </Boton>{' '}
      <Boton variante="secundario" cargando={pendiente} onClick={() => resolver('resolved', false)}>
        Confirmar sin sancionar
      </Boton>{' '}
      <Boton
        variante="peligro"
        cargando={pendiente}
        disabled={sujetoId === null}
        onClick={() => resolver('resolved', true)}
      >
        Confirmar y sancionar
      </Boton>
      {estado === 'error' && <p role="alert">No se ha podido guardar. Inténtalo otra vez.</p>}
    </div>
  )
}
