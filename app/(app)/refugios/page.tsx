// ============================================================================
// B10 · /refugios — la bandeja. Server Component.
//
// Dos consultas y ninguna de ellas cuenta nada: `b10_bandeja` (keyset sobre
// `idx_refuges_activity`) y la lista de almas afines. El presupuesto de la
// ficha son 3; se usan 2.
//
// Todo lo que se pinta aquí es material que el servidor PUEDE ver: títulos sin
// cifrar, contadores de trigger y disponibilidad declarada por cada persona.
// Ningún contenido de mensaje pasa por aquí, porque el servidor no lo tiene.
// ============================================================================

import { redirect } from 'next/navigation'

import { CrearCirculo, ListaAlmasAfines, ListaRefugios } from '@/components/refuge'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { getSesion } from '@/lib/auth/session'
import { createClient } from '@/lib/supabase/server'
import type { AlmaAfin, ResumenRefugio } from '@/lib/crypto/tipos'
import { aAlmaAfin, type FilaKindred } from '@/app/api/refuges/_dominio/proyecciones'
import estilos from '@/components/refuge/refugio.module.css'

export const dynamic = 'force-dynamic'

interface FilaBandeja {
  id: string
  kind: 'duo' | 'circulo'
  title: string | null
  member_count: number
  message_count: number
  last_message_at: string | null
  last_read_message_id: number | null
  muted: boolean
}

export default async function PaginaRefugios() {
  const sesion = await getSesion()
  if (!sesion) redirect('/entrar')

  const t = obtenerTraductor(await resolverLocale())

  const supabase = await createClient()

  // Las dos consultas en paralelo: son independientes y encadenarlas duplicaría
  // la latencia de la pantalla que se abre en cada arranque de la app.
  const [bandeja, contactos] = await Promise.all([
    supabase.rpc('b10_bandeja', { p_cursor_ts: null, p_cursor_id: null, p_limite: 20 }),
    supabase
      .from('kindred')
      .select('kindred_id, note, profiles!kindred_kindred_id_fkey(id, alias, avatar_seed, level, karma_reputation, availability)')
      .eq('owner_id', sesion.userId)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  const refugios: ResumenRefugio[] = ((bandeja.data ?? []) as FilaBandeja[]).map((f) => ({
    id: f.id,
    kind: f.kind,
    title: f.title,
    memberCount: f.member_count,
    messageCount: f.message_count,
    lastMessageAt: f.last_message_at,
    lastReadMessageId: f.last_read_message_id,
    muted: f.muted,
    haySinLeer: f.message_count > 0 && f.last_read_message_id === null,
  }))

  const almas = ((contactos.data ?? []) as unknown as FilaKindred[])
    .map(aAlmaAfin)
    .filter((a): a is AlmaAfin => a !== null)

  return (
    <main className={estilos.pagina}>
      <h1>{t('refugios.titulo')}</h1>
      <p className={estilos.explicacion}>{t('refugios.explicacion')}</p>

      <ListaRefugios refugios={refugios} />

      {/* La mitad grupal: se elige entre las almas afines de abajo. El propio
          componente se retira si no hay ninguna guardada. */}
      <CrearCirculo miId={sesion.userId} almas={almas} />

      <h2>{t('refugios.almasAfines')}</h2>
      <ListaAlmasAfines almas={almas} />
    </main>
  )
}
