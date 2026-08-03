// ============================================================================
// CabeceraPerfil — la misma cabecera para el perfil propio y para el ajeno.
//
// Y aquí está la trampa que la ficha B05 anticipó (Trampa #3): reutilizar el
// componente entre los dos casos es lo correcto, y es también por donde se cuela
// el karma gastable, en forma de una prop opcional que alguien rellena "por
// comodidad" un martes por la tarde.
//
// La defensa no es la disciplina: es que este componente SOLO acepta
// `PerfilPublico`. No hay una prop `karmaSpendable?`, ni `privado?`, ni
// `extra?`. Lo que no se puede pasar no se puede filtrar, y el compilador lo
// impide en el mismo sitio donde se escribiría el error.
//
// Server Component: cero JS de cliente.
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { Avatar, Chip, Insignia } from '../ui/index.ts'
import type { Disponibilidad, PerfilPublico } from './tipos.ts'
import estilos from './perfil.module.css'

export interface CabeceraPerfilProps {
  perfil: PerfilPublico
  /** La bio solo se pinta en el perfil propio: `PerfilAjeno` no la lleva. */
  bio?: string | null
}

/**
 * Clave de catálogo de cada disponibilidad. `necesito_hablar` está escrita en
 * primera persona y sin dramatizar: es la propia persona quien lo ha puesto, y
 * la cabecera de su perfil no es el sitio donde etiquetarla de «en crisis».
 */
const CLAVE_DISPONIBILIDAD: Readonly<Record<Disponibilidad, string>> = {
  disponible: 'perfil.disponibleParaEscuchar',
  necesito_hablar: 'perfil.disponibilidad.necesito_hablar',
  ausente: 'perfil.disponibilidad.ausente',
}

export async function CabeceraPerfil({ perfil, bio }: CabeceraPerfilProps) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <header className={estilos.cabecera}>
      <Avatar semilla={perfil.avatarSeed} tamano={80} alias={perfil.alias} nivel={perfil.nivel} />

      <div className={estilos.identidad}>
        <h1 className={estilos.alias}>{perfil.alias}</h1>

        <div className={estilos.distintivos}>
          <Insignia nivel={perfil.nivel} conEtiqueta />
          {/* `necesito_hablar` en tono 'aviso' y no 'peligro': señala que esta
              persona quiere compañía, no que sea un problema. */}
          <Chip tono={perfil.disponibilidad === 'necesito_hablar' ? 'aviso' : 'neutro'}>
            {t(CLAVE_DISPONIBILIDAD[perfil.disponibilidad])}
          </Chip>
        </div>

        {bio ? <p className={estilos.bio}>{bio}</p> : null}
      </div>
    </header>
  )
}
