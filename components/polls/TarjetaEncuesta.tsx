'use client'

// ============================================================================
// La tarjeta de encuesta del feed. El ÚNICO archivo de B09 con JS de cliente.
//
// ── EL AVISO DE ANONIMATO VA ARRIBA, NO ABAJO ──────────────────────────────
// «Tu respuesta es anónima; ni siquiera quien preguntó puede verla» se lee
// ANTES de votar. No es un descargo legal ni un adorno: es la única razón por
// la que alguien responde con honestidad a «¿te sientes solo?» dentro de un
// feed público. Un aviso colocado debajo de los resultados llega cuando ya no
// sirve para decidir.
//
// Y junto a él, «el voto es definitivo», por el mismo motivo y con más urgencia:
// `0002` revoca UPDATE y DELETE sobre `poll_votes`, así que no hay «cambiar de
// respuesta» ni lo habrá. Descubrirlo después de pulsar sería el peor momento
// posible. Esta tarjeta NO ofrece cambiar el voto: si lo ofreciera, la API
// devolvería 403 y parecería un bug (trampa nº 1 de la ficha B09).
//
// ── OPTIMISTA, PERO REVIRTIENDO ────────────────────────────────────────────
// Al pulsar se pinta el estado «votado» antes de que responda el servidor,
// porque en una lista de 20 tarjetas esperar el round-trip hace que la gente
// pulse dos veces. Si el servidor rechaza, se vuelve al estado EXACTO anterior
// —el objeto entero, no un contador decrementado— y se enseña el motivo. Aquí sí
// hay mensaje de error, al revés que en el botón de voto de un post: allí un
// fallo silencioso solo pierde un «me gusta»; aquí la persona cree que ha
// contestado y no lo ha hecho.
//
// ── PRESUPUESTO ────────────────────────────────────────────────────────────
// Un `useState`, un `useTransition` y un `fetch`. Sin librerías de formulario,
// sin cliente de datos, sin animación. Los resultados los pintan
// `BarraResultado` y `EstadoOculto`, que son Server Components y no entran en
// este bundle.
// ============================================================================

import { useState, useTransition } from 'react'

import { Chip, Tarjeta } from '@/components/ui'
import type { EncuestaFeed } from '@/lib/polls/tipos'

import { BarraResultado } from './BarraResultado'
import { EstadoOculto } from './EstadoOculto'
import estilos from './Encuesta.module.css'

export interface TarjetaEncuestaProps {
  encuesta: EncuestaFeed
  /** Se llama tras descartar, para que el feed retire la tarjeta. */
  alDescartar?: (id: string) => void
}

export function TarjetaEncuesta({ encuesta: inicial, alDescartar }: TarjetaEncuestaProps) {
  const [encuesta, setEncuesta] = useState(inicial)
  const [aviso, setAviso] = useState<string | null>(null)
  const [descartada, setDescartada] = useState(false)
  const [enCurso, empezar] = useTransition()

  const heVotado = encuesta.miVoto !== null

  function votar(opcionId: string) {
    if (heVotado || enCurso) return

    const previa = encuesta
    setAviso(null)
    // Optimista: se marca la opción elegida. Los recuentos NO se tocan — no los
    // conocemos, y adivinarlos sería inventar el agregado que esta pantalla
    // existe para proteger.
    setEncuesta({ ...previa, miVoto: opcionId })

    empezar(async () => {
      try {
        const respuesta = await fetch(`/api/polls/${previa.id}/voto`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ opcionId }),
        })
        const cuerpo: unknown = await respuesta.json()

        if (!respuesta.ok || !esOk(cuerpo)) {
          // Se vuelve al objeto ENTERO anterior, no a un campo. Si mientras
          // tanto llegó otro estado, restaurar campo a campo dejaría una mezcla.
          setEncuesta(previa)
          setAviso(mensajeDeError(cuerpo))
          return
        }

        // El servidor devuelve el agregado ya actualizado y con el umbral
        // aplicado: si todavía no se llega a `min_reveal`, viene sin
        // porcentajes incluso para quien acaba de votar.
        setEncuesta(cuerpo.data)
      } catch {
        setEncuesta(previa)
        setAviso('No hemos podido guardar tu respuesta. Inténtalo otra vez.')
      }
    })
  }

  function descartar() {
    setDescartada(true)
    empezar(async () => {
      try {
        await fetch(`/api/polls/${encuesta.id}/descartar`, { method: 'POST' })
      } catch {
        // Se ignora a propósito: descartar es idempotente por clave primaria y
        // el peor caso es que la encuesta vuelva a aparecer más tarde. Devolver
        // la tarjeta a la pantalla porque falló la red sería peor: la persona
        // ya dijo que no la quiere ver.
      }
      alDescartar?.(encuesta.id)
    })
  }

  if (descartada) return null

  return (
    <Tarjeta como="section" className={estilos.tarjeta}>
      <p className={estilos.pregunta}>
        <Chip>Encuesta</Chip> {encuesta.pregunta}
      </p>

      <p className={estilos.anonimato}>
        Tu respuesta es anónima; ni siquiera quien preguntó puede verla.{' '}
        {heVotado ? 'Tu voto ya está guardado y es definitivo.' : 'Solo se responde una vez: el voto es definitivo.'}
      </p>

      {encuesta.revelado ? (
        <ul className={estilos.opciones}>
          {encuesta.opciones.map((o) => (
            <BarraResultado
              key={o.id}
              label={o.label}
              porcentaje={o.porcentaje ?? 0}
              votos={o.votos ?? 0}
              esMiVoto={o.id === encuesta.miVoto}
            />
          ))}
        </ul>
      ) : heVotado ? (
        <EstadoOculto totalVotos={encuesta.totalVotos} heVotado />
      ) : (
        <ul className={estilos.opciones}>
          {encuesta.opciones.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className={estilos.opcion}
                disabled={enCurso}
                onClick={() => votar(o.id)}
              >
                {o.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* `role="status"` y no un `alert`: el fallo de un voto merece leerse, no
          interrumpir lo que la persona esté escuchando. */}
      {aviso ? (
        <p className={estilos.pie} role="status">
          {aviso}
        </p>
      ) : null}

      <div className={estilos.pie}>
        <span>
          {encuesta.totalVotos === 1 ? '1 respuesta' : `${encuesta.totalVotos} respuestas`}
        </span>
        <span className={estilos.acciones}>
          {heVotado ? null : (
            <button type="button" className={estilos.descartar} onClick={descartar} disabled={enCurso}>
              No me interesa
            </button>
          )}
        </span>
      </div>
    </Tarjeta>
  )
}

interface RespuestaOkEncuesta {
  ok: true
  data: EncuestaFeed
}

function esOk(valor: unknown): valor is RespuestaOkEncuesta {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    (valor as { ok?: unknown }).ok === true &&
    typeof (valor as { data?: unknown }).data === 'object' &&
    (valor as { data?: unknown }).data !== null
  )
}

/**
 * El `message` del contrato ya viene escrito para la persona y sin detalle
 * interno (CONTRATOS §4), así que se muestra tal cual. El respaldo existe para
 * el caso en el que la respuesta no tenga la forma esperada — un proxy que
 * devuelve HTML, por ejemplo.
 */
function mensajeDeError(cuerpo: unknown): string {
  if (
    typeof cuerpo === 'object' &&
    cuerpo !== null &&
    typeof (cuerpo as { message?: unknown }).message === 'string'
  ) {
    return (cuerpo as { message: string }).message
  }
  return 'No hemos podido guardar tu respuesta. Inténtalo otra vez.'
}
