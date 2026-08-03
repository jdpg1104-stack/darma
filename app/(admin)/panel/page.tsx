// ============================================================================
// /panel — la portada del centro de mando. SERVER COMPONENT.
//
// ── EL ORDEN DE LAS TARJETAS ES LA TESIS DEL PRODUCTO ─────────────────────
//   1. Salud del bucle de reciprocidad. EL KPI. Si cae por debajo de 3,0 la
//      economía deja de sostenerse sola y todo lo demás —retención, calidad,
//      ingresos— se cae detrás con semanas de retraso y sin que nadie sepa por
//      qué. Sin oídos no hay a quién contarle nada.
//   2. Tiempo hasta la primera respuesta.
//   3. Cobertura de revisión de crisis (100 %, no negociable).
//   4. Embudo de activación.
//   5. Economía.
//
// Con UNA excepción que sí se mueve: si hay un caso de crisis sin atender por
// encima de 15 minutos, la tarjeta de crisis salta al primer lugar. La crisis
// gana siempre (CONTRATOS §9); ni el KPI le pasa por delante.
//
// ── PRESUPUESTO ────────────────────────────────────────────────────────────
// DOS consultas a la base por render (el rollup y la cola viva), por debajo
// del presupuesto de 3 de CONTRATOS §11. Cero bytes de JS: todo es servidor.
// ============================================================================

import { EstadoVacio, Tarjeta } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../api/admin/_guard.ts'
import { ACCIONES } from '../_lib/acceso.ts'
import { cumpleRol } from '../_lib/acceso.ts'
import {
  DIAS_VENTANA_KPI,
  LIMITE_PENDIENTE_CRISIS_SEGUNDOS,
  UMBRAL_RECIPROCIDAD,
  enmascarar,
  getResumenPanel,
  ventanaDias,
} from '../_lib/dashboard.ts'
import { TarjetaMetrica } from '../_componentes/TarjetaMetrica.tsx'
import { Sparkline } from '../_componentes/Sparkline.tsx'
import { decimal, duracion, entero, euros, fecha, porcentaje } from '../_componentes/Formato.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function PaginaPanel() {
  const contexto = await requireAdmin('soporte', { accion: ACCIONES.panel })
  const t = obtenerTraductor(await resolverLocale())
  const admin = createAdminClient()
  const resumen = await getResumenPanel(admin, ventanaDias(DIAS_VENTANA_KPI))

  const { reciprocidad, ttpr, crisis, activacion, economia } = resumen

  const crisisPrimero =
    crisis.masAntiguoPendienteSegundos !== null &&
    crisis.masAntiguoPendienteSegundos > LIMITE_PENDIENTE_CRISIS_SEGUNDOS

  const tarjetaCrisis = cumpleRol(contexto.rol, 'moderador') ? (
    <TarjetaMetrica
      key="crisis"
      titulo={t('admin.crisis.titulo')}
      valor={porcentaje(crisis.cobertura)}
      descripcion={
        crisis.cobertura < 1 ? t('admin.panel.crisisIncidente') : t('admin.panel.crisisOk')
      }
      semaforo={crisis.semaforo}
      detalles={[
        { etiqueta: t('admin.crisis.eventosRiesgo'), valor: entero(crisis.eventos) },
        { etiqueta: t('admin.crisis.revisadosPorPersona'), valor: entero(crisis.revisados) },
        { etiqueta: t('admin.crisis.enCola'), valor: entero(crisis.pendientes) },
        { etiqueta: t('admin.crisis.masAntiguo'), valor: duracion(crisis.masAntiguoPendienteSegundos) },
        { etiqueta: t('admin.crisis.p95'), valor: duracion(crisis.p95AtencionSegundos) },
      ]}
    />
  ) : null

  const tarjetaReciprocidad = (
    <TarjetaMetrica
      key="reciprocidad"
      titulo={t('admin.panel.reciprocidadTitulo')}
      valor={decimal(reciprocidad.ratioReciprocidad)}
      descripcion={t('admin.panel.reciprocidadDescripcion', {
        dias: DIAS_VENTANA_KPI,
        umbral: UMBRAL_RECIPROCIDAD,
      })}
      semaforo={reciprocidad.semaforo}
      detalles={[
        { etiqueta: t('admin.tabla.escuchasValidadas'), valor: entero(reciprocidad.escuchasValidadas) },
        { etiqueta: t('admin.tabla.publicaciones'), valor: entero(reciprocidad.postsPublicados) },
        // Si esta cae, es el clasificador el que se ha roto, no la gente.
        { etiqueta: t('admin.tabla.tasaValidacion'), valor: porcentaje(reciprocidad.tasaValidacion) },
        { etiqueta: t('admin.tabla.cobertura24h'), valor: porcentaje(reciprocidad.coberturaPosts24h) },
      ]}
    >
      <Sparkline
        valores={reciprocidad.serie.map((p) => p.ratio)}
        umbral={UMBRAL_RECIPROCIDAD}
        titulo={t('admin.panel.reciprocidadSparkline', {
          dias: reciprocidad.serie.length,
          umbral: UMBRAL_RECIPROCIDAD,
        })}
      />
    </TarjetaMetrica>
  )

  const tarjetaTtpr = (
    <TarjetaMetrica
      key="ttpr"
      titulo={t('admin.panel.ttprTitulo')}
      valor={duracion(ttpr.p50Segundos)}
      descripcion={t('admin.panel.ttprDescripcion')}
      semaforo={ttpr.semaforo}
      detalles={[
        { etiqueta: t('admin.panel.ttprP90'), valor: duracion(ttpr.p90Segundos) },
        // El desglose que de verdad duele: quien está peor debe esperar menos.
        { etiqueta: t('admin.panel.ttprP50Riesgo'), valor: duracion(ttpr.p50SegundosRiesgo) },
        { etiqueta: t('admin.panel.ttprSinRespuesta24h'), valor: entero(ttpr.postsSinRespuesta24h) },
      ]}
    >
      <Sparkline
        valores={ttpr.serie.map((p) => p.p50)}
        titulo={t('admin.panel.ttprSparkline', { dias: ttpr.serie.length })}
      />
    </TarjetaMetrica>
  )

  const tarjetaActivacion = (
    <TarjetaMetrica
      key="activacion"
      titulo={t('admin.panel.activacionTitulo')}
      valor={enmascarar(activacion.registrados)}
      descripcion={t('admin.panel.activacionDescripcion')}
      detalles={[
        { etiqueta: t('admin.embudo.e1'), valor: enmascarar(activacion.registrados) },
        { etiqueta: t('admin.embudo.e2'), valor: enmascarar(activacion.onboardingCompleto) },
        { etiqueta: t('admin.embudo.e3'), valor: enmascarar(activacion.primeraLectura) },
        { etiqueta: t('admin.embudo.e4'), valor: enmascarar(activacion.primerComentarioValidado) },
        { etiqueta: t('admin.embudo.e5'), valor: enmascarar(activacion.primeraPublicacion) },
        { etiqueta: t('admin.embudo.e6'), valor: enmascarar(activacion.vueltaD7) },
      ]}
    />
  )

  const tarjetaEconomia = cumpleRol(contexto.rol, 'operaciones') ? (
    <TarjetaMetrica
      key="economia"
      titulo={t('admin.economia.titulo')}
      valor={euros(economia.ingresoCentimos)}
      descripcion={
        economia.ingresoEstimado
          ? t('admin.economia.descripcionEstimado')
          : t('admin.economia.descripcionReal')
      }
      detalles={[
        { etiqueta: t('admin.economia.arppu'), valor: euros(economia.arppuCentimos) },
        { etiqueta: t('admin.economia.compradoresUnicos'), valor: enmascarar(economia.compradoresUnicos) },
        { etiqueta: t('admin.economia.cristalesVendidos'), valor: entero(economia.cristalesVendidos) },
        { etiqueta: t('admin.economia.karmaEmitido'), valor: entero(economia.karmaEmitido) },
        { etiqueta: t('admin.economia.karmaDrenado'), valor: entero(economia.karmaDrenado) },
        { etiqueta: t('admin.economia.stockGastable'), valor: entero(economia.stockGastable) },
        // Si esto sube mucho, o hay farmeo o el tope está mal puesto.
        { etiqueta: t('admin.economia.pctTope'), valor: porcentaje(economia.pctUsuariosEnTope) },
      ]}
    />
  ) : null

  const tarjetas = crisisPrimero
    ? [tarjetaCrisis, tarjetaReciprocidad, tarjetaTtpr, tarjetaActivacion, tarjetaEconomia]
    : [tarjetaReciprocidad, tarjetaTtpr, tarjetaCrisis, tarjetaActivacion, tarjetaEconomia]

  const hayDatos = reciprocidad.serie.length > 0

  return (
    <section>
      <h1>{t('admin.titulo')}</h1>
      <p>
        {t('admin.panel.cabecera', {
          dias: DIAS_VENTANA_KPI,
          fecha: fecha(resumen.calculadoEn),
          rol: contexto.rol,
        })}
      </p>

      {!hayDatos ? (
        <Tarjeta como="section">
          <EstadoVacio
            titulo={t('admin.panel.vacioTitulo')}
            descripcion={t('admin.panel.vacioDescripcion')}
          />
        </Tarjeta>
      ) : null}

      {tarjetas}
    </section>
  )
}
