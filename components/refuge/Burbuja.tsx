// ============================================================================
// B10 · Una burbuja del hilo.
//
// Recibe el mensaje YA DESCIFRADO. Nunca recibe el ciphertext, ni la clave, ni
// la identidad de nadie: si mañana este componente hiciera falta en un sitio
// donde no hay clave, seguiría funcionando y diciendo la verdad.
//
// Distingue DOS fallos que en pantalla no se pueden confundir:
//  · `ilegiblePorClave` — «no tengo la llave». Tiene arreglo: alguien te la
//    reenvía. Se dice así.
//  · el otro — hay llave y aun así no cuadra. Eso es un mensaje corrupto o
//    cifrado con otra clave (alguien rotó), y NO tiene arreglo. Decir «pide la
//    llave» en ese caso mandaría a la persona a una acción que no funciona.
// ============================================================================

import type { MensajeDescifrado } from '@/lib/crypto/tipos'
import estilos from './refugio.module.css'

export interface BurbujaProps {
  mensaje: MensajeDescifrado
  /** `true` si lo escribí yo. Sale de comparar con la sesión, nunca del cuerpo. */
  mio: boolean
}

const HORA = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

export function Burbuja({ mensaje, mio }: BurbujaProps) {
  const esSistema = mensaje.kind === 'system'
  const ilegible = mensaje.texto === null

  const clases = [
    estilos.burbuja,
    esSistema ? estilos.burbujaSistema : mio ? estilos.burbujaMia : '',
    ilegible && !esSistema ? estilos.burbujaIlegible : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <article className={clases} aria-label={mio ? 'Mensaje tuyo' : 'Mensaje recibido'}>
      {mensaje.texto !== null ? (
        // Texto plano en un nodo de texto. NUNCA dangerouslySetInnerHTML: el
        // contenido lo escribe una persona y renderizarlo como HTML es XSS
        // servido en el sitio con más superficie de riesgo de la app.
        mensaje.texto
      ) : mensaje.ilegiblePorClave ? (
        <span>Mensaje cerrado: este dispositivo no tiene la llave de esta conversación.</span>
      ) : (
        <span>Este mensaje no se puede abrir. Puede que se escribiera con una clave anterior.</span>
      )}
      <time className={estilos.hora} dateTime={mensaje.createdAt}>
        {HORA.format(new Date(mensaje.createdAt))}
      </time>
    </article>
  )
}
