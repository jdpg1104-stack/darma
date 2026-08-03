// ============================================================================
// /publicar — la pantalla del composer
//
// ── UNA CONSULTA. UNA. ─────────────────────────────────────────────────────
// El presupuesto de la ficha B03 es una sola consulta a la base para pintar esta
// pantalla. Se hace con la RPC `mi_perfil_privado()` y no con un `select` sobre
// `profiles` porque 0001_core.sql REVOCÓ el privilegio de columna sobre
// `listen_credits`, `posts_published` y `banned_until`: no existe ninguna
// consulta directa que los devuelva, ni siquiera sobre la propia fila. La RPC
// filtra por `auth.uid()` y es la única puerta.
//
// Se llama a la RPC en vez de hacer `fetch('/api/me')` desde el servidor: una
// ruta de API llamándose a sí misma paga un salto HTTP completo (más el reenvío
// de cookies) para ejecutar exactamente la misma consulta.
//
// ── EL SERVIDOR DECIDE, EL CLIENTE PINTA ───────────────────────────────────
// La regla del 3:1 se evalúa aquí con `canPublish()` y al cliente solo le llega
// el MOTIVO (`'faltan'`, `'en_pausa'`…). Así `lib/reciprocity.ts` no entra en el
// bundle del navegador y ninguna regla se reimplementa en el cliente: el
// cliente no ve el saldo, ni sabe que el umbral son tres.
//
// Antes viajaba la FRASE ya resuelta de `reciprocityMessage()`, para que nadie
// compusiera otro mensaje con el número suelto y acabara escribiendo la palabra
// «crédito», prohibida de cara al usuario. Eso dejaba la pantalla en español
// pasara lo que pasara. Ahora viaja el motivo y, con `'faltan'`, cuántas
// personas quedan: el número es imprescindible para el plural ICU de
// `publicar.faltan`, que en inglés no se puede componer pegando cadenas. La
// garantía de antes no se pierde, se mueve: el único texto posible para ese
// número es el del catálogo.
// ============================================================================

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSesion } from '@/lib/auth/session'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { canPublish } from '@/lib/reciprocity'
import { Composer, type MotivoReciprocidad } from '@/components/composer/Composer'
import estilos from './pagina.module.css'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('publicar.metaTitulo'),
    description: t('publicar.metaDescripcion'),
    // Que un buscador no indexe la pantalla donde se escribe. No hay contenido
    // que ofrecer y sí una URL que asociar a una persona.
    robots: { index: false, follow: false },
  }
}

interface FilaPrivada {
  listen_credits: number
  posts_published: number
  banned_until: string | null
}

export default async function PaginaPublicar() {
  const sesion = await getSesion()
  if (!sesion) redirect('/entrar')
  // Sin onboarding no hay fila en `profiles`, y sin fila el INSERT rompería por
  // clave foránea. Se manda a terminar el alta en vez de dejar escribir un texto
  // que no se va a poder publicar.
  if (!sesion.perfilCompleto) redirect('/onboarding')

  const supabase = await createClient()
  const { data } = await supabase.rpc('mi_perfil_privado')
  const privado = ((Array.isArray(data) ? data[0] : data) ?? null) as FilaPrivada | null

  // Si la RPC falla, la pantalla NO se cae: se asume el caso más permisivo para
  // la escritura (dejar escribir siempre) y el servidor decidirá al publicar. La
  // alternativa —un error a pantalla completa— le cerraría la puerta a alguien
  // por un fallo de lectura de un saldo que ni siquiera es la autoridad.
  const estado = {
    listenCredits: privado?.listen_credits ?? 0,
    postsPublished: privado?.posts_published ?? 0,
    bannedUntil: privado?.banned_until ?? null,
  }

  // Mismo reparto de casos que `reciprocityMessage()`, en el mismo orden: el
  // baneo manda sobre todo lo demás y el primer post es gratis.
  const resultado = canPublish(estado)
  const motivo: MotivoReciprocidad =
    resultado.reason === 'banned'
      ? 'en_pausa'
      : resultado.isFirstPost
        ? 'primera_vez'
        : resultado.allowed
          ? 'listo'
          : 'faltan'

  const t = obtenerTraductor(await resolverLocale())

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <h1 className={estilos.titulo}>{t('publicar.titulo')}</h1>
        <p className={estilos.entradilla}>{t('publicar.entradilla')}</p>
      </header>

      <Composer
        motivoReciprocidad={motivo}
        faltanPorAcompanar={resultado.creditsNeeded}
        puedePublicar={resultado.allowed}
      />
    </main>
  )
}
