// ============================================================================
// ProgresoNivel — envuelve MedidorKarma (B16) y añade el desglose de 30 días.
//
// NO recalcula nada. `MedidorKarma` ya llama a `progressToNextLevel()` por
// dentro, así que aquí no hay ningún ratio, ningún umbral y ninguna división:
// pintar `karma / umbralSiguiente` mostraría 2400/5000 = 48 % justo cuando
// faltan 2 600 puntos (Trampa #1 de la ficha). El único número que este
// componente escribe es el que le llega ya calculado.
//
// Server Component.
// ============================================================================

import { MedidorKarma } from '../ui/index.ts'
import type { ResumenKarma } from './tipos.ts'
import estilos from './perfil.module.css'

export interface ProgresoNivelProps {
  resumen: ResumenKarma
  /** El desglose y el tope diario son datos PROPIOS: en el perfil ajeno solo se
   *  pinta la barra. */
  conDetallePrivado?: boolean
}

export function ProgresoNivel({ resumen, conDetallePrivado = false }: ProgresoNivelProps) {
  return (
    <section className={estilos.seccion} aria-labelledby="titulo-progreso">
      <h2 className={estilos.tituloSeccion} id="titulo-progreso">
        Nivel
      </h2>

      <MedidorKarma karmaReputacion={resumen.reputacion} />

      {conDetallePrivado ? (
        <>
          <p className={estilos.pista}>
            Hoy llevas {resumen.hoy.ganado} de {resumen.hoy.tope} de karma.{' '}
            {resumen.hoy.restante > 0
              ? `Puedes sumar ${resumen.hoy.restante} más.`
              : // El tope RECORTA, no rechaza: quien ayuda de más nunca recibe
                // un error por ayudar. El copy tiene que decir exactamente eso.
                'Has llegado al máximo del día. Lo que hagas ahora cuenta igual para quien lo recibe.'}
          </p>

          {resumen.desglose30d.length > 0 ? (
            <dl className={estilos.desglose}>
              {resumen.desglose30d.map((d) => (
                <div className={estilos.desgloseFila} key={d.kind}>
                  <dt className={estilos.desgloseEtiqueta}>{d.descripcion}</dt>
                  <dd className={estilos.desgloseValor}>
                    {d.total >= 0 ? '+' : '−'}
                    {Math.abs(d.total)} · {d.veces}{' '}
                    {d.veces === 1 ? 'vez' : 'veces'}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
