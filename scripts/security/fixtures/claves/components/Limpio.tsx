// Fixture del guard de claves: todo lo de aquí es LEGÍTIMO y no debe salir en
// el informe. Cada línea es un falso positivo que ya se ha visto en guards
// parecidos de este repositorio.

import { obtenerTraductor } from '@/i18n'

const CLAVE_INDIRECTA = 'comun.cerrar'

/** Un `/` que abre un regex, con `//` escapados dentro y una comilla suelta. */
const ENLACE = /^https?:\/\/[^/]+\/(can'?t|do)$/

export function Limpio({ cuerpo }: { cuerpo: { mensajeClave?: string } }) {
  const t = obtenerTraductor('es')

  // Una llamada comentada: t('inventada.en.comentario')
  return (
    <div>
      {/* Cierre JSX pegado a la llamada: el `</span>` NO puede tapar el t(). */}
      <span>{ENLACE.source}</span>{t('comun.aceptar')}
      <p>{t(CLAVE_INDIRECTA)}</p>
      <p>{cuerpo.mensajeClave ? t(cuerpo.mensajeClave) : t('comun.cancelar')}</p>
      <p>{t(`comun.mesCorto.${new Date().getMonth() + 1}`)}</p>
    </div>
  )
}
