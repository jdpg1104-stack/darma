import { LISTENS_PER_POST } from '@/lib/reciprocity'
import { KARMA_WEIGHTS } from '@/lib/karma'
import { expect, omitirSinAdmin, test } from '../fixtures'
import { HiloPage } from '../paginas/HiloPage'
import { PublicarPage } from '../paginas/PublicarPage'
import { comentarioDeApoyo } from '../utils/textos'

// ============================================================================
// Recorrido (b) · el bucle completo: 3 escuchas validadas → publicar desbloqueado.
//
// Es la regla que define Darma y atraviesa navegador, API, RLS y triggers de
// Postgres. Ninguna prueba unitaria puede verificarla: el crédito lo acredita
// `trg_comments_validated` y lo cobra `trg_posts_reciprocity`, y entre los dos
// hay una transacción, un índice único parcial y un tope diario.
//
// ⚠️ Sin `MODERATION_API_KEY` el clasificador no responde y NINGÚN comentario se
// valida solo: el sistema falla cerrado por diseño. Por eso los comentarios se
// escriben POR LA UI (que es lo que se prueba) y se validan después desde el
// fixture con service_role, que es lo que dispara el trigger REAL.
// ============================================================================

test.describe('(b) El bucle de reciprocidad', () => {
  omitirSinAdmin()

  test('tres escuchas validadas desbloquean publicar y el contador va 0/3 → 3/3', async ({
    page,
    usuario,
    sembrarPosts,
    validarComentario,
    agotarEscuchas,
    creditosDe,
  }) => {
    // El primer post es GRATIS. Para que el gate exista hay que haberlo gastado.
    await agotarEscuchas(usuario)
    expect(await creditosDe(usuario)).toBe(0)

    const publicar = new PublicarPage(page)
    await publicar.ir()
    expect(await publicar.escuchasHechas()).toBe(0)
    await expect(
      publicar.mensajeParaEstado({ listenCredits: 0, postsPublished: 1 }),
    ).toBeVisible()

    const posts = await sembrarPosts(LISTENS_PER_POST)
    const hilo = new HiloPage(page)

    for (let i = 0; i < posts.length; i += 1) {
      await hilo.irAPost(posts[i]!)
      const comentarioId = await hilo.comentar(comentarioDeApoyo(i + 1))
      expect(comentarioId).toBeTruthy()

      // Sin clasificador el comentario nace sin validar: el contador NO se mueve
      // todavía. Esta comprobación intermedia es la que distingue «el bucle
      // funciona» de «el bucle suma por escribir».
      expect(await creditosDe(usuario)).toBe(i)

      await validarComentario(comentarioId!)
      expect(await creditosDe(usuario)).toBe(i + 1)

      await publicar.ir()
      expect(await publicar.escuchasHechas()).toBe(Math.min(i + 1, LISTENS_PER_POST))
    }

    // 3/3: el botón se habilita y el copy es el de lib/reciprocity.ts.
    await expect(
      publicar.mensajeParaEstado({ listenCredits: LISTENS_PER_POST, postsPublished: 1 }),
    ).toBeVisible()
    expect(await publicar.botonHabilitado()).toBe(true)
  })

  // ── Camino de fallo nº 2 ────────────────────────────────────────────────
  test('tres comentarios validados AL MISMO post dan UNA escucha, no tres', async ({
    page,
    usuario,
    sembrarPosts,
    validarComentario,
    agotarEscuchas,
    creditosDe,
  }) => {
    await agotarEscuchas(usuario)
    const [postId] = await sembrarPosts(1)

    const hilo = new HiloPage(page)
    const ids: string[] = []
    for (let i = 0; i < LISTENS_PER_POST; i += 1) {
      await hilo.irAPost(postId!)
      const id = await hilo.comentar(comentarioDeApoyo(100 + i))
      if (id) ids.push(id)
    }

    // Lo impide `uq_comments_one_listen_per_post (post_id, author_id) where
    // is_validated`: el segundo `update` choca con 23505 y no acredita. Que
    // alguno falle es el comportamiento correcto, no un fallo del test.
    for (const id of ids) {
      await validarComentario(id).catch(() => undefined)
    }

    expect(await creditosDe(usuario)).toBe(1)

    const publicar = new PublicarPage(page)
    await publicar.ir()
    expect(await publicar.escuchasHechas()).toBe(1)
    expect(await publicar.botonHabilitado()).toBe(false)
  })

  // ── Camino de fallo nº 3 ────────────────────────────────────────────────
  test('un comentario NO validado no mueve el contador ni el karma', async ({
    page,
    usuario,
    sembrarPosts,
    agotarEscuchas,
    creditosDe,
    karmaDe,
  }) => {
    await agotarEscuchas(usuario)
    const karmaAntes = await karmaDe(usuario)

    const [postId] = await sembrarPosts(1)
    const hilo = new HiloPage(page)
    await hilo.irAPost(postId!)
    const comentarioId = await hilo.comentar(comentarioDeApoyo(200))
    expect(comentarioId).toBeTruthy()

    // Escribir no paga. Paga que alguien —o algo— juzgue que ese comentario
    // acompañó de verdad.
    expect(await creditosDe(usuario)).toBe(0)
    expect(await karmaDe(usuario)).toBe(karmaAntes)

    const publicar = new PublicarPage(page)
    await publicar.ir()
    expect(await publicar.escuchasHechas()).toBe(0)
    expect(await publicar.botonHabilitado()).toBe(false)
  })

  test('validar un comentario paga exactamente el peso de comment_validated', async ({
    page,
    usuario,
    sembrarPosts,
    validarComentario,
    agotarEscuchas,
    karmaDe,
  }) => {
    await agotarEscuchas(usuario)
    const antes = await karmaDe(usuario)

    const [postId] = await sembrarPosts(1)
    const hilo = new HiloPage(page)
    await hilo.irAPost(postId!)
    const comentarioId = await hilo.comentar(comentarioDeApoyo(300))
    await validarComentario(comentarioId!)

    // El número se IMPORTA de lib/karma.ts. Escribir 10 aquí a mano sería
    // duplicar la economía en un tercer sitio, que es justo lo que prohíbe
    // CONTRATOS §8.
    expect(await karmaDe(usuario)).toBe(antes + KARMA_WEIGHTS.comment_validated.reputation)
  })
})
