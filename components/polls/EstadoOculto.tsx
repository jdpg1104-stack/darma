// ============================================================================
// «Todavía no enseñamos los resultados». Server Component puro.
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

import estilos from './Encuesta.module.css'

export interface EstadoOcultoProps {
  totalVotos: number
  /** ¿Ya votó quien está mirando? Cambia el tono, no la información. */
  heVotado: boolean
}

export function EstadoOculto({ totalVotos, heVotado }: EstadoOcultoProps) {
  const respuestas =
    totalVotos === 0
      ? 'Todavía no ha respondido nadie.'
      : totalVotos === 1
        ? 'Ha respondido una persona.'
        : `Han respondido ${totalVotos} personas.`

  return (
    <p className={estilos.oculto}>
      {heVotado ? 'Gracias por responder. ' : ''}
      {respuestas} Enseñamos los porcentajes cuando hay respuestas suficientes para
      que ninguna se pueda adivinar. Con muy pocas, un porcentaje diría quién
      contestó qué.
    </p>
  )
}
