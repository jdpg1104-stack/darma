// ============================================================================
// GET /api/auth/callback — la vuelta desde el enlace del correo
//
// Hace tres cosas, en este orden, y cada una tiene una decisión detrás:
//
//  1. Canjea el código por sesión (`exchangeCodeForSession`).
//  2. Escribe `identity_vault` con el HASH del contacto y el país. Con el
//     cliente ADMIN, porque esa tabla no tiene ninguna política RLS: es el
//     aislamiento que garantiza que ni un bug de la API pueda filtrar la
//     identidad. Nunca el email; nunca el email; nunca el email.
//  3. Si ese hash ya existía con otro `user_id`, escribe una SEÑAL de
//     moderación y DEJA PASAR A LA PERSONA.
//
// ── POR QUÉ LA MULTICUENTA NO BLOQUEA ──────────────────────────────────────
// En Darma mucha gente entra anónima, vuelve con correo, comparte el móvil con
// su pareja o usa el ordenador de casa de su madre. Bloquear en el callback
// deja fuera precisamente a quien más lo necesita, en el momento exacto en que
// lo necesita. La señal va a la cola de moderación (`moderation_flags`,
// severidad 2 de 5: mirar, no actuar) y la decisión la toma una persona.
//
// Tener dos cuentas no es delito. Lo que se vigila es el patrón, no el hecho.
//
// ── ESTA RUTA REDIRIGE, NO DEVUELVE JSON ───────────────────────────────────
// Llega desde un clic en un correo, así que quien está al otro lado es un
// navegador pidiendo una página. Por eso no usa `manejarRuta`: un JSON aquí
// sería una pantalla en blanco con llaves. El error se comunica con un
// parámetro OPACO en la URL de vuelta (`?error=enlace`), nunca con el detalle.
// ============================================================================

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { hashContacto } from '@/lib/auth/identidad'
import { paisDePeticion } from '@/lib/auth/peticion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Señales de moderación que escribe B01. Coincide con el CHECK de severity. */
const SEVERIDAD_MULTICUENTA = 2

function redirigir(request: Request, ruta: string): NextResponse {
  return NextResponse.redirect(new URL(ruta, request.url), {
    // 303: la petición original era un GET desde el correo y la de destino
    // también lo es. Un 307 conservaría el método si algún cliente reintenta.
    status: 303,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const codigo = url.searchParams.get('code')

  if (!codigo) return redirigir(request, '/entrar?error=enlace')

  try {
    const supabase = await createClient()

    const { data, error } = await supabase.auth.exchangeCodeForSession(codigo)
    if (error || !data.user) {
      // Enlace caducado o ya usado. Es el caso NORMAL de un enlace viejo, no un
      // fallo: se manda a entrar otra vez sin ningún detalle en la URL.
      return redirigir(request, '/entrar?error=enlace')
    }

    const usuario = data.user

    if (usuario.email) {
      // El email vive en `auth.users` (lo gestiona Supabase Auth) y sale de
      // aquí convertido en hash. En ningún punto de este archivo se escribe en
      // una tabla de `public` ni se registra en un log.
      const contactHash = hashContacto(usuario.email)
      const pais = paisDePeticion(request)

      // ⚠️ Cliente ADMIN: `identity_vault` y `moderation_flags` tienen RLS
      // activada y CERO políticas (0001 y 0002). No hay consulta con el cliente
      // de RLS que pueda leerlas ni escribirlas — es el aislamiento, no un
      // permiso que falte.
      const admin = createAdminClient()

      const { data: hermanas } = await admin
        .from('identity_vault')
        .select('user_id')
        .eq('contact_hash', contactHash)
        .neq('user_id', usuario.id)
        .limit(1)

      await admin.from('identity_vault').upsert(
        {
          user_id: usuario.id,
          contact_hash: contactHash,
          // El país es para poder demostrar qué línea de ayuda se mostró en un
          // evento de crisis (ver crisis_events en 0002). No se muestra jamás.
          country_code: pais,
        },
        { onConflict: 'user_id' },
      )

      if (hermanas && hermanas.length > 0) {
        // La señal NO incluye el user_id de la cuenta hermana en `detail`:
        // vincular dos cuentas por escrito es exactamente lo que el vault
        // existe para no hacer. Quien revise puede cruzar por contact_hash con
        // service_role si hace falta; el registro por sí solo no delata a nadie.
        await admin.from('moderation_flags').insert({
          ref_type: 'profile',
          ref_id: usuario.id,
          subject_id: usuario.id,
          signal: 'multi_account',
          severity: SEVERIDAD_MULTICUENTA,
          detail: 'Mismo contacto que otra cuenta. Revisar patrón, no el hecho.',
        })
      }
    }

    // ¿Onboarding hecho? Una consulta por PK a través de mi_sesion(), la misma
    // que usa requireSesion(): cero filas = autenticado pero sin perfil.
    const { data: filas } = await supabase.rpc('mi_sesion')
    const tienePerfil = Array.isArray(filas) ? filas.length > 0 : Boolean(filas)

    return redirigir(request, tienePerfil ? '/feed' : '/onboarding')
  } catch (causa) {
    console.error('[darma][auth] fallo en el callback', causa)
    return redirigir(request, '/entrar?error=enlace')
  }
}
