// ============================================================================
// /panel/activacion — el embudo. SERVER COMPONENT.
//
// ── EL ESCALÓN QUE IMPORTA ES EL CUARTO ────────────────────────────────────
// «Primer comentario validado». Quien no lo consigue nunca podrá publicar —el
// gate 3:1 es un trigger de Postgres, no una sugerencia— y se va sin haber
// contado nunca lo que venía a contar. Si ese escalón se estrecha, no es un
// problema de captación: o el clasificador se ha puesto duro, o el onboarding
// no explica qué cuenta como escucha.
//
// ── QUÉ AÑADE ESTA VERSIÓN (hallazgo del crítico: «nada mide activación… ni
// el éxito del pilar 1») ────────────────────────────────────────────────────
//   · El embudo COMPARADO en ventanas de 7 y 30 días, con tasas sobre el
//     registro — derivado de las mismas filas de rollup que ya se leían.
//   · «Volvió tras su primer día», de `admin_embudo_daily` (0218): dos cifras
//     que acotan la verdad (actividad medible y cota por last_seen), porque
//     no hay tabla de sesiones y NO se añade tracking nuevo.
//   · El pilar 1: vídeos completados por día y personas distintas, agregados
//     de `content_views` vía rollup — jamás en vivo.
// DOS consultas por render (rollup 90 días + embudo 30 días), bajo el
// presupuesto de 3 de CONTRATOS §11. Cero JS de cliente.
//
// ── TODO ENMASCARADO POR DEBAJO DE 20 ──────────────────────────────────────
// Cada conteo de PERSONAS pasa por `enmascarar()`. Un embudo de un día flojo
// puede tener cortes de 3 personas, y un agregado con n=3 más un poco de
// contexto externo señala a alguien concreto. Aquí se muestra «<20» y no se
// discute. Los vídeos completados son EVENTOS y van sin máscara, como los
// posts y los comentarios en el resto del panel.
//
// ── TODO EL COPY VIENE DEL CATÁLOGO ────────────────────────────────────────
// `admin.activacion.*` en `messages/{es,en}.json`. `escalonesDeVentana()`
// devuelve la CLAVE de cada escalón y esta página la resuelve con `t()`: la
// lógica del embudo no conoce el idioma.
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import {
  DIAS_VENTANA_DETALLE,
  aDiaUtc,
  enmascarar,
  getEmbudoActivacion,
  leerRollup,
  ratio,
  ventanaDias,
} from '../../_lib/dashboard.ts'
import { TablaSerie } from '../../_componentes/TablaSerie.tsx'
import { entero, porcentaje } from '../../_componentes/Formato.ts'
import {
  DIAS_VENTANA_EMBUDO,
  embudoDeVentana,
  escalonesDeVentana,
  filtrarUltimosDias,
  leerEmbudoDiario,
  resumenPilar1,
} from './logica.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function PaginaActivacion() {
  await requireAdmin('soporte', { accion: `${ACCIONES.panel}.activacion` })

  const t = obtenerTraductor(await resolverLocale())
  const admin = createAdminClient()
  const [filas, filasEmbudo] = await Promise.all([
    leerRollup(admin, ventanaDias(DIAS_VENTANA_DETALLE)),
    leerEmbudoDiario(admin, ventanaDias(DIAS_VENTANA_EMBUDO)),
  ])
  const embudo = getEmbudoActivacion(filas)

  // Las ventanas comparadas se derivan de las MISMAS filas ya leídas: filtrar
  // en memoria 90 filas no es una consulta nueva.
  const hoy = aDiaUtc(new Date().toISOString())
  const ventana7 = embudoDeVentana(
    7,
    filtrarUltimosDias(filas, 7, hoy),
    filtrarUltimosDias(filasEmbudo, 7, hoy),
  )
  const ventana30 = embudoDeVentana(
    30,
    filtrarUltimosDias(filas, 30, hoy),
    filtrarUltimosDias(filasEmbudo, 30, hoy),
  )
  const escalones7 = escalonesDeVentana(ventana7)
  const escalones30 = escalonesDeVentana(ventana30)

  const pilar7 = resumenPilar1(7, filtrarUltimosDias(filasEmbudo, 7, hoy))
  const pilar30 = resumenPilar1(30, filtrarUltimosDias(filasEmbudo, 30, hoy))

  const escalones = [
    { etiqueta: t('admin.embudo.e1'), n: embudo.registrados },
    { etiqueta: t('admin.embudo.e2'), n: embudo.onboardingCompleto },
    { etiqueta: t('admin.embudo.e3Largo'), n: embudo.primeraLectura },
    { etiqueta: t('admin.embudo.e4'), n: embudo.primerComentarioValidado },
    { etiqueta: t('admin.embudo.e5'), n: embudo.primeraPublicacion },
    { etiqueta: t('admin.embudo.e6'), n: embudo.vueltaD7 },
  ]

  return (
    <section>
      <h1>{t('admin.activacion.titulo')}</h1>
      <p>{t('admin.activacion.cohorte', { dias: DIAS_VENTANA_DETALLE })}</p>
      <p>{t('admin.activacion.notaMedicion')}</p>

      <TablaSerie
        titulo={t('admin.activacion.tituloVentanas')}
        columnas={[
          { clave: 'escalon', etiqueta: t('admin.activacion.colEscalon') },
          { clave: 'p7', etiqueta: t('admin.activacion.colPersonas7') },
          { clave: 't7', etiqueta: t('admin.activacion.colTasa7') },
          { clave: 'p30', etiqueta: t('admin.activacion.colPersonas30') },
          { clave: 't30', etiqueta: t('admin.activacion.colTasa30') },
        ]}
        filas={escalones7.map((e7, i) => ({
          escalon: t(e7.etiquetaKey),
          p7: enmascarar(e7.personas),
          // Las tasas se calculan sobre los números reales, no sobre los
          // enmascarados: enmascarar es de presentación, no de cálculo.
          t7: porcentaje(e7.sobreRegistro),
          p30: enmascarar(escalones30[i].personas),
          t30: porcentaje(escalones30[i].sobreRegistro),
        }))}
      />

      <p>{t('admin.activacion.notaCuentas')}</p>
      <p>
        {t('admin.activacion.notaVueltaD1a')} <strong>{enmascarar(ventana7.vueltaD1Cota)}</strong>{' '}
        {t('admin.activacion.notaVueltaD1b')} <strong>{enmascarar(ventana30.vueltaD1Cota)}</strong>{' '}
        {t('admin.activacion.notaVueltaD1c')}
      </p>
      {filasEmbudo.length === 0 ? <p>{t('admin.activacion.sinRollupEmbudo')}</p> : null}

      <h2>{t('admin.activacion.tituloPilar1')}</h2>
      <p>{t('admin.activacion.introPilar1')}</p>
      <p>
        {t('admin.activacion.resumenPilar1a')} <strong>{entero(pilar7.videosCompletados)}</strong>{' '}
        {t('admin.activacion.resumenPilar1b')} <strong>{enmascarar(pilar7.personasCompletaronCota)}</strong>{' '}
        {t('admin.activacion.resumenPilar1c')} <strong>{entero(pilar30.videosCompletados)}</strong>{' '}
        {t('admin.activacion.resumenPilar1d')} <strong>{enmascarar(pilar30.personasCompletaronCota)}</strong>{' '}
        {t('admin.activacion.resumenPilar1e')}
      </p>
      <p>{t('admin.activacion.notaPilar1')}</p>

      <TablaSerie
        titulo={t('admin.activacion.tituloSeriePilar1')}
        columnas={[
          { clave: 'dia', etiqueta: t('admin.activacion.colDia') },
          { clave: 'videos', etiqueta: t('admin.activacion.colVideos') },
          { clave: 'personas', etiqueta: t('admin.activacion.colPersonas') },
        ]}
        filas={pilar30.serie.map((p) => ({
          dia: p.dia,
          videos: entero(p.videos),
          personas: enmascarar(p.personas),
        }))}
      />

      <TablaSerie
        titulo={t('admin.activacion.tablaEmbudo')}
        columnas={[
          { clave: 'escalon', etiqueta: t('admin.tabla.escalon') },
          { clave: 'personas', etiqueta: t('admin.tabla.personas') },
          { clave: 'conversion', etiqueta: t('admin.tabla.sobreRegistro') },
        ]}
        filas={escalones.map((e) => ({
          escalon: e.etiqueta,
          personas: enmascarar(e.n),
          // El porcentaje se calcula sobre los números reales, no sobre los
          // enmascarados: enmascarar es de presentación, no de cálculo.
          conversion: porcentaje(ratio(e.n, embudo.registrados)),
        }))}
      />

      <TablaSerie
        titulo={t('admin.tabla.serieDiaria', { dias: DIAS_VENTANA_DETALLE })}
        columnas={[
          { clave: 'dia', etiqueta: t('admin.tabla.dia') },
          { clave: 'registrados', etiqueta: t('admin.tabla.registro') },
          { clave: 'onboarding', etiqueta: t('admin.tabla.onboarding') },
          { clave: 'lectura', etiqueta: t('admin.tabla.lectura') },
          { clave: 'validado', etiqueta: t('admin.tabla.comentarioValidado') },
          { clave: 'publicacion', etiqueta: t('admin.tabla.publicacion') },
          { clave: 'd7', etiqueta: t('admin.tabla.vueltaD7') },
        ]}
        filas={filas.map((f) => ({
          dia: f.dia,
          registrados: enmascarar(Number(f.metricas.act_registrados ?? 0)),
          onboarding: enmascarar(Number(f.metricas.act_onboarding ?? 0)),
          lectura: enmascarar(Number(f.metricas.act_primera_lectura ?? 0)),
          validado: enmascarar(Number(f.metricas.act_primer_comentario_validado ?? 0)),
          publicacion: enmascarar(Number(f.metricas.act_primera_publicacion ?? 0)),
          d7: enmascarar(Number(f.metricas.act_vuelta_d7 ?? 0)),
        }))}
      />
    </section>
  )
}
