'use client'

// ============================================================================
// B13 · Opt-in de notificaciones · el error que no se puede deshacer
//
// ── POR QUÉ ESTE COMPONENTE NO SE MONTA EN EL LAYOUT ──────────────────────
// `Notification.requestPermission()` en el primer render se deniega, y la
// denegación de Chrome es PERMANENTE para el origen: la persona tendría que
// entrar en la configuración del sitio para revertirla. No hay despliegue que
// lo arregle. Por eso este componente exige una prop `momento` y no se pinta
// sin ella: se monta EN el punto del flujo donde la notificación acaba de tener
// sentido —cuando el primer comentario de alguien se valida, o cuando guarda su
// primera Alma Afín—, nunca al cargar la app.
//
// ── LA SECUENCIA ──────────────────────────────────────────────────────────
//  1. Explicación previa en la UI, con lo que se va a avisar y lo que no.
//  2. Gesto explícito («Sí, avísame») → recién ahí `requestPermission()`.
//  3. «Ahora no» → se aplaza 7 días en `localStorage`. Al tercero, se deja de
//     preguntar (`MAX_APLAZAMIENTOS`).
//
// ── QUÉ SE REGISTRA ───────────────────────────────────────────────────────
// Si se mostró, si se aceptó y cuántas veces se aplazó. Nada más, y nada de eso
// sale del dispositivo: no hay `fetch` de telemetría en este archivo.
//
// ── SIN LLAVES VAPID NO SE PINTA NADA ─────────────────────────────────────
// `/api/push/key` devuelve `{publicKey: null}` con 200 cuando push está
// apagado, y esa es la señal. Sin ella no habría manera de distinguir «apagado»
// de «error», y acabaríamos pidiendo un permiso que no podemos usar — quemando
// el origen a cambio de nada.
// ============================================================================

import { useCallback, useEffect, useState } from 'react'
import {
  CLAVE_OPTIN,
  aceptar,
  aplazar,
  debeMostrarOptIn,
  leerEstado,
  type EstadoOptIn,
  type MomentoOportuno,
} from '@/lib/push/optIn'
import estilos from './pwa.module.css'

export interface OptInPushProps {
  /** El momento que acaba de ocurrir. Sin esto no se pregunta jamás. */
  momento: MomentoOportuno
}

/** Base64url → `Uint8Array`, que es lo que exige `applicationServerKey`. */
function claveABytes(base64url: string): Uint8Array {
  const relleno = '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = (base64url + relleno).replace(/-/g, '+').replace(/_/g, '/')
  const crudo = atob(base64)
  const bytes = new Uint8Array(crudo.length)
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i)
  return bytes
}

function guardar(estado: EstadoOptIn): void {
  try {
    localStorage.setItem(CLAVE_OPTIN, JSON.stringify(estado))
  } catch {
    // Modo privado o almacenamiento lleno: se pierde la memoria del aplazamiento
    // y como mucho se vuelve a preguntar. No es motivo para romper la pantalla.
  }
}

export function OptInPush({ momento }: OptInPushProps) {
  const [clavePublica, setClavePublica] = useState<string | null>(null)
  const [estado, setEstado] = useState<EstadoOptIn | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // El «ahora» con el que se compara el aplazamiento se congela en el montaje.
  // Leer `Date.now()` durante el render haría que el componente diera resultados
  // distintos en dos renders idénticos (regla de pureza de React), y además el
  // aplazamiento es de siete días: el segundo exacto da igual.
  const [montadoEn, setMontadoEn] = useState<number | null>(null)

  useEffect(() => {
    let vivo = true

    void (async () => {
      // El estado local primero: si ya está aceptado o aplazado, ni siquiera se
      // pregunta por la clave.
      const local = leerEstado(
        (() => {
          try {
            return localStorage.getItem(CLAVE_OPTIN)
          } catch {
            return null
          }
        })(),
      )
      if (!vivo) return
      setEstado(local)
      setMontadoEn(Date.now())

      try {
        const respuesta = await fetch('/api/push/key', { credentials: 'same-origin' })
        if (!respuesta.ok) return
        const sobre = (await respuesta.json()) as { ok: boolean; data?: { publicKey: string | null } }
        if (vivo && sobre.ok) setClavePublica(sobre.data?.publicKey ?? null)
      } catch {
        // Sin red: se queda en `null` y no se pinta nada. Correcto.
      }
    })()

    return () => {
      vivo = false
    }
  }, [])

  const soportado =
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window

  const onAceptar = useCallback(async () => {
    if (!estado || !clavePublica || ocupado) return
    setOcupado(true)

    // El estado se marca como aceptado ANTES de preguntar al navegador, y a
    // propósito: si la persona deniega, no se le vuelve a preguntar. Insistir
    // tras un «no» del navegador es lo que hace que la gente bloquee el origen.
    const siguiente = aceptar(estado)
    setEstado(siguiente)
    guardar(siguiente)

    try {
      const permiso = await Notification.requestPermission()
      if (permiso !== 'granted') return

      const registro = await navigator.serviceWorker.ready
      const suscripcion = await registro.pushManager.subscribe({
        // Obligatorio `true`: prometemos mostrar SIEMPRE una notificación.
        // Chrome revoca el permiso del origen tras unos pocos push silenciosos.
        userVisibleOnly: true,
        applicationServerKey: claveABytes(clavePublica) as BufferSource,
      })

      const json = suscripcion.toJSON()
      await fetch('/api/push/subscribe', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        // Solo endpoint y claves. Nunca un `userId`: lo pone el servidor desde
        // la sesión, y el esquema de la ruta rechaza la petición si aparece.
        body: JSON.stringify({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
        }),
      })
    } catch {
      // Cualquier fallo deja las cosas como estaban: sin suscripción y sin
      // volver a preguntar. Un aviso menos, no una pantalla rota.
    } finally {
      setOcupado(false)
    }
  }, [clavePublica, estado, ocupado])

  const onAplazar = useCallback(() => {
    if (!estado) return
    const siguiente = aplazar(estado, Date.now())
    setEstado(siguiente)
    guardar(siguiente)
  }, [estado])

  if (!estado || montadoEn === null || !soportado) return null

  const visible = debeMostrarOptIn({
    configurado: clavePublica !== null,
    permiso: Notification.permission,
    momento,
    estado,
    ahora: montadoEn,
  })

  if (!visible) return null

  return (
    <section className={estilos.tarjeta} aria-labelledby="optin-push-titulo">
      <h2 className={estilos.titulo} id="optin-push-titulo">
        ¿Quieres que te avisemos?
      </h2>
      {/* La explicación dice lo que NO se hace, que es lo que a la gente le
          preocupa de verdad al conceder notificaciones. */}
      <p className={estilos.texto}>
        Te avisaríamos cuando alguien te escuche, cuando tu mensaje ayude a
        alguien y si un Alma Afín necesita hablar. Nunca para que vuelvas, nunca
        con rachas y nunca con lo que alguien escribió: el aviso no enseña el
        texto, porque una pantalla bloqueada la lee cualquiera. De noche todo
        espera hasta la mañana, salvo un Alma Afín en crisis.
      </p>
      <div className={estilos.acciones}>
        <button
          type="button"
          className={`${estilos.boton} ${estilos.primario}`}
          onClick={() => void onAceptar()}
          disabled={ocupado}
        >
          Sí, avísame
        </button>
        <button
          type="button"
          className={`${estilos.boton} ${estilos.secundario}`}
          onClick={onAplazar}
        >
          Ahora no
        </button>
      </div>
    </section>
  )
}
