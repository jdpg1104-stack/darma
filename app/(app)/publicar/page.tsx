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
// ── EL SERVIDOR CALCULA EL COPY, EL CLIENTE LO PINTA ───────────────────────
// `reciprocityMessage()` se resuelve aquí y viaja como prop. Así
// `lib/reciprocity.ts` no entra en el bundle del navegador y —más importante—
// el copy tiene un solo origen. Ninguna regla del 3:1 se reimplementa en el
// cliente; el cliente ni siquiera ve el saldo.
//
// Nada de lo que viaja al cliente contiene el número de escuchas pendientes como
// dato suelto: viaja la FRASE. Es intencionado — un número en una prop invita a
// que alguien construya con él otro mensaje, y ese otro mensaje acabará usando
// la palabra «crédito», que está prohibida de cara al usuario (lib/reciprocity.ts).
// ============================================================================

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSesion } from '@/lib/auth/session'
import { canPublish, reciprocityMessage } from '@/lib/reciprocity'
import { Composer } from '@/components/composer/Composer'
import estilos from './pagina.module.css'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Publicar · Darma',
  description: 'Cuenta lo que te pasa. Te leemos.',
  // Que un buscador no indexe la pantalla donde se escribe. No hay contenido
  // que ofrecer y sí una URL que asociar a una persona.
  robots: { index: false, follow: false },
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

  return (
    <main className={estilos.pagina}>
      <header className={estilos.cabecera}>
        <h1 className={estilos.titulo}>Cuéntanos qué te pasa</h1>
        <p className={estilos.entradilla}>
          Nadie sabe quién eres. Ni nosotros. Escribe con la calma que necesites.
        </p>
      </header>

      <Composer
        mensajeReciprocidad={reciprocityMessage(estado)}
        puedePublicar={canPublish(estado).allowed}
      />
    </main>
  )
}
