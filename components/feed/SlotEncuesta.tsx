'use client'

// ============================================================================
// El hueco de la encuesta.
//
// B02 define la POSICIÓN y el TIPO; la tarjeta con la pregunta, las opciones y
// los porcentajes la pinta B09. Este componente existe para que el hueco esté
// reservado desde el primer día: si B09 llegara y el feed no tuviera dónde
// meterse, habría que rehacer el interleave, el cursor y sus pruebas.
//
// Mientras tanto NO se pinta un esqueleto ni un «cargando»: no hay nada
// cargando, hay una funcionalidad que aún no existe, y un esqueleto perpetuo
// hace pensar a la gente que la app está rota. Se pinta un enlace honesto.
//
// ⚠️ Contrato para B09: sustituir el cuerpo de este componente conservando la
// prop `encuestaId`. El feed ya trae el id resuelto por
// `feed_encuestas_keyset`, así que hidratar la encuesta NO debe añadir una
// consulta por tarjeta (eso sería un N+1 en la pantalla más cargada de la app):
// lo suyo es una sola consulta por página con `in (ids)`.
//
// `'use client'` por el idioma, no por interactividad: este componente lo pinta
// también `ScrollInfinito`, que es de cliente, así que el texto tiene que salir
// del contexto de locale (`useTraductor`) y no de `resolverLocale()`, que solo
// existe en el servidor. Sigue sin estado, sin efectos y sin manejadores.
// ============================================================================

import { Chip, Tarjeta } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'

import estilos from './Feed.module.css'

export interface SlotEncuestaProps {
  /** uuid de `public.polls`. B09 lo hidrata. */
  encuestaId: string
}

export function SlotEncuesta({ encuestaId }: SlotEncuestaProps) {
  const t = useTraductor()

  return (
    <Tarjeta como="section" className={estilos.tarjeta} data-encuesta={encuestaId}>
      <p className={estilos.encuesta}>
        {/* `feed.encuesta.etiqueta` y no `feed.encuesta`: esa clave era una hoja
            de texto Y a la vez el espacio de nombres que usa `components/polls`.
            Una clave no puede ser las dos cosas —`aplanar()` se queda con la
            cadena y todo lo que cuelgue queda inalcanzable—, así que la tarjeta
            de encuesta del feed llevaba pintando doce identificadores en crudo.
            Lo destapó `scripts/security/guardClaves.ts` en su primera pasada. */}
        <Chip>{t('feed.encuesta.etiqueta')}</Chip>
        {t('feed.encuestaTexto')}
      </p>
    </Tarjeta>
  )
}
