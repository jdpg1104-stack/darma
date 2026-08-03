// ============================================================================
// B10 · Avisos de estado de la clave
//
// Los tres casos en los que hay que explicar algo, y por qué cada uno se
// escribe distinto:
//
// · CAMBIO DE CLAVE — la otra persona estrenó dispositivo. Se escribe en la
//   CONVERSACIÓN, como mensaje de sistema (`kind = 'system'`), no como un toast
//   que se pierde: un aviso de seguridad que desaparece a los tres segundos no
//   es un aviso, es una animación. Si además fuera el servidor quien mintió,
//   este es el único rastro que queda.
//
// · SIN CLAVE EN ESTE DISPOSITIVO — hay sala, hay mensajes y no hay llave.
//   Nunca se enseña una pantalla vacía: quien acaba de cambiar de móvil
//   pensaría que la app le ha borrado las conversaciones. Se dice lo que pasa y
//   se dice qué se puede hacer.
//
// · DISPOSITIVO NUEVO SIN COPIA — el historial anterior no vuelve. Se dice con
//   esas palabras, sin eufemismos y sin culpar a la persona, y se explica que
//   los mensajes NUEVOS sí se van a leer en cuanto alguien reenvíe la llave.
//
// Server Components: cero JS.
// ============================================================================

import estilos from './refugio.module.css'

export interface AvisoClaveCambiadaProps {
  alias?: string
}

export function AvisoClaveCambiada({ alias }: AvisoClaveCambiadaProps) {
  return (
    <div className={estilos.aviso} role="note">
      <p className={estilos.avisoTitulo}>
        {alias ? `El dispositivo de ${alias} ha cambiado.` : 'El dispositivo de esta persona ha cambiado.'}
      </p>
      <p className={estilos.explicacion}>
        Los mensajes anteriores no se pueden leer con la clave nueva. Si no esperabais
        un cambio de móvil, comprobad el número de seguridad antes de seguir contando
        nada importante.
      </p>
    </div>
  )
}

export interface AvisoSinClaveProps {
  /** `true` cuando esta sesión estrenó dispositivo (no hay identidad local
   *  previa), que es el caso en el que hay que explicar la pérdida. */
  dispositivoNuevo: boolean
  /** Acción para pedir la llave a los demás miembros. */
  accion?: React.ReactNode
}

export function AvisoSinClave({ dispositivoNuevo, accion }: AvisoSinClaveProps) {
  return (
    <div className={`${estilos.aviso} ${estilos.avisoSuave}`} role="note">
      <p className={estilos.avisoTitulo}>
        {dispositivoNuevo
          ? 'Este es un dispositivo nuevo, así que las conversaciones anteriores están cerradas.'
          : 'Todavía no tenemos la llave de esta conversación en este dispositivo.'}
      </p>
      <p className={estilos.explicacion}>
        {dispositivoNuevo
          ? 'Tus mensajes están cifrados con una clave que solo vivía en tu móvil anterior. Nosotros no la teníamos y no podemos recuperarla: es lo que hace que nadie más pueda leer lo que escribiste. Los mensajes nuevos sí se van a leer en cuanto alguien de la sala te reenvíe la llave.'
          : 'Alguien de la sala tiene que enviártela. Mientras tanto verás que hay mensajes, pero no lo que dicen.'}
      </p>
      {accion}
    </div>
  )
}
