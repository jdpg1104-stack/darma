'use client'

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
//
// La hora se formatea con el LOCALE ACTIVO y no con un `es-ES` fijo. `'use
// client'` es explícito desde la traducción: esta burbuja solo se pinta dentro
// de `Hilo`, que ya es cliente, así que no aparece ninguna frontera nueva.
// ============================================================================

import { useMemo } from 'react'

import type { MensajeDescifrado } from '@/lib/crypto/tipos'
import { useLocale, useTraductor } from '@/i18n/Proveedor'
import estilos from './refugio.module.css'

export interface BurbujaProps {
  mensaje: MensajeDescifrado
  /** `true` si lo escribí yo. Sale de comparar con la sesión, nunca del cuerpo. */
  mio: boolean
}

export function Burbuja({ mensaje, mio }: BurbujaProps) {
  const t = useTraductor()
  const locale = useLocale()
  const hora = useMemo(
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }),
    [locale],
  )

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
    <article
      className={clases}
      aria-label={t(mio ? 'refugios.burbuja.mia' : 'refugios.burbuja.recibida')}
    >
      {mensaje.texto !== null ? (
        // Texto plano en un nodo de texto. NUNCA dangerouslySetInnerHTML: el
        // contenido lo escribe una persona y renderizarlo como HTML es XSS
        // servido en el sitio con más superficie de riesgo de la app.
        mensaje.texto
      ) : mensaje.ilegiblePorClave ? (
        <span>{t('refugios.burbuja.sinLlave')}</span>
      ) : (
        <span>{t('refugios.burbuja.ilegible')}</span>
      )}
      <time className={estilos.hora} dateTime={mensaje.createdAt}>
        {hora.format(new Date(mensaje.createdAt))}
      </time>
    </article>
  )
}
