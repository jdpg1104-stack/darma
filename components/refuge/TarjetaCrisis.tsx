'use client'

// ============================================================================
// B10 · La tarjeta de recursos, dentro del refugio
//
// CONTRATOS §9.1: cuando el nivel es `high` o `critical`, los recursos se
// muestran **en la misma interacción**, no en la siguiente pantalla ni en un
// correo diferido. Aquí eso significa: aparece encima del redactor, en el mismo
// render en que la persona pulsó enviar.
//
// Y §9.2: el mensaje SE ENVÍA IGUAL. Se prioriza, no se censura. Esta tarjeta
// no bloquea nada ni tiene un botón de «cancelar el envío»: quien acaba de
// escribir lo peor que le pasa no puede recibir como respuesta que su mensaje
// no se ha mandado.
//
// ── EL AVISO SALE DEL CATÁLOGO, NO DE `crisisMessage()` ────────────────────
// `crisis.aviso.{low,high,critical}` de `messages/*.json` es palabra por palabra
// el texto que devuelve `crisisMessage()` (`lib/crisis.ts`, dueño F3), con las
// mismas tres reglas de tono: no alarmar, no prometer lo que Darma no es y no
// sonar a vigilancia. La diferencia es que el catálogo existe en los dos
// idiomas. Quien abra esto en inglés está buscando ayuda: es la última pantalla
// de la app en la que puede permitirse leer español.
//
// Los NOMBRES y los TELÉFONOS de `helpResourcesFor()` no se traducen — son los
// oficiales de cada país (`crisis.tarjeta.textoNoSeTraduce`).
// ============================================================================

import { helpResourcesFor, type RiskLevel } from '@/lib/crisis'
import { useTraductor } from '@/i18n/Proveedor'
import estilos from './refugio.module.css'

export interface TarjetaCrisisProps {
  nivel: RiskLevel
  /** ISO 3166-1 alfa-2. `null` → directorio internacional, nunca lista vacía. */
  pais?: string | null
}

export function TarjetaCrisis({ nivel, pais = null }: TarjetaCrisisProps) {
  const t = useTraductor()

  if (nivel !== 'high' && nivel !== 'critical') return null

  const recursos = helpResourcesFor(pais)

  return (
    // `tarjeta-recursos`: el testid UNIFICADO que pidió B18 (PEDIDOS.md), el
    // mismo que llevan la tarjeta del composer y la del hilo. El `role="note"`
    // y el `aria-label` se quedan tal cual: el testid es adicional.
    <aside
      className={estilos.aviso}
      role="note"
      aria-label={t('refugios.crisis.etiqueta')}
      data-testid="tarjeta-recursos"
    >
      <p>{t(`crisis.aviso.${nivel}`)}</p>
      <ul className={estilos.advertencias}>
        {recursos.map((r) => (
          <li key={r.name}>
            {/* El teléfono es un enlace `tel:` para que se marque de una
                pulsación. En una crisis, cada paso de más es un paso que
                alguien no da. */}
            {r.phone ? (
              <a href={`tel:${r.phone.replace(/\s+/g, '')}`}>
                {r.name} · {r.phone}
              </a>
            ) : r.url ? (
              <a href={r.url} rel="noreferrer">
                {r.name}
              </a>
            ) : (
              r.name
            )}{' '}
            <span className={estilos.explicacion}>({r.hours})</span>
          </li>
        ))}
      </ul>
      <p className={estilos.explicacion}>{t('refugios.crisis.pie')}</p>
    </aside>
  )
}
