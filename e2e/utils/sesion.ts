import type { BrowserContext, Cookie } from '@playwright/test'
import { refDeProyecto } from './admin'

// ============================================================================
// Inyección de sesión en el contexto del navegador.
//
// Los tests NO pasan por la pantalla de acceso para autenticarse (salvo el
// recorrido (a), que es justo lo que prueba): repetir el alta en cada test
// cuesta segundos por test y no verifica nada nuevo. Se obtiene la sesión por
// el grant de contraseña de GoTrue —con la ANON key, como cualquier navegador—
// y se escribe la cookie con el formato que espera `@supabase/ssr`.
//
// ⚠️ La service_role key NUNCA entra aquí: esto se ejecuta del lado del
// navegador y acabaría en la traza que Playwright guarda como artefacto.
// ============================================================================

export interface SesionSupabase {
  access_token: string
  refresh_token: string
  expires_at: number
  expires_in: number
  token_type: string
  user: { id: string; email?: string }
}

/** Inicia sesión contra GoTrue con la anon key. Devuelve la sesión completa. */
export async function iniciarSesion(
  correo: string,
  contrasena: string,
): Promise<SesionSupabase> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'content-type': 'application/json' },
    body: JSON.stringify({ email: correo, password: contrasena }),
  })

  const cuerpo = (await res.json()) as SesionSupabase & { error_code?: string; msg?: string }
  if (!res.ok || !cuerpo.access_token) {
    throw new Error(
      `No se ha podido iniciar sesión para ${correo}: ${res.status} ${cuerpo.error_code ?? ''} ${cuerpo.msg ?? ''}`,
    )
  }
  return cuerpo
}

/** Trozos en los que `@supabase/ssr` parte una cookie que no cabe entera. */
const TAMANO_TROZO = 3180

/**
 * Cookies con la forma exacta que lee `@supabase/ssr` en el servidor:
 * `sb-<ref>-auth-token` con el valor `base64-<b64(JSON)>`, troceado si hace
 * falta. Si el formato deja de coincidir, la app verá al usuario como anónimo y
 * el proxy lo mandará a `/entrar` — que es un fallo ruidoso, no silencioso.
 */
export function cookiesDeSesion(sesion: SesionSupabase, urlBase: string): Cookie[] {
  const ref = refDeProyecto(process.env.NEXT_PUBLIC_SUPABASE_URL!) ?? 'local'
  const nombre = `sb-${ref}-auth-token`

  const codificado =
    'base64-' + Buffer.from(JSON.stringify(sesion), 'utf8').toString('base64url')

  const trozos: string[] = []
  for (let i = 0; i < codificado.length; i += TAMANO_TROZO) {
    trozos.push(codificado.slice(i, i + TAMANO_TROZO))
  }

  const { hostname } = new URL(urlBase)
  const base = {
    domain: hostname,
    path: '/',
    expires: sesion.expires_at,
    httpOnly: false,
    secure: false,
    sameSite: 'Lax' as const,
  }

  if (trozos.length === 1) return [{ name: nombre, value: trozos[0]!, ...base }]
  return trozos.map((valor, i) => ({ name: `${nombre}.${i}`, value: valor, ...base }))
}

/** Deja el contexto del navegador con la sesión ya iniciada. */
export async function inyectarSesion(
  contexto: BrowserContext,
  sesion: SesionSupabase,
  urlBase: string,
): Promise<void> {
  await contexto.addCookies(cookiesDeSesion(sesion, urlBase))
}
