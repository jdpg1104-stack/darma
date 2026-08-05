'use client'

// ============================================================================
// CompositorRespuesta — donde se escribe la escucha.
//
// ── EL BORRADOR LOCAL NO ES UNA COMODIDAD ──────────────────────────────────
// Se guarda en `localStorage` con la clave `darma:respuesta:<postId>` en cada
// tecla. Alguien que está escribiéndole algo cuidado a un desconocido y pierde
// el texto por un cambio de pestaña o una recarga, no lo vuelve a escribir: se
// va. El borrador se borra en cuanto el envío tiene éxito, y solo entonces.
//
// ── EL MÍNIMO DE 40 CARACTERES SE EXPLICA, NO SE IMPONE ────────────────────
// Es el `CHECK` de `comments.body` y una decisión de producto: un comentario de
// 20 caracteres no acompaña a nadie. Pero el contador dice cuánto falta en vez
// de deshabilitar el botón en silencio, porque un botón muerto sin explicación
// se lee como «no puedo escribir aquí».
//
// ── LO QUE SE MUESTRA AL VOLVER ────────────────────────────────────────────
// El resultado REAL: si contó como escucha, cuánto karma se pagó de verdad
// (puede ser menos de 10 por el tope diario) y, si no contó, qué le falta al
// mensaje. Y si el texto disparó la detección de crisis, la tarjeta de recursos
// aparece en ESTA misma pantalla (CONTRATOS §9): quien lo escribió está mirando
// aquí ahora, no su correo.
// ============================================================================

import { useState } from 'react'
import { Boton, Tarjeta } from '@/components/ui'
import { OptInPush } from '@/components/pwa'
import { useTraductor } from '@/i18n/Proveedor'
import { MIN_COMMENT_LENGTH, MAX_COMMENT_LENGTH } from '@/lib/moderation'
import type { RespuestaComentar, TarjetaRecursosDatos } from '@/app/api/comments/tipos'
import { EstadoValidacion, type Estado } from './EstadoValidacion.tsx'
import estilos from './hilo.module.css'

export interface CompositorRespuestaProps {
  postId: string
  /** Se llama con el comentario recién creado para pintarlo sin recargar. */
  alPublicar?: (respuesta: RespuestaComentar) => void
}

interface SobreComentar {
  ok: boolean
  data?: RespuestaComentar
  message?: string
}

function clave(postId: string): string {
  return `darma:respuesta:${postId}`
}

/**
 * Lee el borrador. Devuelve '' en el servidor y también si `localStorage` no
 * está disponible (modo privado, cuota llena): sin borrador se puede escribir
 * igual, así que nunca es un error que valga la pena mostrar.
 */
function leerBorrador(postId: string): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(clave(postId)) ?? ''
  } catch {
    return ''
  }
}

function guardarBorrador(postId: string, valor: string): void {
  try {
    window.localStorage.setItem(clave(postId), valor)
  } catch {
    /* ídem */
  }
}

export function CompositorRespuesta({ postId, alPublicar }: CompositorRespuestaProps) {
  // Inicializador perezoso y no un `useEffect`: recuperar el borrador dentro de
  // un efecto obliga a un `setState` síncrono que provoca un segundo render en
  // cascada (y el lint del repo lo prohíbe con razón). El coste es que el HTML
  // del servidor va vacío y el cliente arranca con el texto; de ahí el
  // `suppressHydrationWarning` del textarea, que es exactamente para esto: un
  // valor que solo existe en el navegador.
  const t = useTraductor()
  const [texto, setTexto] = useState(() => leerBorrador(postId))
  const [enviando, setEnviando] = useState(false)
  const [estado, setEstado] = useState<Estado | null>(null)
  const [motivo, setMotivo] = useState<string | null>(null)
  const [karma, setKarma] = useState(0)
  const [credito, setCredito] = useState(0)
  const [recursos, setRecursos] = useState<TarjetaRecursosDatos | null>(null)
  const [error, setError] = useState<string | null>(null)

  function cambiar(valor: string) {
    setTexto(valor)
    // En cada tecla. Alguien que está escribiéndole algo cuidado a un
    // desconocido y pierde el texto por una recarga no lo vuelve a escribir.
    guardarBorrador(postId, valor)
  }

  const longitud = texto.trim().length
  const faltan = Math.max(0, MIN_COMMENT_LENGTH - longitud)
  const puedeEnviar = longitud >= MIN_COMMENT_LENGTH && longitud <= MAX_COMMENT_LENGTH && !enviando

  async function enviar(evento: React.FormEvent) {
    evento.preventDefault()
    if (!puedeEnviar) return

    setEnviando(true)
    setError(null)
    setEstado('en_revision')

    try {
      const respuesta = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ postId, body: texto.trim() }),
      })
      const sobre = (await respuesta.json()) as SobreComentar

      if (!sobre.ok || !sobre.data) {
        setEstado(null)
        // El mensaje del servidor ya está escrito para personas y nunca trae
        // detalle interno (`lib/auth/errores.ts`): se muestra tal cual.
        setError(sobre.message ?? t('hilo.errorPublicar'))
        return
      }

      const datos = sobre.data
      setEstado(datos.validacion.estado)
      setMotivo(datos.validacion.motivo)
      setKarma(datos.karmaGanado)
      setCredito(datos.creditoGanado)
      setRecursos(datos.recursos)

      // El borrador se borra SOLO cuando el servidor confirmó. Si el comentario
      // no validó, el texto se conserva para poder mejorarlo.
      if (datos.validacion.estado === 'valido') {
        setTexto('')
        try {
          window.localStorage.removeItem(clave(postId))
        } catch {
          /* ídem */
        }
      }

      alPublicar?.(datos)
    } catch {
      setEstado(null)
      setError(t('hilo.errorPublicar'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Tarjeta como="section">
      <form onSubmit={enviar}>
        <label className={estilos.oculto} htmlFor={`respuesta-${postId}`}>
          {t('hilo.etiquetaRespuesta')}
        </label>
        <textarea
          id={`respuesta-${postId}`}
          data-testid="hilo-campo-respuesta"
          suppressHydrationWarning
          className={estilos.campo}
          value={texto}
          onChange={(e) => cambiar(e.target.value)}
          maxLength={MAX_COMMENT_LENGTH}
          placeholder={t('hilo.responderMarcador')}
          aria-describedby={`contador-${postId}`}
        />

        <div className={estilos.pie}>
          <span
            id={`contador-${postId}`}
            className={`${estilos.contador} ${faltan > 0 ? estilos.contadorLimite : ''}`}
          >
            {faltan > 0
              ? t('hilo.faltanCaracteres', { n: faltan })
              : t('publicar.contador', { n: longitud, max: MAX_COMMENT_LENGTH })}
          </span>
          <Boton
            type="submit"
            disabled={!puedeEnviar}
            cargando={enviando}
            data-testid="hilo-boton-responder"
          >
            {t('hilo.responder')}
          </Boton>
        </div>
      </form>

      {estado ? (
        <EstadoValidacion
          estado={estado}
          motivo={motivo}
          karmaGanado={karma}
          creditoGanado={credito}
        />
      ) : null}

      {/* El momento oportuno del opt-in de push (B13): la persona acaba de ver
          que su comentario contó. Solo con `estado === 'valido'` — tras un «no
          válido» o durante la revisión no hay nada que avisar y pedir permiso
          ahí sería pedirlo en el vacío. Si no es realmente su primer comentario
          validado, el propio componente deja de preguntar (aceptado o tres
          «ahora no»); jamás va en un layout: ver la cabecera de OptInPush. */}
      {estado === 'valido' ? <OptInPush momento="primer_comentario_validado" /> : null}

      {error ? (
        <p className={estilos.aviso} role="status" data-testid="hilo-error">
          {error}
        </p>
      ) : null}

      {recursos ? (
        // `tarjeta-recursos`: el MISMO testid que la tarjeta del composer y la
        // del refugio (pedido de B18 en PEDIDOS.md). El marcado sigue siendo el
        // que era; unificarlo de verdad en un componente único sigue pendiente.
        <Tarjeta
          como="section"
          acento="crisis"
          className={estilos.recursos}
          data-testid="tarjeta-recursos"
        >
          <p className={estilos.cuerpo}>{recursos.mensaje}</p>
          <ul>
            {recursos.recursos.map((r) => (
              <li key={r.name}>
                {r.name}
                {r.phone ? ` · ${r.phone}` : ''}
                {r.url ? (
                  <>
                    {' · '}
                    <a href={r.url} rel="noreferrer noopener" target="_blank">
                      {r.url}
                    </a>
                  </>
                ) : null}
                {` · ${r.hours}`}
              </li>
            ))}
          </ul>
        </Tarjeta>
      ) : null}
    </Tarjeta>
  )
}
