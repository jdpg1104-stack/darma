// ============================================================================
// B10 · /refugios/[id] — el hilo.
//
// El shell es Server Component; el hilo es `'use client'` porque necesita
// WebCrypto e IndexedDB, que solo existen en el navegador. Esa frontera es la
// que hace que el servidor NO pueda ver el contenido aunque quisiera: no es que
// no lo pida, es que la clave no está de su lado.
//
// ── EL 404 QUE NO ES UN DESCUIDO ──────────────────────────────────────────
// Un refugio del que no eres miembro devuelve `notFound()`, exactamente igual
// que un uuid que no existe. Nunca un 403. `0002` está construido para que un
// refugio sea *indistinguible de inexistente*: para un acosador, saber que la
// sala existe es la información que busca, porque significa que la persona
// sigue en la app.
// ============================================================================

import { notFound, redirect } from 'next/navigation'

import { Hilo } from '@/components/refuge'
import { getSesion } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PaginaHilo({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  // Un id mal formado se trata como inexistente: si respondiera distinto, la
  // forma del error ya diría algo.
  if (!UUID.test(id)) notFound()

  const sesion = await getSesion()
  if (!sesion) redirect('/entrar')

  const supabase = await createClient()
  // UNA consulta. La política `refuges_read_member` devuelve cero filas si no
  // eres miembro o si hay un bloqueo vivo con alguien de la sala; los dos casos
  // acaban en el mismo `notFound()`.
  const { data } = await supabase
    .from('refuges')
    .select('id, kind, title')
    .eq('id', id)
    .maybeSingle()

  if (!data) notFound()

  const refugio = data as { id: string; kind: 'duo' | 'circulo'; title: string | null }

  return (
    <Hilo
      refugeId={refugio.id}
      userId={sesion.userId}
      titulo={refugio.title ?? (refugio.kind === 'duo' ? 'Refugio de dos' : 'Círculo')}
    />
  )
}
