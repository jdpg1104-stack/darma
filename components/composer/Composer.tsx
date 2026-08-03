'use client'

// ============================================================================
// Composer — la pantalla donde alguien cuenta lo que le pasa.
//
// ── LO QUE NO SE PUEDE PERDER, PASE LO QUE PASE ────────────────────────────
// El texto. La peor experiencia posible de esta pantalla no es un error del
// servidor: es que alguien tarde media hora en poner en palabras algo que no le
// ha contado a nadie y lo pierda por un `reset()` en un `catch`. De ahí las tres
// reglas del borrador:
//
//   · Se guarda en `localStorage` con debounce de 800 ms, bajo
//     `darma:borrador:v1`.
//   · Se restaura al montar.
//   · Se borra SOLO cuando el servidor ha confirmado la publicación (201). En
//     el `catch` no se toca. Ni en reciprocidad, ni en moderación, ni en rate
//     limit, ni en un 500.
//
// `localStorage` y NO `sessionStorage` ni cookie, y esto es una decisión de
// privacidad, no de comodidad: una cookie VIAJA al servidor en cada petición, y
// un borrador a medio escribir de alguien que está mal es justo lo que no puede
// salir de su dispositivo hasta que decida enviarlo.
//
// ── EL BOTÓN NO SE DESHABILITA POR RECIPROCIDAD ────────────────────────────
// Se deshabilita fuera del rango de longitud, y nada más. Un botón apagado con
// un cartel de «te faltan escuchas» convierte la pantalla en un peaje y le dice
// a alguien que ha venido a desahogarse que primero pague. Se puede escribir
// siempre; lo que se explica es qué falta para publicar, con el copy exacto de
// `lib/reciprocity.ts` (que además tiene prohibida la palabra «crédito»).
//
// Y aunque la UI creyera que sí se puede, el intento se manda igual: la
// autoridad es el trigger de Postgres, no este componente (ver la cabecera de
// lib/reciprocity.ts).
//
// ── COSTE EN CLIENTE ───────────────────────────────────────────────────────
// Un solo componente cliente, sin librerías de formulario ni de estado. Estado
// local con `useState`, guardado con `setTimeout`. `TarjetaRecursos` es un
// Server Component que se renderiza como hijo, así que no suma JS.
// ============================================================================

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Boton, Cargando, Chip } from '@/components/ui'
import { avisoDePii } from './avisoPii.ts'
import { TarjetaRecursos } from './TarjetaRecursos.tsx'
import type { RespuestaPublicar, TarjetaRecursosDatos } from './contrato.ts'
import {
  AYUDA_TIPO,
  CUERPO_AVISO,
  CUERPO_MAX,
  CUERPO_MIN,
  ETIQUETA_TEMA,
  ETIQUETA_TIPO,
  TEMAS,
  TIPOS_POST,
  type TemaDarma,
  type TipoPost,
} from './temas.ts'
import estilos from './Composer.module.css'

/** Clave del borrador. Versionada: si algún día cambia la forma de lo guardado,
 *  `v2` convive con `v1` en vez de romper el borrador de quien no ha recargado. */
export const CLAVE_BORRADOR = 'darma:borrador:v1'
const DEBOUNCE_MS = 800

interface Borrador {
  body: string
  kind: TipoPost
  topic: TemaDarma
}

export interface ComposerProps {
  /** Mensaje EXACTO de `reciprocityMessage()`, calculado en el servidor. No se
   *  reimplementa la regla ni el copy aquí (ficha B03 §4). */
  mensajeReciprocidad: string
  /** Solo para decidir si se ofrece el enlace a escuchar. NO deshabilita nada. */
  puedePublicar: boolean
}

function leerBorrador(): Borrador | null {
  try {
    const crudo = window.localStorage.getItem(CLAVE_BORRADOR)
    if (!crudo) return null
    const dato = JSON.parse(crudo) as Partial<Borrador>
    if (typeof dato.body !== 'string') return null
    return {
      body: dato.body,
      kind: (TIPOS_POST as readonly string[]).includes(dato.kind ?? '')
        ? (dato.kind as TipoPost)
        : 'desahogo',
      topic: (TEMAS as readonly string[]).includes(dato.topic ?? '')
        ? (dato.topic as TemaDarma)
        : 'otro',
    }
  } catch {
    // localStorage puede lanzar (modo privado de Safari, cuota llena, política
    // de terceros). Un borrador que no se puede leer es un borrador que no
    // existe; nunca una pantalla rota.
    return null
  }
}

// ── La puerta de hidratación ────────────────────────────────────────────────
// `useSyncExternalStore` con un `getServerSnapshot` que devuelve `false` es la
// forma canónica de saber «ya estoy en el navegador» sin provocar un desajuste
// de hidratación.
//
// Hace falta porque el borrador vive en `localStorage`, que no existe en el
// servidor. Las dos alternativas se descartaron a conciencia:
//   · `useState(() => localStorage.getItem(...))` → el servidor renderiza el
//     textarea vacío y el cliente con el borrador dentro. React descarta el
//     árbol y vuelve a renderizar, y en un textarea controlado eso es texto que
//     parpadea o se pierde. Inaceptable en la pantalla del borrador.
//   · Restaurar con `setState` dentro de un `useEffect` → es lo que hacía la
//     primera versión y lo que `react-hooks/set-state-in-effect` marca como
//     error: provoca un render en cascada en cada montaje.
// El coste es que el formulario no se renderiza en el servidor. No se pierde
// nada real: enviar exige `fetch`, así que sin JS esta pantalla nunca funcionó.
const suscribirseANada = () => () => {}

export function Composer(props: ComposerProps) {
  const hidratado = useSyncExternalStore(
    suscribirseANada,
    () => true,
    () => false,
  )

  if (!hidratado) return <Cargando variante="texto" etiqueta="Preparando el espacio para escribir…" />

  return <ComposerHidratado {...props} />
}

function ComposerHidratado({ mensajeReciprocidad, puedePublicar }: ComposerProps) {
  // Inicialización perezosa: se ejecuta UNA vez, ya en el navegador, y por eso
  // no necesita ningún efecto ni provoca un segundo render.
  const inicial = useState(() => leerBorrador())[0]

  const [body, setBody] = useState(inicial?.body ?? '')
  const [kind, setKind] = useState<TipoPost>(inicial?.kind ?? 'desahogo')
  const [topic, setTopic] = useState<TemaDarma>(inicial?.topic ?? 'otro')

  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [necesitaEscuchar, setNecesitaEscuchar] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [publicado, setPublicado] = useState(false)
  const [recursos, setRecursos] = useState<TarjetaRecursosDatos | null>(null)

  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ── Guardar con debounce ─────────────────────────────────────────────────
  useEffect(() => {
    if (publicado) return
    if (temporizador.current) clearTimeout(temporizador.current)

    temporizador.current = setTimeout(() => {
      try {
        window.localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ body, kind, topic }))
      } catch {
        // Sin borrador se puede seguir escribiendo y publicando. Fallar aquí
        // sería impedir publicar por no poder guardar una copia.
      }
    }, DEBOUNCE_MS)

    return () => {
      if (temporizador.current) clearTimeout(temporizador.current)
    }
  }, [body, kind, topic, publicado])

  const longitud = body.trim().length
  const fueraDeRango = longitud < CUERPO_MIN || longitud > CUERPO_MAX
  const tonoContador = longitud > CUERPO_MAX || (longitud > 0 && longitud < CUERPO_MIN)
    ? 'contadorError'
    : longitud >= CUERPO_AVISO
      ? 'contadorAviso'
      : 'contadorNormal'

  // El aviso de PII salta al PERDER EL FOCO, no en cada tecla: avisar mientras
  // alguien teclea su número interrumpe la frase a medias y además dispara con
  // cualquier cifra larga a medio escribir.
  const alPerderFoco = useCallback(() => {
    setAviso(avisoDePii(body))
  }, [body])

  async function publicar() {
    setError(null)
    setNecesitaEscuchar(false)
    setEnviando(true)

    try {
      const respuesta = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Se manda EXACTAMENTE lo que el contrato acepta. La ruta valida con
        // `.strict()`, así que un campo de más sería un 422, no un campo
        // ignorado.
        body: JSON.stringify({ body: body.trim(), kind, topic }),
      })

      const sobre = (await respuesta.json()) as
        | { ok: true; data: RespuestaPublicar }
        | { ok: false; code: string; message: string }

      if (!sobre.ok) {
        // ── EL CATCH NO TOCA EL BORRADOR ───────────────────────────────────
        // Ni aquí ni más abajo. Sin `router.push`, sin `setBody('')`, sin
        // `form.reset()`. El texto se queda en pantalla y en localStorage.
        setError(sobre.message)
        setNecesitaEscuchar(sobre.code === 'reciprocidad')
        return
      }

      // Solo aquí, con el 201 ya confirmado por el servidor, se borra.
      try {
        window.localStorage.removeItem(CLAVE_BORRADOR)
      } catch {
        // Si no se puede borrar, el borrador sobrante es inofensivo.
      }

      setPublicado(true)
      setRecursos(sobre.data.recursos)
    } catch (causa) {
      // Red caída, JSON ilegible, navegación a medias. Mismo trato: se explica
      // y se conserva el texto.
      setError('No hemos podido enviarlo. Tu texto sigue aquí; inténtalo otra vez.')
      if (process.env.NODE_ENV !== 'production') console.warn('[darma][composer]', causa)
    } finally {
      setEnviando(false)
    }
  }

  // ── Publicado ────────────────────────────────────────────────────────────
  if (publicado) {
    return (
      <div className={estilos.publicado}>
        <p className={estilos.confirmacion} role="status">
          Ya está publicado. Alguien lo va a leer.
        </p>

        {/* Los recursos van AQUÍ, en la misma pantalla, sin navegación
            intermedia (CONTRATOS §9.1). Y el post sigue publicado y activo: se
            prioriza, no se esconde. */}
        {recursos ? <TarjetaRecursos datos={recursos} /> : null}

        <a className={estilos.enlaceSecundario} href="/feed">
          Volver al feed
        </a>
      </div>
    )
  }

  return (
    <form
      className={estilos.formulario}
      onSubmit={(evento) => {
        evento.preventDefault()
        void publicar()
      }}
    >
      {/* ── Tipo ──────────────────────────────────────────────────────────── */}
      <fieldset className={estilos.grupo}>
        <legend className={estilos.leyenda}>¿Qué vienes a hacer?</legend>
        <div className={estilos.opciones}>
          {TIPOS_POST.map((valor) => (
            <label key={valor} className={estilos.opcion}>
              <input
                type="radio"
                name="kind"
                value={valor}
                checked={kind === valor}
                onChange={() => setKind(valor)}
                className={estilos.radio}
              />
              <span className={estilos.opcionTexto}>
                <span className={estilos.opcionTitulo}>{ETIQUETA_TIPO[valor]}</span>
                <span className={estilos.opcionAyuda}>{AYUDA_TIPO[valor]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── Cuerpo ────────────────────────────────────────────────────────── */}
      <div className={estilos.grupo}>
        <label className={estilos.leyenda} htmlFor="composer-body">
          Cuéntanoslo
        </label>
        <textarea
          id="composer-body"
          className={estilos.textarea}
          value={body}
          onChange={(evento) => setBody(evento.target.value)}
          onBlur={alPerderFoco}
          rows={10}
          // `maxLength` no se pone a propósito: cortar el texto de alguien a
          // mitad de palabra sin decir nada es peor que dejarle pasarse y
          // avisarle. El contador ya lo dice y el botón ya se apaga.
          placeholder="No hace falta que quede bien. Escribe como te salga."
          aria-describedby="composer-contador"
          // Sin corrección automática de nombres propios y sin autocompletado:
          // el navegador no debe guardar en su historial de formularios lo que
          // alguien escribe aquí.
          autoComplete="off"
          spellCheck
        />

        <div className={estilos.piePista}>
          <span
            id="composer-contador"
            className={`${estilos.contador} ${estilos[tonoContador]}`}
            // El contador cambia con cada tecla; anunciarlo cada vez sería un
            // lector de pantalla contando en voz alta sin parar.
            aria-live="off"
          >
            {longitud} / {CUERPO_MAX}
            {longitud > 0 && longitud < CUERPO_MIN ? ` · faltan ${CUERPO_MIN - longitud}` : ''}
          </span>
        </div>
      </div>

      {/* ── Tema ──────────────────────────────────────────────────────────── */}
      <div className={estilos.grupo}>
        <label className={estilos.leyenda} htmlFor="composer-topic">
          ¿De qué va?
        </label>
        <select
          id="composer-topic"
          className={estilos.select}
          value={topic}
          onChange={(evento) => setTopic(evento.target.value as TemaDarma)}
        >
          {TEMAS.map((valor) => (
            <option key={valor} value={valor}>
              {ETIQUETA_TEMA[valor]}
            </option>
          ))}
        </select>
      </div>

      {/* ── Aviso de datos de contacto (cortesía; la barrera es el servidor) ─ */}
      {aviso ? (
        <p className={estilos.aviso} role="status">
          <Chip tono="aviso">Revisa esto</Chip> {aviso}
        </p>
      ) : null}

      {/* ── Estado de reciprocidad ────────────────────────────────────────── */}
      <p className={estilos.reciprocidad}>
        {mensajeReciprocidad}
        {!puedePublicar ? (
          <>
            {' '}
            <a className={estilos.enlaceSecundario} href="/feed">
              Ir a escuchar
            </a>
          </>
        ) : null}
      </p>

      {/* ── Error del servidor ────────────────────────────────────────────── */}
      {error ? (
        <p className={estilos.error} role="alert">
          {error}
          {necesitaEscuchar ? (
            <>
              {' '}
              <a className={estilos.enlaceSecundario} href="/feed">
                Ir a escuchar
              </a>
            </>
          ) : null}
        </p>
      ) : null}

      <Boton
        type="submit"
        variante="primario"
        tamano="lg"
        bloque
        cargando={enviando}
        // SOLO la longitud. Nunca la reciprocidad (ver cabecera del archivo).
        disabled={fueraDeRango || enviando}
      >
        Publicar
      </Boton>
    </form>
  )
}
