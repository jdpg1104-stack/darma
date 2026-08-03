'use client'

// ============================================================================
// B10 · Bloquear o silenciar
//
// Las dos opciones NO son lo mismo y la pantalla tiene que decirlo, porque
// elegir mal aquí tiene consecuencias reales:
//
// · BLOQUEAR corta la relación en los dos sentidos. Los refugios que
//   compartíais dejan de existir para ambos —`refuge_has_block()` entra en el
//   USING de las políticas—, y eso incluye el historial.
// · SILENCIAR solo te oculta a ti. La otra persona no nota nada, y eso es
//   justamente lo que hace seguro silenciar a alguien agresivo: no le das
//   ninguna señal a la que reaccionar.
//
// Lo que esta pantalla NO hace es «ocultar en la interfaz». El bloqueo se
// escribe en `blocks` y lo aplica el motor; si viviera aquí, un `curl` a
// PostgREST con la anon key lo saltaría, que es exactamente lo que hace quien
// de verdad quiere alcanzar a alguien.
// ============================================================================

import { useState } from 'react'

import { Boton, Dialogo } from '@/components/ui'
import { bloquear } from './api'
import estilos from './refugio.module.css'

export interface MenuBloquearProps {
  userId: string
  alias: string
}

export function MenuBloquear({ userId, alias }: MenuBloquearProps) {
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<'block' | 'mute' | null>(null)

  async function aplicar(modo: 'block' | 'mute') {
    setEnviando(true)
    setError(null)
    try {
      await bloquear(userId, modo)
      setHecho(modo)
      setAbierto(false)
    } catch (causa) {
      setError(causa instanceof Error ? causa.message : 'No hemos podido hacerlo. Inténtalo otra vez.')
    } finally {
      setEnviando(false)
    }
  }

  if (hecho) {
    return (
      <span className={estilos.filaMeta}>
        {hecho === 'block' ? 'Bloqueada' : 'Silenciada'}
      </span>
    )
  }

  return (
    <>
      <Boton variante="fantasma" tamano="sm" onClick={() => setAbierto(true)}>
        Bloquear
      </Boton>

      <Dialogo
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={`Bloquear o silenciar a ${alias}`}
        descripcion="Son dos cosas distintas y conviene saber cuál necesitas."
      >
        <ul className={estilos.advertencias}>
          <li>
            <strong>Bloquear</strong> corta la relación en los dos sentidos. Los refugios que
            compartís dejan de existir para los dos, con el historial dentro. No se puede
            deshacer recuperando la conversación.
          </li>
          <li>
            <strong>Silenciar</strong> te la oculta solo a ti. Esta persona no recibe ningún
            aviso y no nota nada.
          </li>
        </ul>

        {error ? (
          <p className={estilos.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={estilos.acciones}>
          <Boton variante="peligro" cargando={enviando} onClick={() => void aplicar('block')}>
            Bloquear
          </Boton>
          <Boton variante="secundario" cargando={enviando} onClick={() => void aplicar('mute')}>
            Silenciar
          </Boton>
          <Boton variante="fantasma" onClick={() => setAbierto(false)}>
            Ahora no
          </Boton>
        </div>
      </Dialogo>
    </>
  )
}
