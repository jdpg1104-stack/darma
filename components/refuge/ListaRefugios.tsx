// ============================================================================
// B10 · La bandeja. Server Component: cero JS.
//
// Lo único que se pinta de cada sala es lo que el servidor PUEDE saber: el
// título sin cifrar (opcional y acotado a 60 caracteres por 0002), cuántas
// personas hay y cuándo fue el último mensaje. Ni una palabra del contenido, ni
// un «preview»: el servidor no lo tiene y no debe tenerlo nunca.
//
// El badge de «sin leer» sale de `last_read_message_id`, no de contar mensajes.
// Y va acompañado de texto en el `aria-label`, porque un punto de color a solas
// es información que no reciben ni un lector de pantalla ni el 8 % de los
// hombres con daltonismo.
// ============================================================================

import Link from 'next/link'

import { EstadoVacio } from '@/components/ui'
import type { ResumenRefugio } from '@/lib/crypto/tipos'
import estilos from './refugio.module.css'

export interface ListaRefugiosProps {
  refugios: readonly ResumenRefugio[]
}

const FECHA = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function ListaRefugios({ refugios }: ListaRefugiosProps) {
  if (refugios.length === 0) {
    return (
      <EstadoVacio
        // `tono='cuidado'`: quien llega aquí muchas veces llega desde un sitio
        // malo. Una ilustración simpática junto a «todavía no tienes refugios»
        // se lee como burla.
        tono="cuidado"
        titulo="Todavía no tienes ningún refugio"
        descripcion="Un refugio es una conversación privada, cifrada de punta a punta, con alguien que ya te ha escuchado. Se abre desde el perfil de esa persona."
      />
    )
  }

  return (
    <ul className={estilos.lista}>
      {refugios.map((r) => (
        <li key={r.id}>
          <Link
            href={`/refugios/${r.id}`}
            className={estilos.fila}
            aria-label={
              `${r.title ?? (r.kind === 'duo' ? 'Refugio de dos' : 'Círculo')}` +
              (r.haySinLeer ? ', con mensajes sin leer' : '')
            }
          >
            {r.haySinLeer ? <span className={estilos.sinLeer} aria-hidden="true" /> : null}
            <span className={estilos.filaCuerpo}>
              <span className={estilos.filaTitulo}>
                {r.title ?? (r.kind === 'duo' ? 'Refugio de dos' : 'Círculo')}
              </span>
              <span className={estilos.filaMeta}>
                {r.memberCount} {r.memberCount === 1 ? 'persona' : 'personas'}
                {r.lastMessageAt ? ` · ${FECHA.format(new Date(r.lastMessageAt))}` : ' · sin mensajes todavía'}
                {r.muted ? ' · silenciado' : ''}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
