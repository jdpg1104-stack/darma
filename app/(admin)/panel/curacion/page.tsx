// ============================================================================
// /panel/curacion — la pantalla que faltaba. SERVER COMPONENT.
//
// ── QUÉ AGUJERO TAPA ───────────────────────────────────────────────────────
// `content_items` nace en `pending` y NADA lo pasa a `approved` solo. Eso está
// bien diseñado: contenido que alguien verá en su peor noche no se publica sin
// que una persona lo mire. Lo que faltaba era el sitio donde mirarlo. Hasta hoy
// la única forma de aprobar era un `UPDATE` a mano, y lo que ocurrió de verdad
// fue exactamente eso: 30 vídeos aprobados en bloque sin abrir ninguno.
//
// Una regla que solo se puede cumplir saltándosela no es una regla.
//
// ── LA CONSULTA VIVE AQUÍ, NO EN EL CLIENTE ────────────────────────────────
// La primera cola se sirve ya renderizada: la pantalla no parpadea y, sobre
// todo, no depende de que el `fetch` inicial funcione para poder enseñar algo.
// El componente cliente solo necesita red para DECIDIR, que es cuando la
// persona ya está delante.
//
// ⛔ SIN `<Suspense>`. Ver app/SIN-LOADING.md: el layout raíz es asíncrono y
// cualquier límite de Suspense por debajo mata la hidratación de esa rama — y
// aquí eso significaría botones que no envían nada, en la única pantalla cuyo
// propósito entero es pulsar botones.
// ============================================================================

import type { Metadata } from 'next'
import Link from 'next/link'

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { CLIP_MAX_S, CLIP_MIN_S } from '@/lib/video/acreditacion'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import { ColaCuracion, type Cola, type ItemPendiente } from './ColaCuracion.tsx'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Mismo techo que la ruta de API: una pantalla no es un volcado. */
const LIMITE_COLA = 40

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return { title: t('admin.curacion.titulo'), robots: { index: false, follow: false } }
}

interface FilaPendiente {
  id: string
  source: string
  title: string
  summary: string | null
  url: string
  language: string
  topic: string | null
  duration_seconds: number | null
}

/** `?cola=recorte` y nada más. Un valor desconocido cae en la cola normal. */
function colaDe(valor: string | string[] | undefined): Cola {
  return valor === 'recorte' ? 'recorte' : 'pendientes'
}

export default async function PaginaCuracion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await requireAdmin('moderador', { limite: 'lectura', accion: ACCIONES.curacionCola })

  const locale = await resolverLocale()
  const t = obtenerTraductor(locale)
  const admin = createAdminClient()
  const cola = colaDe((await searchParams).cola)

  const CAMPOS = 'id, source, title, summary, url, language, topic, duration_seconds'

  // Las dos colas, escritas enteras. Mismo criterio que en la ruta de API: los
  // tipos del constructor de consultas cambian con cada `.eq()`, y compartir el
  // encadenado obliga a un `as never` que apaga la comprobación.
  const seleccion =
    cola === 'recorte'
      ? admin
          .from('content_items')
          .select(CAMPOS)
          .eq('state', 'approved')
          .is('clip_start_seconds', null)
          .gt('duration_seconds', CLIP_MAX_S)
      : admin.from('content_items').select(CAMPOS).eq('state', 'pending')

  const { data } = await seleccion.order('created_at', { ascending: true }).limit(LIMITE_COLA)

  const conteo =
    cola === 'recorte'
      ? admin
          .from('content_items')
          .select('id', { count: 'exact', head: true })
          .eq('state', 'approved')
          .is('clip_start_seconds', null)
          .gt('duration_seconds', CLIP_MAX_S)
      : admin.from('content_items').select('id', { count: 'exact', head: true }).eq('state', 'pending')

  const { count } = await conteo

  const items: ItemPendiente[] = ((data ?? []) as FilaPendiente[]).map((f) => ({
    id: f.id,
    source: f.source,
    title: f.title,
    summary: f.summary,
    url: f.url,
    language: f.language,
    topic: f.topic,
    duracionSegundos: f.duration_seconds,
  }))

  const enRecorte = cola === 'recorte'

  return (
    <main>
      <h1>{t(enRecorte ? 'admin.curacion.tituloRecorte' : 'admin.curacion.titulo')}</h1>
      <p>{t(enRecorte ? 'admin.curacion.introRecorte' : 'admin.curacion.intro')}</p>

      {/* Enlaces y no pestañas con estado: son dos URLs distintas, y así el
          moderador puede dejar una abierta en cada una. */}
      <nav>
        <Link href="/panel/curacion" aria-current={enRecorte ? undefined : 'page'}>
          {t('admin.curacion.colaPendientes')}
        </Link>{' '}
        ·{' '}
        <Link href="/panel/curacion?cola=recorte" aria-current={enRecorte ? 'page' : undefined}>
          {t('admin.curacion.colaRecorte')}
        </Link>
      </nav>

      {items.length > 0 ? <p>{t('admin.curacion.mostrando', { n: items.length })}</p> : null}
      <ColaCuracion
        inicial={items}
        total={count ?? 0}
        locale={locale}
        cola={cola}
        minSegundos={CLIP_MIN_S}
        maxSegundos={CLIP_MAX_S}
      />
    </main>
  )
}
