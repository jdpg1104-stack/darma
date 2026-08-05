import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ─────────────────────────────────────────────────────────────────────────────
// Darma · proxy (el "middleware" de Next 16 — la convención se renombró de
// middleware.ts a proxy.ts, misma semántica y mismo matcher).
// Ver https://nextjs.org/docs/messages/middleware-to-proxy
//
// Tres trabajos, en este orden:
//   1. Refrescar la sesión de Supabase y propagar las cookies renovadas.
//   2. Cerrar el paso a las rutas privadas (fail-closed: lo que no es público,
//      exige sesión).
//   3. Sellar cada petición con un request-id + nonce para el logging.
//
// Lo que este archivo NO es: la última línea de defensa. La autoridad real está
// en RLS y en los triggers de Postgres (ver supabase/migrations/0001_core.sql).
// Cualquiera puede hablar con PostgREST directamente con la anon key, así que un
// gate que solo viva aquí se salta con un curl. Esto es rendimiento y buena
// experiencia (redirigir antes de renderizar), no seguridad.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rutas alcanzables SIN sesión. Todo lo demás requiere estar autenticado.
 * - '/'            landing pública (explica los 3 niveles y la reciprocidad).
 * - '/entrar'      pantalla de acceso anónimo.
 * - '/auth/'       callback de Supabase Auth (llega sin sesión, por definición).
 * - '/legal'       términos y privacidad: deben leerse ANTES de registrarse.
 * - '/ayuda'       recursos de crisis (teléfonos de emergencia). Una persona en
 *                  riesgo no puede toparse con un muro de login: esta ruta es
 *                  pública por razones que no son técnicas.
 * - '/api/cron/'   disparadores de Vercel Cron: llegan sin navegador ni cookie y
 *                  cada handler se autentica solo con CRON_SECRET (Bearer). Si
 *                  el proxy las cortara con 401 nunca llegarían a validarlo.
 * - '/api/auth/'   las rutas que CREAN la sesión. Exigirles sesión es un
 *                  círculo: no se puede entrar sin haber entrado. Cada handler
 *                  se protege por su cuenta (rate limit por IP y validación),
 *                  que es lo que corresponde a una superficie pre-sesión.
 */
const PUBLIC_ROUTES = [
  '/entrar',
  '/auth/',
  '/api/auth/',
  '/legal',
  '/ayuda',
  '/api/cron/',
  // Construcción de la foto del ranking. Es un disparador programado, no una
  // ruta de usuario: llega sin cookie y se autentica con CRON_SECRET (Bearer),
  // igual que /api/cron/*. Vive fuera de ese prefijo porque el prefijo es de
  // otro bloque, no porque sea distinta. Si el proxy la cortara con 401, el
  // Bearer no llegaría nunca a comprobarse y el ranking se quedaría congelado
  // sin que nada fallara de forma visible.
  '/api/ranking/snapshot',
  // Webhooks de Apple y Google. Llegan de servidor a servidor, sin cookie, y se
  // autentican con la FIRMA del propio mensaje (JWS), que es más fuerte que una
  // sesión. Solo el prefijo `/webhook/`: el resto de `/api/billing/` sí exige
  // sesión.
  //
  // Sin esto la avería es silenciosa y cara: las tiendas reciben un 401,
  // concluyen que el endpoint falla y reintentan durante DÍAS, así que la
  // persona paga y no recibe sus cristales hasta que se le ocurre tocar
  // «Restaurar compras». Nada falla de forma visible en nuestro lado.
  '/api/billing/webhook/',
  '/api/health',
  // Scraper de Prometheus: llega de una máquina, sin cookie, y el handler falla
  // cerrado con su propio Bearer METRICS_TOKEN. Con el proxy delante recibía un
  // 401 antes de poder presentar el token: observabilidad ciega en producción.
  '/api/metrics',
  // Página de caída sin red. El service worker la precachea y la sirve cuando
  // no hay cobertura; debe poder cachearse ANTES de que exista sesión, o la
  // primera visita sin red de alguien no autenticado acaba en un 503 de texto.
  '/offline',
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route))
}

/**
 * Identificador único por petición. Se usa para dos cosas a la vez:
 *  - `x-request-id`: correlacionar las líneas de log de una misma petición
 *    entre el proxy, los Server Components y las rutas de API. Sin esto, en
 *    producción a decenas de peticiones por segundo los logs son ruido.
 *  - `x-nonce`: la semilla del nonce de CSP. Hoy la CSP todavía lleva
 *    'unsafe-inline' (next.config.ts explica por qué), pero el valor ya viaja
 *    en la petición para que migrar a `script-src 'nonce-…'` no obligue a tocar
 *    el proxy otra vez.
 *
 * ⚠️ Nunca derives esto de datos del usuario: en una app anónima, un id de
 * petición estable por persona sería un identificador de seguimiento.
 */
function newRequestId(): string {
  return crypto.randomUUID().replace(/-/g, '')
}

export async function proxy(request: NextRequest) {
  const requestId = newRequestId()

  // Cabeceras que verá el render del servidor. Se clonan porque el objeto
  // original es inmutable.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('x-request-id', requestId)
  requestHeaders.set('x-nonce', requestId)
  // Defensa en profundidad: un cliente NO puede inyectar su propia identidad
  // vía cabecera. Si llega de fuera, se descarta aquí.
  requestHeaders.delete('x-darma-user')

  let response = NextResponse.next({ request: { headers: requestHeaders } })

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Sin credenciales de Supabase no hay sesión que refrescar. Se deja pasar
  // (durante el arranque local o un preview sin variables, la app debe seguir
  // sirviendo la landing en vez de devolver 500 en todas las rutas).
  if (!supabaseUrl || !supabaseKey) {
    response.headers.set('x-request-id', requestId)
    return response
  }

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        // Se escriben en los DOS sitios a propósito: en `request` para que el
        // render de esta misma petición ya vea la sesión renovada, y en la
        // respuesta para que el navegador la guarde. Omitir uno de los dos es
        // el bug clásico de "se cierra la sesión sola cada hora".
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request: { headers: requestHeaders } })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // getClaims() en vez de getUser(): con llaves JWT asimétricas la firma se
  // verifica LOCALMENTE con Web Crypto — cero round-trips a Supabase Auth en el
  // caso normal, frente a uno en CADA petición con getUser(). Si el access token
  // expiró, getClaims() lo refresca contra el servidor y los handlers de arriba
  // propagan las cookies nuevas.
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims ?? null

  const { pathname } = request.nextUrl
  const isPublic = isPublicPath(pathname)

  if (!claims && !isPublic) {
    // Las rutas de API se llaman con fetch y esperan JSON: redirigirlas a una
    // página HTML hace que el cliente reviente al hacer res.json(). 401 real.
    if (pathname.startsWith('/api')) {
      // La MISMA forma del contrato que devuelven todas las rutas
      // (lib/auth/errores.ts, CONTRATOS §4): {ok, code, message}. Este era el
      // último emisor del sobre viejo {error} que B00b retiró del resto del
      // repo; el cliente lee `code`, y un sobre distinto aquí significaba que
      // el 401 del proxy y el 401 de un handler se parseaban diferente.
      return NextResponse.json(
        { ok: false, code: 'no_autenticado', message: 'Necesitas iniciar sesión.' },
        { status: 401, headers: { 'x-request-id': requestId } },
      )
    }
    const loginUrl = new URL('/entrar', request.url)
    loginUrl.searchParams.set('siguiente', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Con sesión iniciada, la pantalla de acceso no tiene sentido.
  if (claims && pathname === '/entrar') {
    return NextResponse.redirect(new URL('/feed', request.url))
  }

  response.headers.set('x-request-id', requestId)
  return response
}

export const config = {
  matcher: [
    // Se excluyen los estáticos del matcher POR RENDIMIENTO: cada petición que
    // entra aquí paga una verificación de JWT. Un feed carga decenas de imágenes
    // e iconos; hacerlas pasar por el gate multiplicaría el trabajo del edge sin
    // proteger nada (lo que hay bajo public/ es público por definición).
    //
    // Se excluye la EXTENSIÓN, no el nombre del archivo: una lista de nombres
    // propios solo protege lo que alguien se acordó de escribir, y el fichero
    // que se cree mañana no estará en ella.
    //
    // `manifest.json` va nombrado aparte y no por su extensión: `.json` a secas
    // dejaría fuera del gate a cualquier ruta que termine en .json, incluidas
    // las de la API. El síntoma que corrige es concreto: sin esta exclusión el
    // navegador pide el manifiesto SIN cookies, el proxy lo redirige a /entrar,
    // y la PWA no se puede instalar desde la landing — que es justo desde donde
    // se instala.
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|manifest.webmanifest|sw.js|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2|txt|xml)$).*)',
  ],
}
