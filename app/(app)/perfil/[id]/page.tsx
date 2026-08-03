// ============================================================================
// /perfil/[id] — el perfil de OTRA persona. Server Component.
//
// UNA consulta a `profiles` por clave primaria. Nada más: ni ledger (es privado
// por RLS de todos modos), ni agregados, ni contadores.
//
// ── LO QUE NO PUEDE SALIR DE AQUÍ ──────────────────────────────────────────
// `karma_spendable`, `crystals`, `listen_credits`, `daily_karma_earned`,
// `daily_karma_date`, `shadow_banned`, `banned_until`, `entry_level`,
// `streak_days` y `last_seen_at` con precisión de minutos.
//
// Y no salen por tres motivos apilados, en este orden de importancia:
//
//  1. **Postgres no los deja leer.** `authenticated` no tiene privilegio de
//     columna sobre ninguno; el intento devuelve `42501 permission denied`.
//     Verificado con dos sesiones reales de usuario contra darma-dev.
//  2. **El tipo no los tiene.** `PerfilAjeno` no declara esos campos, así que
//     no hay forma de escribirlos aquí sin que el compilador lo impida.
//  3. **La proyección los descarta.** `perfilAjenoDesdeFila()` construye el
//     objeto campo a campo, y hay un test que recorre su JSON serializado
//     buscando literalmente `karma_spendable`, `crystals`, `listen_credits`,
//     `shadow_banned` y `banned_until`.
//
// `shadow_banned` merece la nota aparte que ya trae 0001: si el perfil ajeno lo
// expusiera, cualquiera podría comprobar su propio shadow-ban mirando su perfil
// desde una segunda cuenta, y el mecanismo dejaría de funcionar el mismo día.
//
// `last_seen_at` parece inofensivo y es el que más cuesta ver: la hora exacta de
// conexión es un dato de comportamiento que permite correlacionar dos cuentas
// anónimas de la misma persona. Ni se muestra ni se redondea — no aparece.
// ============================================================================

import { notFound, redirect } from 'next/navigation'

import { requirePerfil } from '@/lib/auth/session'
import { CabeceraPerfil } from '@/components/perfil/CabeceraPerfil'
import { RejillaInsignias } from '@/components/perfil/RejillaInsignias'
import { leerPerfilAjeno } from '@/components/perfil/consultas'
import { esquemaIdPerfil } from '@/components/perfil/validacion'
import { MedidorKarma } from '@/components/ui'
import estilos from '@/components/perfil/perfil.module.css'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Perfil · Darma',
  robots: { index: false, follow: false },
}

export default async function PaginaPerfilAjeno({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  // Exige sesión: `profiles_read` solo concede lectura a `authenticated`, así
  // que sin sesión esta consulta no devolvería nada de todas formas. Pedirla
  // aquí convierte un vacío inexplicable en un redirect al login.
  const sesion = await requirePerfil()

  const { id } = await params

  // Un id que no es un uuid es un 404, no un 500: la ruta se puede escribir a
  // mano y `?id=eq.<basura>` en PostgREST devolvería un error de tipo con el
  // nombre de la columna dentro.
  const analizado = esquemaIdPerfil.safeParse(id)
  if (!analizado.success) notFound()

  // Tu propio perfil por su id es tu perfil, con todo lo tuyo. Sin este
  // desvío verías tu propia página recortada y parecería un fallo.
  if (analizado.data === sesion.userId) redirect('/perfil')

  const ajeno = await leerPerfilAjeno(analizado.data)
  // No existe, o RLS no lo devuelve. Para quien mira es lo mismo, y debe serlo:
  // distinguir los dos casos convierte la ruta en un oráculo de existencia de
  // cuentas.
  if (!ajeno) notFound()

  return (
    <div className={estilos.pagina}>
      <CabeceraPerfil perfil={ajeno.perfil} />

      <section className={estilos.seccion} aria-labelledby="titulo-nivel-ajeno">
        <h2 className={estilos.tituloSeccion} id="titulo-nivel-ajeno">
          Nivel
        </h2>
        {/* `MedidorKarma` solo acepta `karmaReputacion`: por diseño de B16 no
            tiene dónde recibir el saldo gastable ni los cristales. */}
        <MedidorKarma karmaReputacion={ajeno.perfil.karmaReputacion} />
      </section>

      <RejillaInsignias
        insignias={ajeno.insignias}
        titulo="Insignias"
        textoVacio="Todavía no hay insignias que enseñar aquí."
      />
    </div>
  )
}
