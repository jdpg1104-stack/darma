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
// El texto viene de `crisisMessage()` de `lib/crisis.ts` (dueño F3), que ya
// está escrito con las tres reglas de tono: no alarmar, no prometer lo que
// Darma no es, y no sonar a vigilancia («hemos detectado que…»).
// ============================================================================

import { crisisMessage, helpResourcesFor, type RiskLevel } from '@/lib/crisis'
import estilos from './refugio.module.css'

export interface TarjetaCrisisProps {
  nivel: RiskLevel
  /** ISO 3166-1 alfa-2. `null` → directorio internacional, nunca lista vacía. */
  pais?: string | null
}

export function TarjetaCrisis({ nivel, pais = null }: TarjetaCrisisProps) {
  if (nivel !== 'high' && nivel !== 'critical') return null

  const recursos = helpResourcesFor(pais)

  return (
    <aside className={estilos.aviso} role="note" aria-label="Recursos de ayuda">
      <p>{crisisMessage(nivel)}</p>
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
      <p className={estilos.explicacion}>
        Tu mensaje se ha enviado. No hemos leído lo que has escrito —no podemos, va
        cifrado— y nadie de tus almas afines recibe ningún aviso por esto.
      </p>
    </aside>
  )
}
