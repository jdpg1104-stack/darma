// ============================================================================
// GET /api/push/key — la señal que enciende o apaga toda la UI de push
//
// Devuelve `{ publicKey: null }` con **200**, no un 500, cuando no hay llaves
// VAPID configuradas. Eso no es tolerancia al fallo: es el contrato. `null` es
// la señal que apaga el opt-in en el cliente, y hoy —sin llaves provisionadas—
// es la respuesta normal de esta ruta. Un 500 aquí haría aparecer un error en la
// consola de cada persona que abre la app por una función que ni siquiera está
// encendida.
//
// Solo sale la clave PÚBLICA. La privada no se lee en este archivo ni de rebote:
// `clavePublicaVapid()` no la toca.
//
// Sin rate limit a propósito: es de solo lectura, devuelve un valor constante
// para todo el mundo y no consulta la base de datos. Ponerle un contador
// costaría un viaje a Postgres por cada carga de la app para proteger un dato
// que es público por definición.
// ============================================================================

import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { requireSesion } from '@/lib/auth/session'
import { clavePublicaVapid } from '@/lib/push/vapid'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  return manejarRuta(async () => {
    // Exige sesión aunque el dato sea público: el opt-in solo se ofrece a quien
    // ya está dentro, y así esta ruta no es un endpoint anónimo más que
    // mantener. El proxy ya la cierra; esto es la segunda barrera.
    await requireSesion()

    return sobreOk<{ publicKey: string | null }>({ publicKey: clavePublicaVapid() })
  })
}
