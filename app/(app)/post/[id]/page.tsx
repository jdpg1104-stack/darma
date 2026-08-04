// ============================================================================
// /post/[id] — el hilo. Server Component.
//
// ── PRESUPUESTO: TRES CONSULTAS ────────────────────────────────────────────
//  1. `mi_sesion()`, vía `getContextoSesion()` — memoizada por petición, así
//     que el layout, la página y cualquier componente comparten UNA.
//  2. El post + su autor, unidos por PK dentro de la misma consulta.
//  3. La primera página de comentarios, con el autor de cada uno unido por PK
//     (`idx_comments_post_keyset`). CERO N+1: el alias y el nivel de cada
//     comentarista salen del `join`, no de una consulta por fila.
//
// ── `generateMetadata` NO LLEVA EL CUERPO DEL POST ─────────────────────────
// Ni en `og:description`, ni en `description`, ni truncado. El texto de un
// desahogo acabaría en la tarjeta de previsualización de cualquier chat donde
// se pegue el enlace, y eso lo lee gente a la que nadie invitó. Se pierde
// «engagement» y se gana lo único que importa aquí.
//
// ── UN POST QUE NO SE PUEDE VER ES UN 404, SIEMPRE ─────────────────────────
// No existe, está retirado, o RLS lo oculta porque su autor está en
// shadow-ban: la respuesta es la misma. Distinguir «retirado» de «no existe»
// le confirma a quien sondea que ese uuid fue real, y en una red anónima eso
// ya es información sobre una persona.
// ============================================================================

import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { createClient } from '@/lib/supabase/server'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { getContextoSesion } from '@/lib/auth/session'
import { ListaComentarios, PostCompleto, BotonApoyo } from '@/components/thread'
import { leerHilo } from '@/app/api/comments/consulta'
import { perfilDeAutor, type FilaAutor } from '@/app/api/comments/dominio'
import { LIMITE_POR_DEFECTO } from '@/app/api/comments/validacion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('hilo.metaTitulo'),
    // Genérica a propósito. Ver la cabecera.
    description: t('hilo.metaDescripcion'),
    robots: { index: false, follow: false },
  }
}

interface FilaPost {
  id: string
  body: string
  author_id: string
  upvote_count: number
  reply_count: number
  created_at: string
  autor: FilaAutor | FilaAutor[] | null
}

async function Hilo({ postId }: { postId: string }) {
  const contexto = await getContextoSesion()
  if (!contexto) notFound()
  const userId = contexto.sesion.userId

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('posts')
    .select(
      'id, body, author_id, upvote_count, reply_count, created_at, ' +
        'autor:profiles!posts_author_id_fkey(id, alias, avatar_seed, level, karma_reputation, availability)',
    )
    .eq('id', postId)
    .eq('state', 'active')
    .maybeSingle()

  if (error || !data) notFound()

  const post = data as unknown as FilaPost
  const autorFila = Array.isArray(post.autor) ? post.autor[0] : post.autor
  if (!autorFila) notFound()

  const pagina = await leerHilo(supabase, {
    postId,
    userId,
    limite: LIMITE_POR_DEFECTO,
    cursor: null,
  })

  const esMio = post.author_id === userId

  return (
    <>
      <PostCompleto
        autor={perfilDeAutor(autorFila)}
        body={post.body}
        creadoEn={post.created_at}
        // `posts.reply_count`, que cuenta SOLO los validados. Nunca un
        // `count(*)` sobre `comments`.
        escuchas={post.reply_count}
        apoyos={post.upvote_count}
        acciones={<BotonApoyo postId={post.id} apoyosIniciales={post.upvote_count} />}
      />

      <ListaComentarios
        postId={post.id}
        inicial={pagina}
        soyAutorDelPost={esMio}
        // Nadie comenta su propio post: el crédito de escucha se gana
        // acompañando a otra persona, no a uno mismo. La ruta lo rechaza con
        // `sin_permiso`; aquí simplemente no se ofrece.
        puedeResponder={!esMio}
      />
    </>
  )
}

// ⛔ NO ENVUELVAS ESTO EN <Suspense>. Ver app/SIN-LOADING.md: el layout raíz es
// asíncrono y suspende en TODAS las peticiones, así que con un límite de
// Suspense por debajo React nunca completa el intercambio del fallback. El
// contenido se queda en el DOM dentro de un `div` con `display:none`, la
// hidratación no arranca, y el formulario de responder —la acción que define
// Darma— no envía nada. Aquí lo tuvo hasta que se recorrió la app a mano.
export default async function PaginaPost({ params }: Props) {
  const { id } = await params

  return (
    <main>
      <Hilo postId={id} />
    </main>
  )
}
