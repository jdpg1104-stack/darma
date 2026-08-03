'use client'

// ============================================================================
// Frontera de error del hilo.
//
// No se enseña `error.message`: en producción Next ya lo sustituye por un texto
// genérico, pero en desarrollo y en preview trae el mensaje real —y aquí un
// mensaje real puede venir de Postgres con el nombre de una tabla dentro—. El
// `digest` sí se muestra: es un identificador opaco que soporte puede cruzar
// con la línea del log, y no dice nada de nadie.
//
// El tono importa: quien llega a esta pantalla venía a leer o a escribir algo
// que le costaba. «Ha ocurrido un error inesperado» es un portazo; se explica
// qué pasa y se ofrece volver a intentarlo.
// ============================================================================

import { useEffect } from 'react'
import { Boton, EstadoVacio } from '@/components/ui'

export default function ErrorHilo({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[darma][b04] fallo al pintar el hilo', { digest: error.digest })
  }, [error])

  return (
    <main>
      <EstadoVacio
        titulo="No hemos podido abrir esta conversación"
        descripcion="No es culpa tuya y no se ha perdido nada. Prueba otra vez en un momento."
        tono="cuidado"
        accion={<Boton onClick={reset}>Volver a intentarlo</Boton>}
      />
      {error.digest ? <p aria-hidden="true">{error.digest}</p> : null}
    </main>
  )
}
