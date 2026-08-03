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

  const admin = createAdminClient()
  const filas = await leerRollup(admin, ventanaDias(DIAS_VENTANA_DETALLE))
  const embudo = getEmbudoActivacion(filas)

  const escalones = [
    { etiqueta: '1 · Registro', n: embudo.registrados },
    { etiqueta: '2 · Onboarding completo', n: embudo.onboardingCompleto },
    { etiqueta: '3 · Primera lectura de un post', n: embudo.primeraLectura },
    { etiqueta: '4 · Primer comentario validado', n: embudo.primerComentarioValidado },
    { etiqueta: '5 · Primera publicación', n: embudo.primeraPublicacion },
    { etiqueta: '6 · Vuelta en D7', n: embudo.vueltaD7 },
  ]

  return (
    <section>
      <h1>Activación</h1>
      <p>
        Cohorte de las personas registradas en los últimos {DIAS_VENTANA_DETALLE} días. Los
        cortes con menos de 20 personas se muestran como «&lt;20»: un agregado con n pequeño
        es un dato personal disfrazado de conteo.
      </p>
      <p>
        Nota de medición: el escalón «primera lectura» se aproxima con la primera interacción
        con un post (un voto). No hay tabla de lecturas en el esquema, así que este escalón
        subestima. Pedido abierto a B02 en PEDIDOS.md.
      </p>

      <TablaSerie
        titulo="Embudo de la ventana"
        columnas={[
          { clave: 'escalon', etiqueta: 'Escalón' },
          { clave: 'personas', etiqueta: 'Personas' },
          { clave: 'conversion', etiqueta: 'Sobre el registro' },
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
        titulo={`Serie diaria de los últimos ${DIAS_VENTANA_DETALLE} días`}
        columnas={[
          { clave: 'dia', etiqueta: 'Día' },
          { clave: 'registrados', etiqueta: 'Registro' },
          { clave: 'onboarding', etiqueta: 'Onboarding' },
          { clave: 'lectura', etiqueta: 'Lectura' },
          { clave: 'validado', etiqueta: 'Comentario validado' },
          { clave: 'publicacion', etiqueta: 'Publicación' },
          { clave: 'd7', etiqueta: 'Vuelta D7' },
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
