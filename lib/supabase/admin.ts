// ============================================================================
// ⛔ CLIENTE service_role — SALTA ROW LEVEL SECURITY POR COMPLETO ⛔
//
// LEE ESTO ANTES DE IMPORTAR ESTE ARCHIVO:
//
//  1. Este cliente NO respeta ninguna política RLS. Ve `identity_vault` — la
//     tabla que contiene el único vínculo entre un alias y una persona real y
//     que deliberadamente no tiene NI UNA política (ver la cabecera de
//     supabase/migrations/0001_core.sql). Es la llave maestra del anonimato de
//     toda la red. Un fallo aquí no es un bug de permisos: es la des-anonimización
//     de personas que escribieron sobre su salud mental creyéndose anónimas.
//
//  2. JAMÁS lo importes desde un componente cliente, ni desde un módulo que a
//     su vez importe un componente cliente, ni desde nada bajo "use client".
//     La service_role key es un JWT con `role: service_role`: si acaba en un
//     bundle de navegador, cualquiera con las devtools abiertas tiene acceso
//     total de lectura y escritura a la base de datos entera.
//
//  3. Úsalo SOLO para las tres cosas que RLS no puede hacer por diseño:
//       · llamar a award_karma()/spend_karma() (revocadas a `authenticated`),
//       · escribir/leer identity_vault en el alta y en anti-multicuenta,
//       · trabajo de moderación y de la cola de crisis.
//     Para todo lo demás usa lib/supabase/server.ts, que respeta RLS. Si te
//     encuentras usando el admin "porque así funciona", casi siempre significa
//     que falta una política, no que haga falta saltárselas.
//
// La guarda de runtime de más abajo es la última red, no la primera: convierte
// una fuga silenciosa en un error inmediato y ruidoso. La primera red es la
// revisión de código, y por eso el aviso ocupa media pantalla.
//
// ALTERNATIVA DESCARTADA: exportar una instancia singleton a nivel de módulo
// (`export const admin = createClient(...)`). El efecto secundario sería que el
// simple hecho de que un bundler siga el import ya construye el cliente y lee
// la variable de entorno — incluida la resolución estática que hace el
// compilador de Next al analizar un grafo que toca cliente. Con una función,
// nada ocurre hasta que alguien la llama, y la llamada es el punto donde la
// guarda dispara.
// ============================================================================

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente con privilegios de service_role. SOLO SERVIDOR.
 *
 * @throws si se invoca en un entorno con `window` (es decir, en el navegador).
 * @throws si falta SUPABASE_SERVICE_ROLE_KEY.
 */
export function createAdminClient(): SupabaseClient {
  // ── La guarda ────────────────────────────────────────────────────────────
  // Si esto se ejecuta en un navegador, el secreto ya está en el bundle y el
  // daño ya está hecho: lo único que podemos hacer es romper de forma
  // estruendosa para que se detecte en el primer render y no en una auditoría
  // seis meses después.
  if (typeof window !== 'undefined') {
    throw new Error(
      '[darma][SEGURIDAD] lib/supabase/admin.ts se ha cargado en el NAVEGADOR. ' +
      'Este cliente salta RLS y expone identity_vault. Alguien lo ha importado ' +
      'desde un componente cliente: revisa la cadena de imports y muévelo a un ' +
      'Route Handler o Server Action. NO silencies este error.',
    )
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url) throw new Error('[darma] Falta NEXT_PUBLIC_SUPABASE_URL.')
  if (!serviceRoleKey) {
    // Nombre SIN el prefijo NEXT_PUBLIC_ a propósito: ese prefijo es lo que
    // haría que Next la inlinease en el bundle de cliente.
    throw new Error(
      '[darma] Falta SUPABASE_SERVICE_ROLE_KEY. Nunca la prefijes con ' +
      'NEXT_PUBLIC_ ni la subas al repositorio.',
    )
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      // No hay usuario que persistir ni token que refrescar: el service_role es
      // una identidad de máquina y su JWT no caduca por sesión. Persistirlo
      // solo añadiría escritura en storage y riesgo de fuga.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-darma-client': 'admin' },
    },
  })
}
