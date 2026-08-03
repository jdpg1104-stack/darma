import { expect, omitirSinAdmin, test } from '../fixtures'
import { PerfilPage } from '../paginas/PerfilPage'

// ============================================================================
// Recorrido (e) · nadie ve el karma gastable ni los cristales de otro.
//
// Tres capas, en orden de dureza creciente. La tercera es la única que refleja
// el modelo de amenaza real de este proyecto: la anon key va en el bundle por
// diseño, así que cualquiera puede hablar con PostgREST directamente. Una regla
// que solo viva en la UI no es una regla, es una sugerencia.
//
// NOTA SOBRE LA TRAMPA #1 DE LA FICHA. La ficha avisaba de que este test iba a
// fallar porque `profiles_read ... using (true)` no restringe columnas. Se ha
// comprobado contra `darma-dev` y YA ESTÁ ARREGLADO: 0001_core.sql lleva
// `revoke select on public.profiles from anon, authenticated` seguido de un
// `grant select (id, alias, avatar_seed, bio, karma_reputation, level,
// availability, created_at, last_seen_at)`. Verificado con una sesión real:
// pedir `karma_spendable` de otra persona devuelve 42501. Por eso el test va
// como test de verdad y no como `fixme`: marcarlo como pendiente cuando el
// agujero está cerrado sería dejar sin vigilancia la línea que lo cierra.
// ============================================================================

const CAMPOS_PRIVADOS = [
  'karma_spendable',
  'crystals',
  'listen_credits',
  'daily_karma_earned',
  'shadow_banned',
] as const

test.describe('(e) El karma gastable y los cristales son privados', () => {
  omitirSinAdmin()

  // ── Capa 1 · la UI ──────────────────────────────────────────────────────
  test('B abre el perfil de A y no ve su panel privado', async ({
    paginaDeOtro,
    usuario,
  }) => {
    const perfil = new PerfilPage(paginaDeOtro)
    await perfil.irAPerfilDe(usuario.id)

    // El panel «Solo tú ves esto» no existe en un perfil ajeno. Ni oculto.
    await expect(perfil.panelPrivado).toHaveCount(0)

    const html = await perfil.htmlCompleto()
    for (const campo of CAMPOS_PRIVADOS) {
      expect(html).not.toContain(campo)
    }
    expect(html).not.toContain('Karma gastable')
    expect(html).not.toContain('Cristales')
  })

  test('en SU propio perfil, B sí ve su panel privado (control positivo)', async ({
    paginaDeOtro,
  }) => {
    // Sin este control, el test de arriba pasaría igual si el panel privado
    // estuviera roto y no se pintara nunca.
    const perfil = new PerfilPage(paginaDeOtro)
    await perfil.ir()
    await expect(perfil.panelPrivado).toBeVisible()
  })

  // ── Capa 2 · la API ─────────────────────────────────────────────────────
  // ── Camino de fallo nº 9 ────────────────────────────────────────────────
  test('GET /api/me con ?userId=<A> ignora el parámetro y responde con los datos de B', async ({
    paginaDeOtro,
    usuario,
    otroUsuario,
  }) => {
    await paginaDeOtro.goto('/feed')
    const respuesta = await paginaDeOtro.request.get(`/api/me?userId=${usuario.id}`)

    expect(respuesta.status()).toBe(200)
    const cuerpo = (await respuesta.json()) as {
      data: { perfil: { id: string; alias: string } }
    }

    // CONTRATOS §6: el userId viene SIEMPRE de la sesión, NUNCA del cliente.
    // Aceptar un id del query string es la vulnerabilidad más común de este
    // tipo de app.
    expect(cuerpo.data.perfil.id).toBe(otroUsuario.id)
    expect(cuerpo.data.perfil.id).not.toBe(usuario.id)
    expect(cuerpo.data.perfil.alias).toBe(otroUsuario.alias)
  })

  // ── Capa 3 · PostgREST. La que de verdad importa ────────────────────────
  // ── Camino de fallo nº 8 ────────────────────────────────────────────────
  test('PostgREST con el token de B no devuelve karma_spendable ni crystals de A', async ({
    request,
    usuario,
    otroUsuario,
  }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const respuesta = await request.get(
      `${url}/rest/v1/profiles?id=eq.${usuario.id}&select=karma_spendable,crystals`,
      { headers: { apikey: anon, authorization: `Bearer ${otroUsuario.accessToken}` } },
    )

    const texto = await respuesta.text()

    // Vale un 403 (privilegio de columna denegado, que es lo que hace hoy) o un
    // 200 con `[]`. Lo que NO vale es que salga un número.
    const bloqueado = !respuesta.ok() || texto.trim() === '[]'
    expect(bloqueado, `PostgREST ha devuelto: ${texto.slice(0, 200)}`).toBe(true)
    expect(texto).not.toMatch(/"karma_spendable"\s*:\s*\d/)
    expect(texto).not.toMatch(/"crystals"\s*:\s*\d/)
  })

  test('ni siquiera sobre su PROPIA fila puede B leer los campos privados', async ({
    request,
    otroUsuario,
  }) => {
    // El privilegio de columna no distingue de quién es la fila: la única
    // puerta a los saldos propios es la RPC `mi_perfil_privado()`, filtrada por
    // auth.uid(). Que no haya excepción para «lo mío» es lo que impide que un
    // `where` mal editado mañana lo convierta en una fuga.
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const respuesta = await request.get(
      `${url}/rest/v1/profiles?id=eq.${otroUsuario.id}&select=karma_spendable`,
      { headers: { apikey: anon, authorization: `Bearer ${otroUsuario.accessToken}` } },
    )
    const texto = await respuesta.text()
    expect(!respuesta.ok() || texto.trim() === '[]').toBe(true)
  })

  test('CONTROL: el perfil PÚBLICO de A sí se lee (los perfiles son anónimos)', async ({
    request,
    usuario,
    otroUsuario,
  }) => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

    const respuesta = await request.get(
      `${url}/rest/v1/profiles?id=eq.${usuario.id}&select=id,alias,karma_reputation,level`,
      { headers: { apikey: anon, authorization: `Bearer ${otroUsuario.accessToken}` } },
    )

    expect(respuesta.ok()).toBe(true)
    const filas = (await respuesta.json()) as Array<{ alias: string }>
    expect(filas).toHaveLength(1)
    expect(filas[0]!.alias).toBe(usuario.alias)
  })
})
