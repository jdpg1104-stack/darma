'use client'

// ============================================================================
// B07 · Una tarjeta del feed vertical.
//
// ── LO QUE ESTA TARJETA NO DECIDE ──────────────────────────────────────────
// No decide si reproduce (lo decide el coordinador de autoplay), no decide si
// suena (lo decide el desbloqueo de audio) y, sobre todo, NO decide si el vídeo
// está completado. Manda latidos mientras reproduce y, cuando el servidor
// responde `listo: true`, pregunta. La respuesta manda: si el servidor dice que
// no, aquí no hay +1 aunque el reproductor jure que el vídeo terminó.
//
// ── EL BUCLE DE LATIDOS ────────────────────────────────────────────────────
// Late cada 5 s SOLO si (a) el reproductor está en «reproduciendo» y (b) la
// pestaña es visible. La segunda condición importa: sin ella, una pestaña en
// segundo plano seguiría acreditando tiempo, que es la forma más cómoda de
// farmear el +1 sin ni siquiera mirar. (El servidor también lo topa por su
// cuenta; esto es cortesía con la batería y con su rate limit, no la defensa.)
// ============================================================================

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { useTraductor } from '@/i18n/Proveedor'
import { urlEmbedDeItem } from '@/lib/video/embed'
import { INTERVALO_LATIDO_MS, objetivoCompletado } from '@/lib/video/acreditacion'
import { ESTADO, enviarComando, parsearMensaje, suscribirse } from '@/lib/video/reproductor'
import { MARCADO_STUB_REPRODUCTOR, stubReproductorActivo } from '@/lib/video/stubE2E'
import type { EstadoLatido, ItemVideo, ResultadoCompletado } from '@/lib/video/tipos'
import { useAutoplayEnVista, useAutoplayPermitido } from './useAutoplayEnVista'
import { puedeSonar, useDesbloqueoAudio } from './desbloqueoAudio'
import estilos from './FeedVertical.module.css'

export interface TarjetaVideoProps {
  item: ItemVideo
  /** ¿Monta iframe? Solo la activa y sus dos vecinas (`ventanaDeIframes`). */
  conIframe: boolean
  /** Se avisa cuando el servidor concede el +1, para que el feed lo celebre. */
  alCompletar?: (item: ItemVideo, resultado: ResultadoCompletado) => void
}

type Envoltorio<T> = { ok: true; data: T } | { ok: false; code: string; message: string }

async function pedir<T>(ruta: string, cuerpo?: unknown): Promise<T | null> {
  try {
    const respuesta = await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo ?? {}),
    })
    const json = (await respuesta.json()) as Envoltorio<T>
    return json.ok ? json.data : null
  } catch {
    // Red caída o navegación en curso. El siguiente latido reintenta; no hay
    // nada que enseñarle a la persona por un latido perdido.
    return null
  }
}

/** Para valores externos que no cambian tras el arranque: nada que suscribir. */
function suscripcionVacia(): () => void {
  return () => {}
}

/** Instantánea del cliente una vez montado. */
function instantaneaVerdadera(): boolean {
  return true
}

/** Lo que pinta el servidor (y la hidratación): sin stub y sin iframe. */
function instantaneaFalsaEnServidor(): boolean {
  return false
}

export function TarjetaVideo({ item, conIframe, alCompletar }: TarjetaVideoProps) {
  const t = useTraductor()
  const [nodo, setNodo] = useState<HTMLElement | null>(null)
  const marco = useRef<HTMLIFrameElement | null>(null)
  const sesionId = useRef<string | null>(null)
  const reproduciendo = useRef(false)
  const completadoPedido = useRef(false)

  const activo = useAutoplayEnVista(item.id, nodo)
  const autoplay = useAutoplayPermitido()
  const audioDesbloqueado = useDesbloqueoAudio()

  // Espejo en estado del `reproduciendo` de la ref, SOLO para pintar
  // `data-reproduciendo` en el DOM. La ref sigue mandando en la lógica (los
  // latidos la leen sin re-render); el atributo existe para que quien mire el
  // DOM —una persona con inspector, un test— sepa si el vídeo suena, y para
  // que un click de «reproducir» pueda no enviarse cuando ya reproduce.
  const [reproduciendoUi, setReproduciendoUi] = useState(false)

  const [faltan, setFaltan] = useState<number>(objetivoCompletado(item.duracionSegundos))
  const [completado, setCompletado] = useState(item.completado)

  // ── Stub e2e del reproductor ──────────────────────────────────────────────
  // `useSyncExternalStore` y no estado + efecto: el fusible es un valor externo
  // a React que no cambia tras el arranque. La instantánea del servidor (y de
  // la hidratación) es `false` —el servidor no sabe de fusibles—, y React
  // re-lee la del cliente justo después de montar: sin discrepancia de
  // hidratación y sin setState dentro de un efecto. En un build sin la
  // bandera, la instantánea del cliente es `false` constante: código muerto.
  const stub = useSyncExternalStore(suscripcionVacia, stubReproductorActivo, instantaneaFalsaEnServidor)

  // ── El iframe se monta SOLO en el cliente ─────────────────────────────────
  // El src lleva `origin=` y en el servidor `origenPropio()` solo puede
  // adivinar NEXT_PUBLIC_SITE_URL: con cualquier origen real distinto (otro
  // puerto en desarrollo, la suite e2e, un preview de Vercel) el src del
  // servidor y el del cliente difieren, React declara discrepancia de
  // hidratación y recrea el subárbol — con el iframe cargando DOS veces. La
  // miniatura que pinta el servidor es exactamente lo que se vería mientras el
  // reproductor carga, así que el primer fotograma no pierde nada.
  const hidratado = useSyncExternalStore(
    suscripcionVacia,
    instantaneaVerdadera,
    instantaneaFalsaEnServidor,
  )

  // Bajo el stub, el srcdoc hereda NUESTRO origen; `undefined` deja actuar el
  // valor por defecto (youtube-nocookie) en reproductor.ts, de modo que el
  // camino real no toca la barrera. Cuando `stub` es true ya estamos en el
  // navegador: `window` existe.
  const origenWidget = stub ? window.location.origin : undefined

  const objetivo = objetivoCompletado(item.duracionSegundos)
  const progreso = objetivo === 0 ? 1 : Math.min(1, (objetivo - faltan) / objetivo)

  const src = conIframe && hidratado ? urlEmbedDeItem(item) : null

  // ── Escucha del reproductor ───────────────────────────────────────────────
  useEffect(() => {
    if (!src) return

    function alMensaje(evento: MessageEvent) {
      // LA BARRERA. `parsearMensaje` descarta todo lo que no venga del ÚNICO
      // origen esperado (youtube-nocookie; el propio, bajo el stub e2e). Sin
      // esta comprobación cualquier iframe podría fingir un «vídeo terminado»
      // y disparar la llamada a /completado.
      const mensaje = parsearMensaje({ origin: evento.origin, data: evento.data }, origenWidget)
      if (!mensaje) return
      if (evento.source !== marco.current?.contentWindow) return

      if (mensaje.estado === ESTADO.REPRODUCIENDO) {
        reproduciendo.current = true
        setReproduciendoUi(true)
      }
      if (mensaje.estado === ESTADO.PAUSADO || mensaje.estado === ESTADO.TERMINADO) {
        reproduciendo.current = false
        setReproduciendoUi(false)
      }
    }

    window.addEventListener('message', alMensaje)
    return () => window.removeEventListener('message', alMensaje)
  }, [origenWidget, src])

  // Suscripción + arranque, compartido entre el efecto del coordinador y el
  // `load` del iframe (ver el comentario del `onLoad`).
  const engancharReproductor = useCallback(() => {
    const ventana = marco.current?.contentWindow
    if (!ventana) return

    suscribirse(ventana, item.id, origenWidget)
    // Ser la tarjeta actual no implica arrancar: con `prefers-reduced-motion`
    // o `saveData` la reproducción espera al toque de la persona (alTocar).
    // La suscripción sí se abre siempre — sin ella los mensajes del reproductor
    // no llegan y los latidos del arranque manual no acreditarían nada.
    if (autoplay) {
      enviarComando(ventana, 'playVideo', origenWidget)
      enviarComando(ventana, audioDesbloqueado && puedeSonar() ? 'unMute' : 'mute', origenWidget)
    }
  }, [audioDesbloqueado, autoplay, item.id, origenWidget])

  // ── Abrir sesión y encender/apagar según el coordinador ───────────────────
  useEffect(() => {
    const ventana = marco.current?.contentWindow
    if (!ventana) return

    if (!activo) {
      // Apagar SIEMPRE, aunque el estado local diga que no reproducía: el
      // coordinador apaga antes de encender, y un fallo aquí es el segundo
      // vídeo sonando de fondo.
      enviarComando(ventana, 'pauseVideo', origenWidget)
      reproduciendo.current = false
      // El espejo de UI se adelanta en microtarea, no en el cuerpo del efecto
      // (regla react-compiler: un setState síncrono aquí dispara renders en
      // cascada). El PAUSADO del reproductor lo confirmará por mensaje igual.
      queueMicrotask(() => setReproduciendoUi(false))
      return
    }

    engancharReproductor()
  }, [activo, engancharReproductor, origenWidget, src])

  // ── El bucle de latidos ───────────────────────────────────────────────────
  const latir = useCallback(async () => {
    if (completado) return
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (!reproduciendo.current) return

    if (!sesionId.current) {
      const abierta = await pedir<{ sesionId: string }>(`/api/content/${item.id}/sesion`)
      if (!abierta) return
      sesionId.current = abierta.sesionId
    }

    const estado = await pedir<EstadoLatido>(`/api/content/${item.id}/latido`, {
      sesionId: sesionId.current,
    })
    if (!estado) return

    setFaltan(estado.faltan)

    if (estado.listo && !completadoPedido.current) {
      completadoPedido.current = true
      const resultado = await pedir<ResultadoCompletado>(`/api/content/${item.id}/completado`, {
        sesionId: sesionId.current,
      })
      if (resultado) {
        // `acreditado: true` incluye el caso `tope_diario` (karma 0): la persona
        // SÍ completó el vídeo, simplemente hoy ya no acumula. La tarjeta lo
        // refleja como completado, que es la verdad.
        if (resultado.acreditado) setCompletado(true)
        alCompletar?.(item, resultado)
      }
    }
  }, [alCompletar, completado, item])

  useEffect(() => {
    if (!activo || completado) return
    const reloj = setInterval(() => void latir(), INTERVALO_LATIDO_MS)
    return () => clearInterval(reloj)
  }, [activo, completado, latir])

  // ── Toque en la tarjeta: reproducir/pausar a mano ─────────────────────────
  function alTocar() {
    const ventana = marco.current?.contentWindow
    if (!ventana) return

    if (reproduciendo.current) {
      enviarComando(ventana, 'pauseVideo', origenWidget)
      reproduciendo.current = false
      setReproduciendoUi(false)
    } else {
      enviarComando(ventana, 'playVideo', origenWidget)
      // El toque ES activación de usuario, así que aquí sí se puede desmutear.
      enviarComando(ventana, 'unMute', origenWidget)
    }
  }

  return (
    <article
      id={item.id}
      className={estilos.tarjeta}
      ref={setNodo}
      data-activo={activo || undefined}
      data-reproduciendo={reproduciendoUi || undefined}
    >
      {src ? (
        <iframe
          ref={marco}
          className={estilos.medio}
          // Bajo el stub e2e el documento es un `srcdoc` (hereda nuestro
          // origen, no toca la red); en el camino real, el widget de YouTube.
          {...(stub ? { srcDoc: MARCADO_STUB_REPRODUCTOR } : { src })}
          title={item.titulo}
          allow="autoplay; encrypted-media; picture-in-picture"
          // `sandbox` no se pone: la IFrame API necesita `allow-same-origin` +
          // `allow-scripts` para responder a postMessage, y esa combinación
          // anula el sandbox. El aislamiento real lo da la CSP (`frame-src` con
          // un único origen) y `frame-ancestors 'none'`.
          loading="lazy"
          // El iframe puede terminar de cargar DESPUÉS de que el efecto del
          // coordinador enviara `listening`/`playVideo`: un postMessage a un
          // documento a medio cargar se entrega al about:blank inicial y se
          // pierde sin error. Reengancharse en `load` cierra esa carrera —
          // con el widget real y con el stub. Repetir la suscripción o el
          // `playVideo` es idempotente para los dos.
          onLoad={() => {
            if (activo) engancharReproductor()
          }}
        />
      ) : item.miniaturaUrl ? (
        <Image
          className={`${estilos.medio} ${estilos.miniatura}`}
          src={item.miniaturaUrl}
          alt=""
          fill
          sizes="100vw"
          // Solo la primera tarjeta puede ser el LCP; las demás no deben
          // competir por el ancho de banda inicial.
          loading="lazy"
        />
      ) : null}

      {!audioDesbloqueado ? (
        <button
          type="button"
          className={estilos.silencio}
          onClick={alTocar}
          aria-label={t('contenido.activarSonido')}
        >
          🔇
        </button>
      ) : null}

      <button
        type="button"
        className={estilos.toque}
        onClick={alTocar}
        aria-label={t('contenido.reproducirPausar', { titulo: item.titulo })}
      />

      <div className={estilos.capa}>
        <h2 className={estilos.titulo}>{item.titulo}</h2>
        <p className={estilos.meta}>
          <span>{item.fuente}</span>
          {item.tema ? <span>· {item.tema}</span> : null}
        </p>

        {completado ? (
          <span className={estilos.completado}>✓ {t('contenido.completado')}</span>
        ) : (
          <span
            className={estilos.progreso}
            role="progressbar"
            aria-label={t('contenido.progreso')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progreso * 100)}
          >
            <span
              className={estilos.progresoRelleno}
              style={{ width: `${Math.round(progreso * 100)}%` }}
            />
          </span>
        )}
      </div>
    </article>
  )
}
