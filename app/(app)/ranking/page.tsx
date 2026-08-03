// ============================================================================
// /ranking — Server Component.
//
// PRESUPUESTO: DOS consultas por render, y son exactamente estas dos:
//   1. la página 1 del tablero,
//   2. tu propia fila.
// El podio NO gasta una tercera: sale de las tres primeras filas de la página 1
// que ya está en memoria.
//
// JS de cliente: solo `Tablero` (por el botón «ver más»). El selector de
// periodo, el podio, la insignia de movimiento y tu posición son Server
// Components y envían 0 bytes propios.
//
// Ni un `count(*)`, ni un `OFFSET`, ni una agregación: todo sale de
// `ranking_snapshots`, la foto que construye el cron horario.
// ============================================================================

import type { Metadata } from 'next'

import { MiPosicion, Podio, SelectorPeriodo, Tablero } from '@/components/ranking'
import { CLAVE_PERIODO } from '@/components/ranking/periodos'
import { EstadoVacio } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { requireSesion } from '@/lib/auth/session'
import { consultarMiFila, consultarTablero } from '@/lib/ranking/consulta'
import { inicioPeriodo } from '@/lib/ranking/periodos'
import { esPeriodo, type PeriodoRanking } from '@/lib/ranking/tipos'
import { createClient } from '@/lib/supabase/server'

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('ranking.metaTitulo'),
    description: t('ranking.metaDescripcion'),
  }
}

// Depende de la sesión (tu fila) y de la foto, que cambia cada hora. La caché
// compartida vive en la ruta de API, no aquí: esta página lleva datos propios.
export const dynamic = 'force-dynamic'

interface Props {
  searchParams: Promise<{ periodo?: string }>
}

export default async function PaginaRanking({ searchParams }: Props) {
  // `requireSesion()` primero. Si no hay sesión lanza y el error sube al
  // `error.tsx` del segmento; el proxy además ya habría redirigido antes.
  const sesion = await requireSesion()
  const t = obtenerTraductor(await resolverLocale())
  const { periodo: crudo } = await searchParams

  // Un `?periodo=` inventado no es un error de pantalla: se cae a la semana. Es
  // el caso típico de un enlace viejo o mal copiado, y sacar un 422 a la cara
  // por eso es peor experiencia que enseñar el tablero por defecto.
  const periodo: PeriodoRanking = esPeriodo(crudo) ? crudo : 'semana'
  const corte = inicioPeriodo(periodo)

  const supabase = await createClient()

  // En paralelo: son independientes y encadenarlas sumaría los dos viajes.
  const [tablero, miFila] = await Promise.all([
    consultarTablero(supabase, { periodo, corte }),
    consultarMiFila(supabase, periodo, corte),
  ])

  return (
    <div>
      <h1>{t('ranking.titulo')}</h1>
      {/* La métrica se explica en la propia pantalla. Sin esta línea, el
          tablero parece premiar «actividad» y el mensaje del producto —el
          estatus se gana escuchando, no publicando— se pierde. */}
      <p>
        {t('ranking.intro')} {t(CLAVE_PERIODO[periodo])}.
      </p>

      <SelectorPeriodo activo={periodo} />

      {tablero.items.length === 0 ? (
        <EstadoVacio
          titulo={t('ranking.vacioTitulo')}
          descripcion={t('ranking.vacioDescripcion')}
          tono="cuidado"
        />
      ) : (
        <>
          <Podio filas={tablero.items} />
          <MiPosicion fila={miFila} periodo={periodo} />
          <Tablero periodo={periodo} inicial={tablero} miId={sesion.userId} />
        </>
      )}
    </div>
  )
}
