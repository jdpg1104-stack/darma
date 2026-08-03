// ============================================================================
// La tarjeta de un post. Server Component salvo el botón de voto.
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

import { BotonVoto } from './BotonVoto'
import estilos from './Feed.module.css'

export interface TarjetaPostProps {
  post: PostFeed
}

const ETIQUETA_TIPO: Readonly<Record<PostFeed['kind'], string>> = {
  desahogo: 'Desahogo',
  pregunta: 'Pregunta',
  gratitud: 'Gratitud',
}

/**
 * Fecha en el idioma del documento, legible y con el ISO completo en `dateTime`
 * para quien lo necesite. `<time>` y no un `<span>`: la fecha es un dato, y así
 * el lector de pantalla puede anunciarla como tal.
 */
function fechaLegible(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return ''
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short' }).format(fecha)
}

export function TarjetaPost({ post }: TarjetaPostProps) {
  return (
    <Tarjeta como="article" interactiva className={estilos.tarjeta}>
      <header className={estilos.cabecera}>
        <Avatar semilla={post.autor.avatarSeed} alias={post.autor.alias} nivel={post.autor.nivel} tamano={40} />
        <div className={estilos.identidad}>
          <span className={estilos.alias}>{post.autor.alias}</span>
          <span className={estilos.meta}>
            <time dateTime={post.creadoEn}>{fechaLegible(post.creadoEn)}</time>
            {post.topic ? ` · ${post.topic}` : null}
          </span>
        </div>
        <div className={estilos.etiquetas}>
          <Insignia nivel={post.autor.nivel} />
          <Chip>{ETIQUETA_TIPO[post.kind]}</Chip>
          {/* «Impulsado» se muestra por transparencia, igual que un anuncio se
              marca como anuncio. Nunca aparece en un post en riesgo: para esos
              `impulsado` es false por construcción (isBoostEligible). */}
          {post.impulsado ? <Chip tono="logro">Impulsado</Chip> : null}
        </div>
      </header>

      {/* El cuerpo lo escribe una persona anónima: va como TEXTO. Ni
          `dangerouslySetInnerHTML` ni markdown renderizado a HTML — eso es XSS
          servido en la pantalla que más veces se carga de la app. */}
      <p className={estilos.cuerpo}>{post.body}</p>

      {/* `prefetch` para que abrir un hilo sea instantáneo. El enlace cubre la
          tarjeta entera (CSS), pero sigue siendo un ancla real. */}
      <Link href={`/post/${post.id}`} prefetch className={estilos.enlaceHilo}>
        Abrir el hilo de {post.autor.alias}
      </Link>

      <footer className={estilos.pie}>
        <BotonVoto postId={post.id} upvotesIniciales={post.upvotes} heVotadoInicial={post.heVotado} />
        <span className={estilos.contador}>
          {post.respuestas === 1 ? '1 persona ha escuchado' : `${post.respuestas} personas han escuchado`}
        </span>
      </footer>

      {post.enRiesgo ? (
        <aside className={estilos.recursos}>
          Si esto te resuena,{' '}
          <Link href="/ayuda" className={estilos.enlaceRecursos}>
            aquí tienes a quién acudir
          </Link>
          .
        </aside>
      ) : null}
    </Tarjeta>
  )
}
