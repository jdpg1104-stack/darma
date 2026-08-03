// ============================================================================
// TarjetaRecursos — lo que se le enseña a alguien que acaba de escribir desde
// un sitio difícil.
//
// ── LAS CUATRO REGLAS DE ESTA PANTALLA ─────────────────────────────────────
//
//  1. SE PINTA EN LA MISMA RESPUESTA QUE CONFIRMA LA PUBLICACIÓN. No hay
//     `router.push`, ni pantalla intermedia, ni correo diferido (CONTRATOS §9.1).
//     Los datos llegan dentro del JSON del POST; este componente solo los
//     dibuja. Si algún día alguien lo convierte en una página aparte, habrá
//     roto el contrato sin tocar ni una línea de este archivo: por eso los datos
//     entran por props y no por un `fetch` propio.
//
//  2. EL POST SE PUBLICA IGUAL. Esta tarjeta acompaña, no sustituye ni bloquea.
//     «Se prioriza, no se censura» (§9.2). Por eso el título dice primero que el
//     texto ya está publicado: quien escribe desde ahí necesita saber que ha
//     sido escuchado, y la duda sobre si su texto se ha enviado o no es
//     exactamente la angustia que no hay que añadirle.
//
//  3. NI ALARMA NI DIAGNÓSTICO. Acento `'crisis'` de `Tarjeta`, que en el
//     sistema de diseño es VERDE (`--accent2`), nunca rojo. No dice «hemos
//     detectado»: suena a vigilancia, y quien se siente vigilado deja de contar
//     la verdad. Tampoco subraya sus propias palabras — señalarle a alguien el
//     fragmento por el que ha saltado el sistema es revictimizarlo.
//
//  4. EL TELÉFONO ES UN `tel:` DE VERDAD. En móvil, un número que no se puede
//     pulsar obliga a memorizarlo y cambiar de app justo cuando la capacidad de
//     hacer dos pasos seguidos es la que menos.
//
// Sin estado, sin efectos y sin un solo manejador de eventos. No lleva
// `'use client'`, pero acaba en el bundle igualmente porque lo renderiza el
// composer, que sí es cliente (los datos llegan de la respuesta de un `fetch`,
// así que no hay forma de renderizarlo en el servidor). Que sea puramente
// declarativo es lo que hace que su coste sea el del marcado y poco más.
// ============================================================================

import { Tarjeta } from '@/components/ui'
import type { TarjetaRecursosDatos } from './contrato.ts'
import estilos from './TarjetaRecursos.module.css'

export interface TarjetaRecursosProps {
  datos: TarjetaRecursosDatos
}

export function TarjetaRecursos({ datos }: TarjetaRecursosProps) {
  return (
    <Tarjeta
      como="section"
      acento="crisis"
      // `polite` y no `assertive`: la lectura se anuncia cuando la persona
      // termina lo que esté haciendo. Interrumpir a mitad de frase a alguien que
      // usa lector de pantalla, en este momento concreto, es un sobresalto.
      aria-live="polite"
      aria-labelledby="recursos-titulo"
    >
      <h2 id="recursos-titulo" className={estilos.titulo}>
        {datos.titulo}
      </h2>

      <p className={estilos.mensaje}>{datos.mensaje}</p>

      <ul className={estilos.lineas}>
        {datos.lineas.map((linea) => (
          <li key={linea.nombre} className={estilos.linea}>
            <span className={estilos.nombre}>{linea.nombre}</span>

            {linea.telefono ? (
              <a className={estilos.telefono} href={`tel:${linea.telefono.replace(/\s+/g, '')}`}>
                {linea.telefono}
              </a>
            ) : null}

            {linea.url ? (
              // `rel="noreferrer"` además de `noopener`: sin él, el sitio de
              // destino recibe en el Referer la URL desde la que se llega. En
              // una app de salud mental anónima, eso es contarle a un tercero
              // que esta persona estuvo aquí.
              <a className={estilos.enlace} href={linea.url} target="_blank" rel="noopener noreferrer">
                {linea.url.replace(/^https?:\/\//, '')}
              </a>
            ) : null}

            {linea.horario ? <span className={estilos.horario}>{linea.horario}</span> : null}
          </li>
        ))}
      </ul>

      {/* Un `<a>` y no un `Boton`: `Boton` renderiza un `<button>` y meter un
          enlace dentro de un botón es HTML inválido, además de dejar la acción
          dependiendo de que el JS haya hidratado. Aquí la acción es navegar, y
          navegar es lo que un enlace hace aun con el JS caído — que es el
          escenario para el que esta tarjeta existe. */}
      <a className={estilos.accion} href={datos.accionInmediata.href}>
        {datos.accionInmediata.etiqueta}
      </a>
    </Tarjeta>
  )
}
