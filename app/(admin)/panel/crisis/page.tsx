// ============================================================================
// /panel/crisis — la cobertura de revisión humana. SERVER COMPONENT.
//
// Esta página existe para poder DEMOSTRAR una cosa: que el 100 % de los eventos
// de riesgo alto o crítico los ha mirado una persona. Cualquier valor distinto
// de 100 % es un incidente abierto, no una métrica con la que convivir.
//
// ⚠️ `crisis_events.human_reviewed` empieza en `false` y nada lo pone a `true`
// solo. Hoy lo escribe `atenderCrisis()` de B11 (`lib/ai/cola.ts`) cuando un
// moderador cierra un caso desde `/moderacion`. Si esta página muestra 0 % con
// eventos en la ventana, lo primero que hay que comprobar NO es esta consulta:
// es si el flujo de moderación está cerrando los casos. Anotado en PEDIDOS.md.
//
// Aquí no se muestra ni el cuerpo del contenido, ni el país, ni el alias de
// nadie: solo agregados y la antigüedad de la cola. Para actuar sobre un caso
// concreto se va a `/moderacion`, que es de B11 y tiene sus propias reglas.
// ============================================================================

import { Chip } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import {
  DIAS_VENTANA_DETALLE,
  LIMITE_PENDIENTE_CRISIS_SEGUNDOS,
  getCoberturaCrisis,
  leerColaCrisisViva,
  leerRollup,
  ratio,
  ventanaDias,
} from '../../_lib/dashboard.ts'
import { TablaSerie } from '../../_componentes/TablaSerie.tsx'
import { duracion, entero, porcentaje } from '../../_componentes/Formato.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function PaginaCrisis() {
  await requireAdmin('moderador', { accion: `${ACCIONES.panel}.crisis` })

  const t = obtenerTraductor(await resolverLocale())
  const admin = createAdminClient()
  const [filas, cola] = await Promise.all([
    leerRollup(admin, ventanaDias(DIAS_VENTANA_DETALLE)),
    leerColaCrisisViva(admin),
  ])
  const crisis = getCoberturaCrisis(filas, cola)

  return (
    <section>
      <h1>{t('admin.crisis.titulo')}</h1>

      <p>
        <strong>{porcentaje(crisis.cobertura)}</strong>{' '}
        <Chip tono={crisis.semaforo === 'verde' ? 'logro' : 'peligro'}>
          {crisis.semaforo === 'verde' ? t('admin.crisis.alDia') : t('admin.crisis.incidente')}
        </Chip>
      </p>

      <p>
        {t('admin.crisis.resumen', {
          revisados: crisis.revisados,
          eventos: crisis.eventos,
          dias: DIAS_VENTANA_DETALLE,
        })}
      </p>

      <dl>
        <div>
          <dt>{t('admin.crisis.enCola')}</dt>
          <dd>{entero(crisis.pendientes)}</dd>
        </div>
        <div>
          <dt>{t('admin.crisis.masAntiguo')}</dt>
          <dd>
            {duracion(crisis.masAntiguoPendienteSegundos)}
            {crisis.masAntiguoPendienteSegundos !== null &&
            crisis.masAntiguoPendienteSegundos > LIMITE_PENDIENTE_CRISIS_SEGUNDOS
              ? t('admin.crisis.porEncimaDelLimite', {
                  minutos: Math.round(LIMITE_PENDIENTE_CRISIS_SEGUNDOS / 60),
                })
              : ''}
          </dd>
        </div>
        <div>
          <dt>{t('admin.crisis.p95')}</dt>
          <dd>{duracion(crisis.p95AtencionSegundos)}</dd>
        </div>
      </dl>

      <TablaSerie
        titulo={t('admin.tabla.serieDiaria', { dias: DIAS_VENTANA_DETALLE })}
        columnas={[
          { clave: 'dia', etiqueta: t('admin.tabla.dia') },
          { clave: 'eventos', etiqueta: t('admin.tabla.eventos') },
          { clave: 'revisados', etiqueta: t('admin.tabla.revisados') },
          { clave: 'cobertura', etiqueta: t('admin.tabla.cobertura') },
          { clave: 'sinAtender', etiqueta: t('admin.tabla.sinAtender') },
        ]}
        filas={filas.map((f) => {
          const eventos = Number(f.metricas.crisis_eventos ?? 0)
          const revisados = Number(f.metricas.crisis_revisados ?? 0)
          return {
            dia: f.dia,
            eventos: entero(eventos),
            revisados: entero(revisados),
            cobertura: eventos > 0 ? porcentaje(ratio(revisados, eventos)) : '—',
            sinAtender: entero(Number(f.metricas.crisis_sin_atender ?? 0)),
          }
        })}
      />
    </section>
  )
}
