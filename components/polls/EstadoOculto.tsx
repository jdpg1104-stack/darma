'use client'

// ============================================================================
// «Todavía no enseñamos los resultados».
//
// `'use client'` desde la traducción, por el mismo motivo que `BarraResultado`:
// el texto sale del traductor y el único sitio que lo pinta es
// `TarjetaEncuesta`, que ya es cliente. No aparece un bundle nuevo.
//
// Este componente es la cara visible del umbral de revelación, y el texto
// importa tanto como la regla:
//
//  · NO dice cuántos votos faltan. «Faltan 2» es una invitación a traer dos
//    cuentas y observar el salto — que es exactamente el ataque que el umbral
//    evita.
//  · SÍ dice cuánta gente ha respondido, porque `polls.total_votes` es público
//    y ocultarlo sería mentir sobre algo que se puede comprobar. Saber que hay
//    tres respuestas no revela ninguna.
//  · Explica el PORQUÉ en una línea. Sin explicación, «no hay resultados»
//    parece un fallo; con ella, es la promesa de anonimato funcionando, que es
//    justo lo que hace que la siguiente persona conteste la verdad.
// ============================================================================

import { useTraductor } from '@/i18n/Proveedor'

import estilos from './Encuesta.module.css'

export interface EstadoOcultoProps {
  totalVotos: number
  /** ¿Ya votó quien está mirando? Cambia el tono, no la información. */
  heVotado: boolean
}

export function EstadoOculto({ totalVotos, heVotado }: EstadoOcultoProps) {
  const t = useTraductor()

  // El plural va en ICU y no en un ternario: «1 respuesta / 2 respuestas» no es
  // la misma regla en los dos idiomas, y el catálogo es donde esa regla vive.
  const respuestas =
    totalVotos === 0
      ? t('feed.encuesta.oculto.nadie')
      : t('feed.encuesta.oculto.cuantos', { n: totalVotos })

  return (
    <p className={estilos.oculto}>
      {heVotado ? `${t('feed.encuesta.oculto.gracias')} ` : ''}
      {respuestas} {t('feed.encuesta.oculto.porque')}
    </p>
  )
}
