// ============================================================================
// PostCompleto — el desahogo al que se viene a responder. Server Component.
//
// Dos cosas que parecen detalles y no lo son:
//
//  1. El cuerpo se renderiza como TEXTO dentro de un `<p>` con `white-space:
//     pre-wrap`. Nunca `dangerouslySetInnerHTML`: lo escribe una persona
//     anónima y renderizarlo como HTML es XSS servido en bandeja.
//  2. El contador dice «3 personas te han escuchado», no «3 comentarios».
//     `posts.reply_count` cuenta SOLO los comentarios validados (lo mantiene el
//     trigger `comments_on_validated`), así que el número es literalmente
//     personas que escucharon. Llamarlo «comentarios» sería mentir a la baja y,
//     peor, invitaría a alguien a preguntarse dónde están los que faltan.
// ============================================================================

import { Avatar, Insignia, Tarjeta } from '@/components/ui'
import { obtenerTraductor, resolverLocale, type Locale } from '@/i18n'
import type { PerfilPublico } from '@/lib/auth/perfil'
import estilos from './hilo.module.css'

export interface PostCompletoProps {
  autor: PerfilPublico
  body: string
  /** ISO-8601. */
  creadoEn: string
  /** `posts.reply_count` — solo validados. Nunca un `count(*)`. */
  escuchas: number
  apoyos: number
  /** Slot para `BotonApoyo` (cliente). El post no sabe de estado. */
  acciones?: React.ReactNode
}

/** Fecha legible y estable entre servidor y cliente (sin hora local). */
function fecha(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

export async function PostCompleto({
  autor,
  body,
  creadoEn,
  escuchas,
  apoyos,
  acciones,
}: PostCompletoProps) {
  const locale = await resolverLocale()
  const t = obtenerTraductor(locale)

  return (
    <Tarjeta como="article" className={estilos.post} data-testid="hilo-post">
      <div className={estilos.meta}>
        <span className={estilos.autor}>
          <Avatar semilla={autor.avatarSeed} alias={autor.alias} nivel={autor.nivel} tamano={40} />
          <span className={estilos.alias}>{autor.alias}</span>
          <Insignia nivel={autor.nivel} />
        </span>
        <time dateTime={creadoEn}>{fecha(creadoEn, locale)}</time>
      </div>

      <p className={estilos.cuerpo}>{body}</p>

      <div className={estilos.pie}>
        <span className={estilos.contador}>
          {t('hilo.escuchasPost', { n: escuchas })}
          {apoyos > 0 ? ` · ${t('hilo.apoyos', { n: apoyos })}` : ''}
        </span>
        {acciones}
      </div>
    </Tarjeta>
  )
}
