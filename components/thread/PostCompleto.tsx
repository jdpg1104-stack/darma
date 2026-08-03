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
function fecha(iso: string): string {
  return new Intl.DateTimeFormat('es-ES', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(iso))
}

export function PostCompleto({ autor, body, creadoEn, escuchas, apoyos, acciones }: PostCompletoProps) {
  return (
    <Tarjeta como="article" className={estilos.post}>
      <div className={estilos.meta}>
        <span className={estilos.autor}>
          <Avatar semilla={autor.avatarSeed} alias={autor.alias} nivel={autor.nivel} tamano={40} />
          <span className={estilos.alias}>{autor.alias}</span>
          <Insignia nivel={autor.nivel} />
        </span>
        <time dateTime={creadoEn}>{fecha(creadoEn)}</time>
      </div>

      <p className={estilos.cuerpo}>{body}</p>

      <div className={estilos.pie}>
        <span className={estilos.contador}>
          {escuchas === 0
            ? 'Todavía no le ha escuchado nadie'
            : escuchas === 1
              ? '1 persona le ha escuchado'
              : `${escuchas} personas le han escuchado`}
          {apoyos > 0 ? ` · ${apoyos} de apoyo` : ''}
        </span>
        {acciones}
      </div>
    </Tarjeta>
  )
}
