// ============================================================================
// /panel/reciprocidad — la serie diaria del KPI que manda. SERVER COMPONENT.
//
// 90 días leídos de `admin_metrics_daily`. Una fila por día: la consulta lee
// como mucho 90 filas por la clave primaria, no agrega nada y no toca ni
// `posts` ni `comments`.
//
// Cero `count(*)` para el total y cero `OFFSET`: la ventana ya acota, y cuando
// haga falta bajar al evento individual será por keyset sobre `(created_at, id)`
// (CONTRATOS §5).
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import {
  DIAS_VENTANA_DETALLE,
  UMBRAL_RECIPROCIDAD,
  getSaludReciprocidad,
  leerRollup,
  ratio,
  ventanaDias,
} from '../../_lib/dashboard.ts'
import { Sparkline } from '../../_componentes/Sparkline.tsx'
import { TablaSerie } from '../../_componentes/TablaSerie.tsx'
import { decimal, entero, porcentaje } from '../../_componentes/Formato.ts'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export default async function PaginaReciprocidad() {
  await requireAdmin('soporte', { accion: `${ACCIONES.panel}.reciprocidad` })

  const t = obtenerTraductor(await resolverLocale())
  const admin = createAdminClient()
  const filas = await leerRollup(admin, ventanaDias(DIAS_VENTANA_DETALLE))
  const salud = getSaludReciprocidad(filas)

  return (
    <section>
      <h1>{t('admin.reciprocidad.titulo')}</h1>
      <p>{t('admin.reciprocidad.explicacion', { umbral: UMBRAL_RECIPROCIDAD })}</p>
      <p>
        {t('admin.reciprocidad.ratioVentana')} <strong>{decimal(salud.ratioReciprocidad)}</strong>
      </p>

      <Sparkline
        valores={salud.serie.map((p) => p.ratio)}
        umbral={UMBRAL_RECIPROCIDAD}
        titulo={t('admin.reciprocidad.sparkline', { dias: salud.serie.length })}
        alto={80}
      />

      <TablaSerie
        titulo={t('admin.tabla.serieDiaria', { dias: DIAS_VENTANA_DETALLE })}
        columnas={[
          { clave: 'dia', etiqueta: t('admin.tabla.dia') },
          { clave: 'ratio', etiqueta: t('admin.tabla.ratio') },
          { clave: 'escuchas', etiqueta: t('admin.tabla.escuchasValidadas') },
          { clave: 'posts', etiqueta: t('admin.tabla.publicaciones') },
          { clave: 'validacion', etiqueta: t('admin.tabla.tasaValidacion') },
          { clave: 'cobertura', etiqueta: t('admin.tabla.cobertura24h') },
        ]}
        filas={filas.map((f) => {
          const escuchas = Number(f.metricas.escuchas_validadas ?? 0)
          const posts = Number(f.metricas.posts_publicados ?? 0)
          const comentarios = Number(f.metricas.comentarios_totales ?? 0)
          const cubiertos = Number(f.metricas.posts_con_escucha_24h ?? 0)
          return {
            dia: f.dia,
            ratio: decimal(ratio(escuchas, posts)),
            escuchas: entero(escuchas),
            posts: entero(posts),
            validacion: porcentaje(ratio(escuchas, comentarios)),
            cobertura: porcentaje(ratio(cubiertos, posts)),
          }
        })}
      />
    </section>
  )
}
