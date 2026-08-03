'use client'

// ============================================================================
// FormularioEditar — la única hoja interactiva del perfil.
//
// Cuatro campos: alias, semilla de avatar, bio y disponibilidad. Son EXACTAMENTE
// los del `grant update (alias, avatar_seed, bio, availability)` de 0001, y esa
// coincidencia no es casualidad ni una lista que alguien copió: es que cualquier
// otro campo no daría error al enviarlo, simplemente no se escribiría. Un
// formulario con un campo que la base ignora en silencio es peor que uno que
// falla.
//
// `level` NO está, y no se puede añadir: es una columna GENERADA a partir del
// karma y Postgres rechaza el UPDATE. El nivel se deriva del karma y no se pone
// a mano — que es justo lo que lo hace creíble (Trampa #5 de la ficha).
//
// Es un `<form action={...}>` con Server Action, así que funciona SIN
// JavaScript: el navegador envía el formulario y Next ejecuta la acción. Lo
// único que el JS aporta es el estado de "guardando" y el mensaje de error sin
// recargar.
// ============================================================================

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'

import { Boton } from '../ui/index.ts'
import { SelectorAvatar } from './SelectorAvatar.tsx'
import type { Disponibilidad, EstadoEdicion, PerfilPublico } from './tipos.ts'
import estilos from './perfil.module.css'

export interface FormularioEditarProps {
  perfil: PerfilPublico
  bio: string | null
  /** La Server Action, inyectada desde la página. Se pasa por prop en vez de
   *  importarla aquí para que este componente no dependa de una ruta concreta
   *  y se pueda reutilizar (B19 tiene su propio flujo de edición). */
  accion: (estado: EstadoEdicion, datos: FormData) => Promise<EstadoEdicion>
}

const ESTADO_INICIAL: EstadoEdicion = { ok: false, mensaje: null, campo: null }

const OPCIONES_DISPONIBILIDAD: ReadonlyArray<{ valor: Disponibilidad; texto: string }> = [
  { valor: 'disponible', texto: 'Disponible para escuchar' },
  { valor: 'necesito_hablar', texto: 'Necesito hablar' },
  { valor: 'ausente', texto: 'Ausente' },
]

/** Botón de envío separado para poder usar `useFormStatus`, que solo funciona
 *  DENTRO del `<form>` al que pertenece. */
function BotonGuardar() {
  const { pending } = useFormStatus()
  return (
    <Boton type="submit" cargando={pending}>
      Guardar
    </Boton>
  )
}

export function FormularioEditar({ perfil, bio, accion }: FormularioEditarProps) {
  const [estado, enviar] = useActionState(accion, ESTADO_INICIAL)

  return (
    <form className={estilos.formulario} action={enviar}>
      <div className={estilos.campo}>
        <label className={estilos.etiqueta} htmlFor="alias">
          Alias
        </label>
        <input
          className={estilos.entrada}
          id="alias"
          name="alias"
          type="text"
          defaultValue={perfil.alias}
          minLength={3}
          maxLength={24}
          required
          autoComplete="off"
          // `aria-invalid` es lo que ve el lector de pantalla; el borde rojo del
          // CSS cuelga de ese mismo atributo, así que no puede haber uno sin el
          // otro.
          aria-invalid={estado.campo === 'alias'}
          aria-describedby="pista-alias"
        />
        <p className={estilos.pista} id="pista-alias">
          Entre 3 y 24 caracteres. Letras, números, guiones bajos y espacios. Es
          único: si ya lo tiene alguien, te lo diremos.
        </p>
      </div>

      <SelectorAvatar
        semillaInicial={perfil.avatarSeed}
        alias={perfil.alias}
        nivel={perfil.nivel}
      />

      <div className={estilos.campo}>
        <label className={estilos.etiqueta} htmlFor="bio">
          Sobre ti
        </label>
        <textarea
          className={estilos.area}
          id="bio"
          name="bio"
          defaultValue={bio ?? ''}
          maxLength={280}
          aria-invalid={estado.campo === 'bio'}
          aria-describedby="pista-bio"
        />
        <p className={estilos.pista} id="pista-bio">
          Hasta 280 caracteres. Sin correos, teléfonos, enlaces ni usuarios de
          otras redes: aquí nadie comparte datos de contacto, y es lo que hace
          que este sea un sitio seguro para contar lo que te pasa.
        </p>
      </div>

      <div className={estilos.campo}>
        <label className={estilos.etiqueta} htmlFor="disponibilidad">
          Cómo estás ahora
        </label>
        <select
          className={estilos.selector}
          id="disponibilidad"
          name="disponibilidad"
          defaultValue={perfil.disponibilidad}
        >
          {OPCIONES_DISPONIBILIDAD.map((o) => (
            <option value={o.valor} key={o.valor}>
              {o.texto}
            </option>
          ))}
        </select>
      </div>

      {/* role="status" y no role="alert": el mensaje se anuncia cuando el lector
          termina lo que esté leyendo, en vez de interrumpir a media frase. */}
      {estado.mensaje ? (
        <p className={estado.ok ? estilos.pista : estilos.error} role="status">
          {estado.mensaje}
        </p>
      ) : null}

      <div className={estilos.acciones}>
        <BotonGuardar />
      </div>
    </form>
  )
}
