import type { Metadata } from 'next'

import { obtenerTraductor, resolverLocale, type Traductor } from '@/i18n'
import { resolverPais } from '@/i18n/pais'
import {
  recursosParaPais,
  tablaListaParaProduccion,
  type RecursoCrisis,
} from '@/i18n/recursosCrisis'

import estilos from './ayuda.module.css'

// ============================================================================
// /ayuda — la pantalla a la que lleva el botón de crisis.
//
// Es la página más importante de Darma y la que más restricciones tiene, todas
// por el mismo motivo: quien llega aquí puede estar en el peor momento de su
// vida, con prisa, con el móvil casi sin batería, con mala cobertura o con las
// manos temblando.
//
// De ahí las cinco decisiones que la gobiernan:
//
//  1. **Server Component sin una línea de JavaScript de cliente.** Nada que
//     hidratar, nada que pueda fallar. Los teléfonos son enlaces `tel:` y
//     funcionan aunque el bundle no llegue nunca. Por eso el idioma se resuelve
//     con `obtenerTraductor(await resolverLocale())` y NO con `useTraductor()`:
//     el hook obligaría a marcar esta página como `'use client'`.
//  2. **Pública en el proxy.** Nadie en riesgo debe toparse con un muro de
//     login. Esta ruta se declara en `PUBLIC_ROUTES` por razones que no son
//     técnicas.
//  3. **Los números primero.** Sin cabecera de marca, sin navegación, sin
//     tarjeta de bienvenida. Lo primero que se ve al abrir es un número al que
//     llamar. Todo lo demás va debajo.
//  4. **Nunca una pantalla vacía.** `recursosParaPais()` jamás devuelve una
//     lista vacía: si el país es desconocido cae al bloque internacional. Un
//     callejón sin salida aquí es inaceptable, y el número de otro país es
//     peor que ninguno.
//  5. **Se dice la verdad sobre la fiabilidad del dato.** Mientras
//     `tablaListaParaProduccion()` sea falso, la página avisa de que los
//     números no están confirmados uno a uno y de que si uno no responde hay
//     que probar el siguiente. Ocultarlo sería peor: alguien podría llamar,
//     encontrarse un número muerto y concluir que no hay nadie al otro lado.
//     Ese aviso se traduce ENTERO: en inglés dice exactamente lo mismo, sin
//     suavizar. Un aviso que solo existe en español es un aviso que no existe
//     para quien no lee español.
//
// ── EL IDIOMA Y EL PAÍS SON DOS EJES DISTINTOS ─────────────────────────────
// `resolverLocale()` decide en qué idioma se lee la página. `resolverPais()`
// decide QUÉ NÚMEROS se pintan. No se tocan: un hispanohablante en Estados
// Unidos lee esta página en español y ve el 988, no el 024. Los nombres de las
// organizaciones y los números NO se traducen nunca — son los datos oficiales
// de cada país (ver la cabecera de `i18n/recursosCrisis.ts`).
//
// Esta página existía en el diseño desde el principio, pero no era de ningún
// bloque, así que no la escribió nadie: durante toda la construcción el botón
// de crisis llevó a un 404. Lo destapó el recorrido E2E. Si algún día se
// reparte de nuevo el trabajo, que esta ruta tenga dueño explícito.
// ============================================================================

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('crisis.ayuda.metaTitulo'),
    description: t('crisis.ayuda.metaDescripcion'),
    robots: { index: true, follow: true },
  }
}

// Sin caché: el país sale de la petición, y una respuesta cacheada podría
// enseñarle a alguien los teléfonos de otro país.
export const dynamic = 'force-dynamic'

function esTelefono(r: RecursoCrisis): boolean {
  return r.tipo === 'telefono' || r.tipo === 'emergencias' || r.tipo === 'sms'
}

/** `tel:` para lo marcable, `sms:` para los de texto, la URL tal cual para el resto. */
function enlaceDe(r: RecursoCrisis): string {
  if (r.tipo === 'sms') return `sms:${r.valor}`
  if (esTelefono(r)) return `tel:${r.valor}`
  return r.valor
}

/**
 * Los horarios de `recursosCrisis.ts` son DATO, no copy: viven en un módulo
 * indexado por país y no se pueden traducir ahí sin romper esa relación. Se
 * traducen aquí, contra una lista cerrada, y lo que no esté en la lista se
 * pinta tal cual: preferimos un horario en español a una clave sin resolver
 * delante de alguien que está buscando un teléfono.
 */
const CLAVE_POR_HORARIO = new Map<string, string>([
  ['24/7', 'crisis.horario.veinticuatroSiete'],
  ['Según el país', 'crisis.horario.segunPais'],
])

function textoHorario(horario: string, t: Traductor): string {
  const clave = CLAVE_POR_HORARIO.get(horario)
  return clave === undefined ? horario : t(clave)
}

/**
 * Idiomas en los que ATIENDE la línea (no el idioma de la interfaz). Llegan
 * como códigos ISO; un código desconocido se pinta tal cual en vez de dejar
 * ver la clave del catálogo.
 */
const IDIOMAS_CONOCIDOS = new Set(['es', 'en', 'ca', 'eu', 'gl', 'fr', 'de'])

function textoIdiomas(codigos: readonly string[], t: Traductor): string {
  return codigos
    .map((c) => (IDIOMAS_CONOCIDOS.has(c) ? t(`crisis.idiomasAtencion.${c}`) : c))
    .join(', ')
}

export default async function PaginaAyuda() {
  const [locale, pais] = await Promise.all([resolverLocale(), resolverPais()])
  const t = obtenerTraductor(locale)
  const { pais: paisMostrado, recursos } = recursosParaPais(pais)
  const verificados = tablaListaParaProduccion()

  // Emergencias primero, siempre: si alguien está en peligro inmediato, el
  // número que necesita no es el de una línea de escucha.
  const ordenados = [...recursos].sort((a, b) => {
    if (a.tipo === 'emergencias' && b.tipo !== 'emergencias') return -1
    if (b.tipo === 'emergencias' && a.tipo !== 'emergencias') return 1
    return 0
  })

  return (
    <main className={estilos.pagina}>
      <h1 className={estilos.titulo}>{t('crisis.ayuda.titulo')}</h1>
      <p className={estilos.entrada}>{t('crisis.ayuda.entrada')}</p>

      <ul className={estilos.lista}>
        {ordenados.map((r) => (
          <li key={`${r.tipo}-${r.valor}`} className={estilos.recurso}>
            <a
              className={r.tipo === 'emergencias' ? estilos.enlaceUrgente : estilos.enlace}
              href={enlaceDe(r)}
              {...(esTelefono(r) ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
            >
              {/* Ni el número ni el nombre de la organización se traducen. */}
              <span className={estilos.valor}>{r.valor}</span>
              <span className={estilos.nombre}>{r.nombre}</span>
            </a>
            <p className={estilos.detalle}>
              {textoHorario(r.horario, t)}
              {/* También se dice cuando NO es gratuita: la entradilla promete que
                  cada tarjeta lo indica, y callarlo en las de pago dejaría a alguien
                  suponiendo que todas lo son. Dos de las líneas reales no lo son. */}
              {` · ${t(r.gratuito ? 'crisis.tarjeta.gratuito' : 'crisis.tarjeta.noGratuito')}`}
              {r.idiomasAtencion.length > 0
                ? ` · ${t('crisis.tarjeta.atiendeEn', { idiomas: textoIdiomas(r.idiomasAtencion, t) })}`
                : ''}
            </p>
          </li>
        ))}
      </ul>

      {paisMostrado === 'INTERNACIONAL' ? (
        <p className={estilos.nota}>
          {t('crisis.ayuda.internacional')} <b>{t('crisis.ayuda.internacionalUrgente')}</b>
        </p>
      ) : null}

      {!verificados ? (
        <p className={estilos.aviso}>{t('crisis.ayuda.sinVerificar')}</p>
      ) : null}

      <hr className={estilos.separador} />

      <section className={estilos.limite}>
        <h2 className={estilos.subtitulo}>{t('crisis.ayuda.noTerapiaTitulo')}</h2>
        <p>{t('crisis.ayuda.noTerapiaCuerpo')}</p>
      </section>

      <a className={estilos.volver} href="/feed">
        {t('comun.volver')}
      </a>
    </main>
  )
}
