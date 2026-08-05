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

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../../api/admin/_guard.ts'
import { ACCIONES } from '../../_lib/acceso.ts'
import { ColaCuracion, type ItemPendiente } from './ColaCuracion.tsx'

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
}

export default async function PaginaCuracion() {
  await requireAdmin('moderador', { limite: 'lectura', accion: ACCIONES.curacionCola })

  const locale = await resolverLocale()
  const t = obtenerTraductor(locale)
  const admin = createAdminClient()

  const { data } = await admin
    .from('content_items')
    .select('id, source, title, summary, url, language, topic')
    .eq('state', 'pending')
    .order('created_at', { ascending: true })
    .limit(LIMITE_COLA)

  const { count } = await admin
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .eq('state', 'pending')

  const items: ItemPendiente[] = ((data ?? []) as FilaPendiente[]).map((f) => ({
    id: f.id,
    source: f.source,
    title: f.title,
    summary: f.summary,
    url: f.url,
    language: f.language,
    topic: f.topic,
  }))

  return (
    <main>
      <h1>{t('admin.curacion.titulo')}</h1>
      <p>{t('admin.curacion.intro')}</p>
      {items.length > 0 ? <p>{t('admin.curacion.mostrando', { n: items.length })}</p> : null}
      <ColaCuracion inicial={items} total={count ?? 0} locale={locale} />
    </main>
  )
}
