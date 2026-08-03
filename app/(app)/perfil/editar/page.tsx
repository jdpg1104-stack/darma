// ============================================================================
// /perfil/editar — Server Component que solo carga los datos y monta el
// formulario. La única hoja de cliente es `FormularioEditar`.
//
// Una consulta: `profiles` por PK, columnas públicas. No se lee nada privado
// aquí porque no se edita nada privado — los cuatro campos editables (alias,
// avatar_seed, bio, availability) están todos en el `grant select` público.
// ============================================================================

import Link from 'next/link'

import { requirePerfil } from '@/lib/auth/session'
import { FormularioEditar } from '@/components/perfil/FormularioEditar'
import { leerPerfilEditable } from '@/components/perfil/consultas'
import { editarPerfil } from './acciones'
import estilos from '@/components/perfil/perfil.module.css'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Editar tu perfil · Darma',
  robots: { index: false, follow: false },
}

export default async function PaginaEditarPerfil() {
  const sesion = await requirePerfil()

  // UNA consulta a las columnas públicas por PK. No se piden saldos: esta
  // pantalla no los pinta ni los edita, y traerlos "por si acaso" es cómo un
  // campo privado acaba en el HTML de una página que no lo necesitaba.
  const propio = await leerPerfilEditable(sesion.userId)
  if (!propio) notFound()

  return (
    <div className={estilos.pagina}>
      <h1 className={estilos.alias}>Editar tu perfil</h1>

      <p className={estilos.pista}>
        Tu nivel y tu karma no se editan: se derivan de lo que haces. Es lo que
        hace que signifiquen algo.
      </p>

      <FormularioEditar perfil={propio.perfil} bio={propio.bio} accion={editarPerfil} />

      <div className={estilos.acciones}>
        <Link className={estilos.enlaceAccion} href="/perfil">
          Volver a tu perfil
        </Link>
      </div>
    </div>
  )
}
