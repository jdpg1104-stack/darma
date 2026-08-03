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
// hombres con daltonismo. Ese texto también se traduce: un aria-label en
// español dentro de una app en inglés es un punto de color con pasos extra.
//
// Sigue siendo Server Component; el traductor se resuelve con `resolverLocale()`
// y no añade JavaScript al cliente.
// ============================================================================

import Link from 'next/link'

import { EstadoVacio } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import type { ResumenRefugio } from '@/lib/crypto/tipos'
import estilos from './refugio.module.css'

export interface ListaRefugiosProps {
  refugios: readonly ResumenRefugio[]
}

export async function ListaRefugios({ refugios }: ListaRefugiosProps) {
  const locale = await resolverLocale()
  const t = obtenerTraductor(locale)

  if (refugios.length === 0) {
    return (
      <EstadoVacio
        // `tono='cuidado'`: quien llega aquí muchas veces llega desde un sitio
        // malo. Una ilustración simpática junto a «todavía no tienes refugios»
        // se lee como burla.
        tono="cuidado"
        titulo={t('refugios.lista.vacioTitulo')}
        descripcion={t('refugios.lista.vacioDescripcion')}
      />
    )
  }

  const fecha = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

  return (
    <ul className={estilos.lista}>
      {refugios.map((r) => {
        const nombre = r.title ?? t(r.kind === 'duo' ? 'refugios.lista.duo' : 'refugios.lista.circulo')

        return (
          <li key={r.id}>
            <Link
              href={`/refugios/${r.id}`}
              className={estilos.fila}
              aria-label={
                r.haySinLeer ? t('refugios.lista.etiquetaSinLeer', { titulo: nombre }) : nombre
              }
            >
              {r.haySinLeer ? <span className={estilos.sinLeer} aria-hidden="true" /> : null}
              <span className={estilos.filaCuerpo}>
                <span className={estilos.filaTitulo}>{nombre}</span>
                <span className={estilos.filaMeta}>
                  {t('refugios.lista.personas', { n: r.memberCount })}
                  {r.lastMessageAt
                    ? ` · ${fecha.format(new Date(r.lastMessageAt))}`
                    : ` · ${t('refugios.lista.sinMensajes')}`}
                  {r.muted ? ` · ${t('refugios.lista.silenciado')}` : ''}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
