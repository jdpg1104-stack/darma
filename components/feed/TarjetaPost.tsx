'use client'

// ============================================================================
// La tarjeta de un post.
//
// `'use client'` por el idioma: la tarjeta la pinta también `ScrollInfinito`,
// que es de cliente, así que el texto y la fecha tienen que salir del contexto
// de locale (`useTraductor` / `useLocale`) y no de `resolverLocale()`, que solo
// existe en el servidor. Sigue sin estado propio: el único JS con lógica es
// `BotonVoto`.
//
// ── EL PIE DE RECURSOS (la decisión más delicada de todo el bloque) ─────────
// Cuando `enRiesgo` es true, la tarjeta añade UN pie discreto con el acceso a
// ayuda. Lo que NO hace, y cada «no» es deliberado:
//   · no cambia de color ni añade borde de alarma;
//   · no muestra ninguna etiqueta que diga «riesgo», «crisis» ni nada parecido;
//   · no dice nada SOBRE quien escribió: el texto va dirigido a quien lee.
// Marcar visualmente el post señala a una persona vulnerable delante de toda la
// comunidad y la convierte en una alerta del sistema. La regla de CONTRATOS §9
// es que un post en crisis se PRIORIZA, no se etiqueta. El pie existe porque el
// momento en que alguien lee un mensaje así es el momento en que puede necesitar
// saber a dónde acudir — por él o por quien lo escribió.
//
// Es un `<a href="/ayuda">` y no un botón que abre un modal, por lo mismo que
// `BotonCrisis` de B16: si el JS no ha hidratado o falló, el enlace sigue
// llevando a los teléfonos.
// ============================================================================

import Link from 'next/link'

import { Avatar, Chip, Insignia, Tarjeta } from '@/components/ui'
import type { PostFeed } from '@/app/api/feed/tipos'
import type { Locale } from '@/i18n'
import { useLocale, useTraductor } from '@/i18n/Proveedor'

import { BotonVoto } from './BotonVoto'
import estilos from './Feed.module.css'

export interface TarjetaPostProps {
  post: PostFeed
}

/**
 * Fecha en el idioma del documento, legible y con el ISO completo en `dateTime`
 * para quien lo necesite. `<time>` y no un `<span>`: la fecha es un dato, y así
 * el lector de pantalla puede anunciarla como tal.
 */
function fechaLegible(iso: string, locale: Locale): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(fecha)
}

export function TarjetaPost({ post }: TarjetaPostProps) {
  const t = useTraductor()
  const locale = useLocale()

  return (
    <Tarjeta como="article" interactiva className={estilos.tarjeta} data-testid="feed-tarjeta-post">
      <header className={estilos.cabecera}>
        <Avatar semilla={post.autor.avatarSeed} alias={post.autor.alias} nivel={post.autor.nivel} tamano={40} />
        <div className={estilos.identidad}>
          <span className={estilos.alias}>{post.autor.alias}</span>
          <span className={estilos.meta}>
            <time dateTime={post.creadoEn}>{fechaLegible(post.creadoEn, locale)}</time>
            {post.topic ? ` · ${post.topic}` : null}
          </span>
        </div>
        <div className={estilos.etiquetas}>
          <Insignia nivel={post.autor.nivel} />
          <Chip>{t(`publicar.tipos.${post.kind}`)}</Chip>
          {/* «Impulsado» se muestra por transparencia, igual que un anuncio se
              marca como anuncio. Nunca aparece en un post en riesgo: para esos
              `impulsado` es false por construcción (isBoostEligible). */}
          {post.impulsado ? <Chip tono="logro">{t('feed.impulsado')}</Chip> : null}
        </div>
      </header>

      {/* El cuerpo lo escribe una persona anónima: va como TEXTO. Ni
          `dangerouslySetInnerHTML` ni markdown renderizado a HTML — eso es XSS
          servido en la pantalla que más veces se carga de la app. */}
      <p className={estilos.cuerpo}>{post.body}</p>

      {/* `prefetch` para que abrir un hilo sea instantáneo. El enlace cubre la
          tarjeta entera (CSS), pero sigue siendo un ancla real. */}
      <Link
        href={`/post/${post.id}`}
        prefetch
        className={estilos.enlaceHilo}
        data-testid="feed-abrir-hilo"
      >
        {t('feed.abrirHilo', { alias: post.autor.alias })}
      </Link>

      <footer className={estilos.pie}>
        <BotonVoto postId={post.id} upvotesIniciales={post.upvotes} heVotadoInicial={post.heVotado} />
        <span className={estilos.contador}>{t('feed.escuchas', { n: post.respuestas })}</span>
      </footer>

      {post.enRiesgo ? (
        // `feed-pie-recursos` y NO `tarjeta-recursos`: esta pieza va dirigida a
        // quien LEE, no al autor del texto en riesgo. Compartir el testid con la
        // tarjeta del autor haría que un test de «no hay tarjeta de crisis»
        // fallara por un post ajeno del feed.
        <aside className={estilos.recursos} data-testid="feed-pie-recursos">
          {t('feed.recursosPrefijo')}{' '}
          <Link href="/ayuda" className={estilos.enlaceRecursos}>
            {t('feed.recursosEnlace')}
          </Link>
          .
        </aside>
      ) : null}
    </Tarjeta>
  )
}
