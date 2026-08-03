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
  const admin = createAdminClient()
  const resumen = await getResumenPanel(admin, ventanaDias(DIAS_VENTANA_KPI))

  const { reciprocidad, ttpr, crisis, activacion, economia } = resumen

  const crisisPrimero =
    crisis.masAntiguoPendienteSegundos !== null &&
    crisis.masAntiguoPendienteSegundos > LIMITE_PENDIENTE_CRISIS_SEGUNDOS

  const tarjetaCrisis = cumpleRol(contexto.rol, 'moderador') ? (
    <TarjetaMetrica
      key="crisis"
      titulo="Cobertura de revisión de crisis"
      valor={porcentaje(crisis.cobertura)}
      descripcion={
        crisis.cobertura < 1
          ? 'Cualquier valor distinto de 100 % es un incidente, no una métrica.'
          : 'Todos los casos de riesgo alto o crítico de la ventana los ha revisado una persona.'
      }
      semaforo={crisis.semaforo}
      detalles={[
        { etiqueta: 'Eventos de riesgo alto o crítico', valor: entero(crisis.eventos) },
        { etiqueta: 'Revisados por una persona', valor: entero(crisis.revisados) },
        { etiqueta: 'En cola ahora mismo', valor: entero(crisis.pendientes) },
        { etiqueta: 'El más antiguo sin atender', valor: duracion(crisis.masAntiguoPendienteSegundos) },
        { etiqueta: 'p95 de atención', valor: duracion(crisis.p95AtencionSegundos) },
      ]}
    />
  ) : null

  const tarjetaReciprocidad = (
    <TarjetaMetrica
      key="reciprocidad"
      titulo="Salud del bucle de reciprocidad"
      valor={decimal(reciprocidad.ratioReciprocidad)}
      descripcion={`Escuchas validadas por publicación en ${DIAS_VENTANA_KPI} días. Cada publicación consume ${UMBRAL_RECIPROCIDAD}: por debajo de ese número la comunidad solo publica a costa de las primeras publicaciones gratuitas de quien acaba de llegar.`}
      semaforo={reciprocidad.semaforo}
      detalles={[
        { etiqueta: 'Escuchas validadas', valor: entero(reciprocidad.escuchasValidadas) },
        { etiqueta: 'Publicaciones', valor: entero(reciprocidad.postsPublicados) },
        // Si esta cae, es el clasificador el que se ha roto, no la gente.
        { etiqueta: 'Tasa de validación', valor: porcentaje(reciprocidad.tasaValidacion) },
        { etiqueta: 'Posts con escucha en 24 h', valor: porcentaje(reciprocidad.coberturaPosts24h) },
      ]}
    >
      <Sparkline
        valores={reciprocidad.serie.map((p) => p.ratio)}
        umbral={UMBRAL_RECIPROCIDAD}
        titulo={`Ratio de reciprocidad de los últimos ${reciprocidad.serie.length} días. Umbral ${UMBRAL_RECIPROCIDAD}.`}
      />
    </TarjetaMetrica>
  )

  const tarjetaTtpr = (
    <TarjetaMetrica
      key="ttpr"
      titulo="Tiempo hasta la primera respuesta"
      valor={duracion(ttpr.p50Segundos)}
      descripcion="Mediana de lo que tarda alguien en recibir la primera respuesta. Objetivo: p50 por debajo de 15 min y p90 por debajo de 2 h."
      semaforo={ttpr.semaforo}
      detalles={[
        { etiqueta: 'p90', valor: duracion(ttpr.p90Segundos) },
        // El desglose que de verdad duele: quien está peor debe esperar menos.
        { etiqueta: 'p50 en posts de riesgo alto o crítico', valor: duracion(ttpr.p50SegundosRiesgo) },
        { etiqueta: 'Sin ninguna respuesta en 24 h', valor: entero(ttpr.postsSinRespuesta24h) },
      ]}
    >
      <Sparkline
        valores={ttpr.serie.map((p) => p.p50)}
        titulo={`Mediana diaria del tiempo hasta la primera respuesta, últimos ${ttpr.serie.length} días.`}
      />
    </TarjetaMetrica>
  )

  const tarjetaActivacion = (
    <TarjetaMetrica
      key="activacion"
      titulo="Embudo de activación"
      valor={enmascarar(activacion.registrados)}
      descripcion="Personas registradas en la ventana y hasta dónde llegaron. El escalón que hay que vigilar es el cuarto: quien no consigue un comentario validado nunca podrá publicar, y se va."
      detalles={[
        { etiqueta: '1 · Registro', valor: enmascarar(activacion.registrados) },
        { etiqueta: '2 · Onboarding completo', valor: enmascarar(activacion.onboardingCompleto) },
        { etiqueta: '3 · Primera lectura', valor: enmascarar(activacion.primeraLectura) },
        { etiqueta: '4 · Primer comentario validado', valor: enmascarar(activacion.primerComentarioValidado) },
        { etiqueta: '5 · Primera publicación', valor: enmascarar(activacion.primeraPublicacion) },
        { etiqueta: '6 · Vuelta en D7', valor: enmascarar(activacion.vueltaD7) },
      ]}
    />
  )

  const tarjetaEconomia = cumpleRol(contexto.rol, 'operaciones') ? (
    <TarjetaMetrica
      key="economia"
      titulo="Economía"
      valor={euros(economia.ingresoCentimos)}
      descripcion={
        economia.ingresoEstimado
          ? 'Ingreso PARCIALMENTE ESTIMADO: crystal_ledger no guarda el precio, así que las compras sin recibo se valoran con el mapa de precios provisional de este bloque. Pendiente de que B12 exponga el catálogo real.'
          : 'Ingreso derivado de los recibos reales de la tienda.'
      }
      detalles={[
        { etiqueta: 'ARPPU', valor: euros(economia.arppuCentimos) },
        { etiqueta: 'Compradores únicos (cota superior)', valor: enmascarar(economia.compradoresUnicos) },
        { etiqueta: 'Cristales vendidos', valor: entero(economia.cristalesVendidos) },
        { etiqueta: 'Karma emitido', valor: entero(economia.karmaEmitido) },
        { etiqueta: 'Karma drenado', valor: entero(economia.karmaDrenado) },
        { etiqueta: 'Stock gastable', valor: entero(economia.stockGastable) },
        // Si esto sube mucho, o hay farmeo o el tope está mal puesto.
        { etiqueta: 'Personas que topan el límite diario', valor: porcentaje(economia.pctUsuariosEnTope) },
      ]}
    />
  ) : null

  const tarjetas = crisisPrimero
    ? [tarjetaCrisis, tarjetaReciprocidad, tarjetaTtpr, tarjetaActivacion, tarjetaEconomia]
    : [tarjetaReciprocidad, tarjetaTtpr, tarjetaCrisis, tarjetaActivacion, tarjetaEconomia]

  const hayDatos = reciprocidad.serie.length > 0

  return (
    <section>
      <h1>Centro de mando</h1>
      <p>
        Ventana de {DIAS_VENTANA_KPI} días · calculado el {fecha(resumen.calculadoEn)} · rol{' '}
        {contexto.rol}
      </p>

      {!hayDatos ? (
        <Tarjeta como="section">
          <EstadoVacio
            titulo="Todavía no hay ningún día calculado"
            descripcion="El rollup diario aún no ha corrido para esta ventana. Se puede lanzar a mano desde /api/admin/rollup si tienes rol de operaciones."
          />
        </Tarjeta>
      ) : null}

      {tarjetas}
    </section>
  )
}
