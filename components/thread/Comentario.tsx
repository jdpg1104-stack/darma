'use client'

// ============================================================================
// Comentario — una escucha. La única hoja con JS propio sigue siendo el botón de
// «me ayudó», que solo se monta para el autor del post.
//
// `'use client'` por el idioma: quien pinta esta tarjeta es `ListaComentarios`,
// que es de cliente, así que el texto y la fecha salen del contexto de locale
// (`useTraductor` / `useLocale`) y no de `resolverLocale()`, que solo existe en
// el servidor. Sin estado ni efectos propios.
//
// La insignia de nivel está aquí a propósito: en un hilo de apoyo importa saber
// que quien te responde es un Guía o un Mentor. Es lo único parecido a un
// estatus que se muestra, y sale del karma de reputación, que solo se gana
// escuchando.
//
// No hay botón de apoyo en un comentario: reconocer una respuesta es «me
// ayudó», y lo firma quien la recibió. Ver `BotonApoyo.tsx`.
// ============================================================================

import { Avatar, Chip, Insignia, Tarjeta } from '@/components/ui'
import type { ComentarioHilo } from '@/app/api/comments/tipos'
import type { Locale } from '@/i18n'
import { useLocale, useTraductor } from '@/i18n/Proveedor'
import estilos from './hilo.module.css'

export interface ComentarioProps {
  comentario: ComentarioHilo
  /** ¿Quien mira es el autor del post? Solo entonces se pinta «me ayudó». */
  soyAutorDelPost?: boolean
  /** Slot para `BotonUtil` (cliente): el servidor no monta JS por su cuenta. */
  acciones?: React.ReactNode
}

function fecha(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

export function Comentario({ comentario, soyAutorDelPost = false, acciones }: ComentarioProps) {
  const t = useTraductor()
  const locale = useLocale()
  const { autor, body, creadoEn, esUtil, esMio, validado } = comentario

  return (
    <Tarjeta
      como="article"
      className={estilos.comentario}
      acento={esUtil ? 'logro' : 'ninguno'}
      data-testid="hilo-comentario"
    >
      <div className={estilos.meta}>
        <span className={estilos.autor}>
          <Avatar semilla={autor.avatarSeed} alias={autor.alias} nivel={autor.nivel} tamano={32} />
          <span className={estilos.alias}>{autor.alias}</span>
          <Insignia nivel={autor.nivel} />
        </span>
        <time dateTime={creadoEn}>{fecha(creadoEn, locale)}</time>
      </div>

      <p className={estilos.cuerpo}>{body}</p>

      <div className={estilos.acciones}>
        {esUtil ? <Chip tono="logro">{t('hilo.leAyudo')}</Chip> : null}
        {/* «En revisión» solo se le enseña a quien escribió. Que el resto del
            hilo sepa que el mensaje de alguien no ha pasado la validación no
            aporta nada y expone a esa persona. */}
        {esMio && !validado ? <Chip tono="neutro">{t('hilo.enRevision')}</Chip> : null}
        {soyAutorDelPost ? acciones : null}
      </div>
    </Tarjeta>
  )
}
