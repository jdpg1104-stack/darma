// ============================================================================
// B10 · El número de seguridad
//
// Es lo único que Darma puede ofrecer contra sí misma. El cifrado extremo a
// extremo protege el contenido frente a quien mire el cable o el dump de la
// base de datos, pero NO frente a que el propio servidor sirva una clave
// pública falsa y se ponga en medio: el servidor sirve también el JavaScript,
// así que esa puerta no se puede cerrar del todo en una web app.
//
// Lo que sí se puede hacer es dar a las dos personas una forma de comprobarlo
// por un canal que Darma no controla: se leen los quince dígitos en voz alta,
// por teléfono o en persona. Si coinciden, nadie se interpuso.
//
// Server Component: cero bytes de JS.
// ============================================================================

import { numeroSeguridad } from '@/lib/crypto/huella'
import estilos from './refugio.module.css'

export interface NumeroSeguridadProps {
  /** Huella de la otra persona, tal cual la devuelve `/api/refuges/keys`. */
  fingerprint: string
  /** Alias de la otra persona, solo para redactar la explicación. */
  alias?: string
}

export function NumeroSeguridad({ fingerprint, alias }: NumeroSeguridadProps) {
  let numero: string
  try {
    numero = numeroSeguridad(fingerprint)
  } catch {
    // Una huella que no se puede leer NO se enseña «a medias»: enseñar un
    // número inventado sería peor que no enseñar ninguno, porque la gente lo
    // compararía y le saldría distinto sin motivo.
    return (
      <p className={estilos.explicacion}>
        Todavía no podemos mostrar el número de seguridad de esta conversación.
      </p>
    )
  }

  return (
    <div className={estilos.numeroBloque}>
      <p className={estilos.explicacion}>
        Número de seguridad de esta conversación
        {alias ? ` con ${alias}` : ''}:
      </p>
      <output className={estilos.numero} aria-label={`Número de seguridad: ${numero.split('').join(' ')}`}>
        {numero}
      </output>
      <p className={estilos.explicacion}>
        Leedlo en voz alta los dos, por teléfono o en persona. Si os sale el mismo,
        nadie se ha metido en medio. Darma no puede comprobarlo por vosotros: por eso
        os lo enseñamos.
      </p>
    </div>
  )
}
