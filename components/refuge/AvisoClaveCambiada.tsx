'use client'

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
// `'use client'` desde la traducción: el texto sale de `useTraductor()`, y estos
// avisos solo se pintan dentro de `Hilo`, que ya es cliente. No se añade una
// frontera nueva al árbol; se hace explícita la que ya había.
// ============================================================================

import { useTraductor } from '@/i18n/Proveedor'
import estilos from './refugio.module.css'

export interface AvisoClaveCambiadaProps {
  alias?: string
}

export function AvisoClaveCambiada({ alias }: AvisoClaveCambiadaProps) {
  const t = useTraductor()

  return (
    <div className={estilos.aviso} role="note">
      <p className={estilos.avisoTitulo}>
        {alias ? t('refugios.clave.cambiadaAlias', { alias }) : t('refugios.clave.cambiada')}
      </p>
      <p className={estilos.explicacion}>{t('refugios.clave.cambiadaExplicacion')}</p>
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
  const t = useTraductor()

  return (
    <div className={`${estilos.aviso} ${estilos.avisoSuave}`} role="note">
      <p className={estilos.avisoTitulo}>
        {t(dispositivoNuevo ? 'refugios.clave.dispositivoNuevo' : 'refugios.clave.sinLlave')}
      </p>
      <p className={estilos.explicacion}>
        {t(
          dispositivoNuevo
            ? 'refugios.clave.dispositivoNuevoExplicacion'
            : 'refugios.clave.sinLlaveExplicacion',
        )}
      </p>
      {accion}
    </div>
  )
}
