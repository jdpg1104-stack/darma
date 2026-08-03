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

  const admin = createAdminClient()
  const filas = await leerRollup(admin, ventanaDias(DIAS_VENTANA_DETALLE))
  const salud = getSaludReciprocidad(filas)

  return (
    <section>
      <h1>Reciprocidad</h1>
      <p>
        Escuchas validadas por publicación. El umbral es {UMBRAL_RECIPROCIDAD} porque cada
        publicación consume {UMBRAL_RECIPROCIDAD} escuchas: no es un número de vanidad, es
        la aritmética del producto.
      </p>
      <p>
        Ratio de la ventana: <strong>{decimal(salud.ratioReciprocidad)}</strong>
      </p>

      <Sparkline
        valores={salud.serie.map((p) => p.ratio)}
        umbral={UMBRAL_RECIPROCIDAD}
        titulo={`Ratio de reciprocidad, últimos ${salud.serie.length} días.`}
        alto={80}
      />

      <TablaSerie
        titulo={`Serie diaria de los últimos ${DIAS_VENTANA_DETALLE} días`}
        columnas={[
          { clave: 'dia', etiqueta: 'Día' },
          { clave: 'ratio', etiqueta: 'Ratio' },
          { clave: 'escuchas', etiqueta: 'Escuchas validadas' },
          { clave: 'posts', etiqueta: 'Publicaciones' },
          { clave: 'validacion', etiqueta: 'Tasa de validación' },
          { clave: 'cobertura', etiqueta: 'Posts con escucha en 24 h' },
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
