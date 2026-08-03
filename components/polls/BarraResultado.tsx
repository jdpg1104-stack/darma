'use client'

// ============================================================================
// Una fila de resultado.
//
// Se separa de `TarjetaEncuesta` porque lo único que necesita interactividad es
// el acto de votar: aquí no hay estado, ni efectos, ni `fetch`. Es una barra y
// dos textos.
//
// ⚠️ Llevaba `Server Component PURO: cero bytes de JS` hasta la traducción. El
// texto sale ahora de `useTraductor()`, así que el archivo declara
// `'use client'`. En la práctica no cambia lo que se envía al navegador: el
// único sitio desde el que se pinta es `TarjetaEncuesta`, que ya es cliente, y
// un módulo importado desde cliente viaja al bundle lleve la directiva o no. Lo
// que cambia es que ahora la frontera está escrita, y un Server Component que
// lo importe recibirá una frontera de cliente en vez de un error de hooks.
//
// TRES DECISIONES DE ACCESIBILIDAD:
//  1. La barra es decorativa (`aria-hidden`): el porcentaje ya está en el texto.
//     Anunciar el mismo dato dos veces convierte una encuesta de 4 opciones en
//     8 anuncios.
//  2. El porcentaje se pinta FUERA de la barra, sobre el fondo de la tarjeta.
//     `--accent` no tiene contraste suficiente como texto sobre fondo claro
//     (CONTRATOS §10): vale como relleno y como borde, no como tinta.
//  3. «Tu respuesta» se dice con PALABRAS, no solo con un borde de color. El
//     color nunca es el único portador de información.
// ============================================================================

import { clsx } from 'clsx'

import { useTraductor } from '@/i18n/Proveedor'

import estilos from './Encuesta.module.css'

export interface BarraResultadoProps {
  label: string
  /** 0–100, ya redondeado por `repartirPorcentajes`. */
  porcentaje: number
  votos: number
  /** ¿Es la opción que eligió quien está mirando? */
  esMiVoto: boolean
}

export function BarraResultado({ label, porcentaje, votos, esMiVoto }: BarraResultadoProps) {
  const t = useTraductor()
  const seguro = Math.max(0, Math.min(100, porcentaje))

  return (
    <li className={clsx(estilos.resultado, esMiVoto && estilos.miOpcion)}>
      {/* `width` inline es el ÚNICO estilo calculado del bloque y no hay
          alternativa razonable: el porcentaje es un dato, no un token de
          diseño, y una clase por cada valor de 0 a 100 sería una hoja de
          estilos de 101 reglas para pintar una barra. */}
      <span className={estilos.barra} style={{ width: `${seguro}%` }} aria-hidden="true" />
      <span className={estilos.etiquetaResultado}>
        {label}
        {esMiVoto ? ` · ${t('feed.encuesta.tuRespuesta')}` : ''}
      </span>
      <span className={estilos.porcentaje}>
        {seguro} %
        <span className="sr-only"> ({t('feed.encuesta.respuestas', { n: votos })})</span>
      </span>
    </li>
  )
}
