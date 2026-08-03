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

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { MedidorKarma } from '../ui/index.ts'
import type { ResumenKarma } from './tipos.ts'
import estilos from './perfil.module.css'

export interface ProgresoNivelProps {
  resumen: ResumenKarma
  /** El desglose y el tope diario son datos PROPIOS: en el perfil ajeno solo se
   *  pinta la barra. */
  conDetallePrivado?: boolean
}

export async function ProgresoNivel({ resumen, conDetallePrivado = false }: ProgresoNivelProps) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <section className={estilos.seccion} aria-labelledby="titulo-progreso">
      <h2 className={estilos.tituloSeccion} id="titulo-progreso">
        {t('perfil.progresoTitulo')}
      </h2>

      <MedidorKarma karmaReputacion={resumen.reputacion} />

      {conDetallePrivado ? (
        <>
          <p className={estilos.pista}>
            {t('karma.hoyLlevas', { n: resumen.hoy.ganado, tope: resumen.hoy.tope })}{' '}
            {resumen.hoy.restante > 0
              ? t('karma.puedesSumar', { n: resumen.hoy.restante })
              : // El tope RECORTA, no rechaza: quien ayuda de más nunca recibe
                // un error por ayudar. El copy tiene que decir exactamente eso.
                t('karma.topeAlcanzado')}
          </p>

          {resumen.desglose30d.length > 0 ? (
            <dl className={estilos.desglose}>
              {resumen.desglose30d.map((d) => (
                <div className={estilos.desgloseFila} key={d.kind}>
                  {/* La descripción se pide por `kind`, no se lee de `d.descripcion`:
                      esa cadena la resuelve `KARMA_WEIGHTS` de lib/karma.ts, que es
                      la SSOT de la economía y está en un solo idioma. */}
                  <dt className={estilos.desgloseEtiqueta}>{t(`karma.tipos.${d.kind}`)}</dt>
                  <dd className={estilos.desgloseValor}>
                    {d.total >= 0 ? '+' : '−'}
                    {Math.abs(d.total)} · {d.veces} {t('karma.veces', { n: d.veces })}
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
