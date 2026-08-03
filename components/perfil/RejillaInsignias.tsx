// ============================================================================
// RejillaInsignias — el catálogo, con el requisito escrito al lado.
//
// Cada insignia pendiente muestra su requisito. No es relleno: una insignia
// que no explica cómo se consigue es una mecánica oscura, y en Darma la
// economía es auditable por principio (la tabla `karma_weights` es de lectura
// pública precisamente por eso). Si alguien no puede saber qué le falta, el
// sistema le está pidiendo que adivine.
//
// El estado «pendiente» NO se comunica solo con la opacidad: lleva borde
// discontinuo y, sobre todo, el texto «Te falta: …». El color y el contraste
// nunca son el único portador de información.
//
// ── DE DÓNDE SALE EL TEXTO ─────────────────────────────────────────────────
// Del catálogo, por CLAVE de insignia (`perfil.insigniasCatalogo.<clave>`), no
// de los campos `nombre`/`descripcion`/`comoSeConsigue` del objeto `Insignia`.
// Esos siguen existiendo —son parte del contrato de `GET /api/karma/insignias`
// y hay pruebas que los afirman— pero están en un solo idioma. El umbral
// numérico viaja como parámetro ICU `{n}` desde `UMBRAL_INSIGNIA`, para que el
// 500 de Brote siga viviendo únicamente en `KARMA_LEVELS`.
//
// Server Component.
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { EstadoVacio } from '../ui/index.ts'
import { UMBRAL_INSIGNIA } from './insignias.ts'
import type { Insignia } from './tipos.ts'
import estilos from './perfil.module.css'

export interface RejillaInsigniasProps {
  insignias: Insignia[]
  /** Título de la sección. El perfil ajeno usa otro: lo que se ve ahí es un
   *  subconjunto, y llamarlo «Tus insignias» sería mentir sobre el alcance. */
  titulo?: string
  /** Texto del vacío. En el perfil ajeno el vacío no es un fallo ni una
   *  carencia de esa persona: es que no hay nada público que enseñar. */
  textoVacio?: string
}

export async function RejillaInsignias({
  insignias,
  titulo,
  textoVacio,
}: RejillaInsigniasProps) {
  const t = obtenerTraductor(await resolverLocale())
  const id = 'titulo-insignias'

  // Los valores por defecto se resuelven aquí y no en la firma: un parámetro
  // por defecto no puede llamar a `t`, que aún no existe en ese punto.
  const tituloFinal = titulo ?? t('perfil.insigniasTitulo')
  const vacioFinal = textoVacio ?? t('perfil.insigniasVacio')

  return (
    <section className={estilos.seccion} aria-labelledby={id}>
      <h2 className={estilos.tituloSeccion} id={id}>
        {tituloFinal}
      </h2>

      {insignias.length === 0 ? (
        <EstadoVacio titulo={vacioFinal} tono="neutro" />
      ) : (
        <ul className={estilos.rejilla}>
          {insignias.map((i) => (
            <li
              key={i.clave}
              className={`${estilos.insignia} ${i.conseguida ? '' : estilos.insigniaPendiente}`}
            >
              <span className={estilos.insigniaNombre}>
                {t(`perfil.insigniasCatalogo.${i.clave}.nombre`)}
              </span>
              <p className={estilos.insigniaTexto}>
                {i.conseguida
                  ? t(`perfil.insigniasCatalogo.${i.clave}.descripcion`)
                  : t('perfil.insigniaTeFalta', {
                      requisito: t(`perfil.insigniasCatalogo.${i.clave}.requisito`, {
                        n: UMBRAL_INSIGNIA[i.clave],
                      }),
                    })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
