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
// ── TODO ENMASCARADO POR DEBAJO DE 20 ──────────────────────────────────────
// Cada celda pasa por `enmascarar()`. Un embudo de un día flojo puede tener
// cortes de 3 personas, y un agregado con n=3 más un poco de contexto externo
// señala a alguien concreto. Aquí se muestra «<20» y no se discute.
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import {
  DIAS_VENTANA_DETALLE,
  enmascarar,
  getEmbudoActivacion,
  leerRollup,
  ratio,
  ventanaDias,
} from '../../_lib/dashboard.ts'
import { TablaSerie } from '../../_componentes/TablaSerie.tsx'
import { porcentaje } from '../../_componentes/Formato.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function PaginaActivacion() {
  await requireAdmin('soporte', { accion: `${ACCIONES.panel}.activacion` })

  const t = obtenerTraductor(await resolverLocale())
  const admin = createAdminClient()
  const filas = await leerRollup(admin, ventanaDias(DIAS_VENTANA_DETALLE))
  const embudo = getEmbudoActivacion(filas)

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
