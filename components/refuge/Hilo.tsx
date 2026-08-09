'use client'

// ============================================================================
// B10 · El hilo. La pantalla con más superficie de riesgo de Darma.
//
// ── UN SOLO CANAL DE REALTIME, EL DE ESTE HILO ─────────────────────────────
// Ni uno por refugio de la bandeja. Con 40 salas serían 40 suscripciones
// WebSocket por cliente, y con cientos de miles de usuarios eso tumba el
// servicio de Realtime (trampa 4 de la ficha). El canal se abre al montar y se
// CIERRA al desmontar; la bandeja se refresca al volver a ella.
//
// ── DOS BARRERAS PARA EL MISMO PAYLOAD ─────────────────────────────────────
// Realtime respeta RLS, así que un no miembro no recibe nada. Aun así, todo
// payload con un `refuge_id` distinto al del hilo abierto se DESCARTA en el
// cliente. Es la única barrera que se ve desde el navegador, y una barrera que
// no se ve es una barrera en la que nadie repara cuando la rompe.
//
// ── EL HUECO DE LA RECONEXIÓN ──────────────────────────────────────────────
// Un INSERT perdido durante una desconexión NO vuelve solo: Realtime no
// reenvía lo que pasó mientras el socket estaba caído. Al recuperar el canal se
// pide por keyset desde el último `id` conocido. Sin eso, la conversación
// tendría agujeros silenciosos, que en un chat de apoyo significa que alguien
// cree que no le contestaron.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Boton } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import { ENC_VERSION, cifrar, descifrarLote } from '@/lib/crypto'
import type { MensajeCifrado, MensajeDescifrado } from '@/lib/crypto/tipos'
import { createClient } from '@/lib/supabase/client'
import type { RiskLevel } from '@/lib/crisis'
import { AvisoSinClave } from './AvisoClaveCambiada'
import { Burbuja } from './Burbuja'
import { NumeroSeguridad } from './NumeroSeguridad'
import { Redactor } from './Redactor'
import { asegurarIdentidad, obtenerClaveDeRefugio, type Identidad } from './identidad'
import { obtenerMiembros } from './miembros'
import { aceptarPayload, fusionarMensajes, pendientesDeRellenar, ultimoId } from './hilo.dominio'
import {
  enviarMensaje,
  listarMensajes,
  marcarLeido,
  obtenerClaves,
  registrarCrisis,
  textoDeError,
} from './api'
import estilos from './refugio.module.css'

export interface HiloProps {
  refugeId: string
  /** uuid de la sesión. Viene del Server Component que envuelve al hilo, nunca
   *  del cuerpo de una petición. */
  userId: string
  titulo: string | null
  pais?: string | null
}

interface EstadoHilo {
  cargando: boolean
  identidad: Identidad | null
  clave: CryptoKey | null
  mensajes: MensajeDescifrado[]
  siguienteCursor: string | null
  huellaOtro: string | null
  aliasOtro: string | null
}

const INICIAL: EstadoHilo = {
  cargando: true,
  identidad: null,
  clave: null,
  mensajes: [],
  siguienteCursor: null,
  huellaOtro: null,
  aliasOtro: null,
}

export function Hilo({ refugeId, userId, titulo, pais = null }: HiloProps) {
  const t = useTraductor()
  const [estado, setEstado] = useState<EstadoHilo>(INICIAL)
  const [error, setError] = useState<string | null>(null)

  // Refs y no estado: los usa el callback del canal de Realtime, que se crea
  // una sola vez. Con estado, el callback capturaría el valor del primer render
  // y descartaría mensajes por comparar contra un id viejo.
  const claveRef = useRef<CryptoKey | null>(null)
  const ultimoIdRef = useRef<number>(0)

  const supabase = useMemo(() => createClient(), [])

  /** Añade mensajes nuevos sin duplicar y sin perder ninguno. La lógica vive en
   *  `hilo.dominio.ts` porque es lo que exigen probar los casos 9 y 10 de la
   *  ficha, y dentro de un componente solo se podría probar montando un DOM y un
   *  WebSocket falsos: probar el doble en vez del código. */
  const incorporar = useCallback((nuevos: MensajeDescifrado[]) => {
    setEstado((previo) => {
      const mensajes = fusionarMensajes(previo.mensajes, nuevos)
      if (mensajes.length === previo.mensajes.length && nuevos.length === 0) return previo
      ultimoIdRef.current = Math.max(ultimoIdRef.current, ultimoId(mensajes))
      return { ...previo, mensajes }
    })
  }, [])

  /** Pide por keyset todo lo que haya por encima del último id conocido. */
  const rellenarDesdeUltimo = useCallback(async () => {
    const clave = claveRef.current
    const pagina = await listarMensajes(refugeId, { limite: 50 })
    const pendientes = pendientesDeRellenar(pagina.items, ultimoIdRef.current)
    if (pendientes.length === 0) return
    incorporar(await descifrarLote(clave, pendientes))
  }, [refugeId, incorporar])

  // ── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true

    async function cargar() {
      try {
        const identidad = await asegurarIdentidad(userId)
        const { clave } = await obtenerClaveDeRefugio(userId, refugeId, identidad)
        claveRef.current = clave

        const pagina = await listarMensajes(refugeId, { limite: 50 })
        const claros = await descifrarLote(clave, pagina.items)

        // La huella de la otra persona, para el número de seguridad. Solo tiene
        // sentido en un 'duo': en un círculo hay varias y la pantalla enseña la
        // lista, no un número.
        const miembros = (await obtenerMiembros(refugeId)).filter((m) => m !== userId)
        const claves = miembros.length === 1 ? await obtenerClaves(miembros).catch(() => []) : []

        if (!vivo) return
        ultimoIdRef.current = ultimoId(claros)
        setEstado({
          cargando: false,
          identidad,
          clave,
          mensajes: claros,
          siguienteCursor: pagina.siguienteCursor,
          huellaOtro: claves[0]?.fingerprint ?? null,
          aliasOtro: null,
        })

        if (ultimoIdRef.current > 0) {
          await marcarLeido(refugeId, ultimoIdRef.current).catch(() => undefined)
        }
      } catch (causa) {
        if (!vivo) return
        setError(textoDeError(causa, t, 'refugios.hilo.error'))
        setEstado((p) => ({ ...p, cargando: false }))
      }
    }

    void cargar()
    return () => {
      vivo = false
    }
  }, [refugeId, userId, t])

  // ── Realtime: UN canal, cerrado al desmontar ──────────────────────────────
  useEffect(() => {
    const canal = supabase
      .channel(`refuge:${refugeId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'refuge_messages', filter: `refuge_id=eq.${refugeId}` },
        (payload: { new: Record<string, unknown> }) => {
          const fila = payload.new
          // Segunda barrera, en el cliente: un payload de OTRA sala se tira sin
          // mirarlo. El filtro del servidor ya lo evita y RLS también; esto es
          // lo que queda si alguna de las dos se rompiera.
          if (!aceptarPayload(refugeId, fila)) return

          void (async () => {
            const cifrado: MensajeCifrado = {
              id: Number(fila.id),
              refugeId: String(fila.refuge_id),
              senderId: String(fila.sender_id),
              // Realtime entrega `bytea` en el formato `\x…` de Postgres.
              ciphertextB64: hexABase64(String(fila.ciphertext)),
              nonceB64: hexABase64(String(fila.nonce)),
              encVersion: Number(fila.enc_version),
              kind: fila.kind as MensajeCifrado['kind'],
              createdAt: String(fila.created_at),
            }
            incorporar(await descifrarLote(claveRef.current, [cifrado]))
          })()
        },
      )
      .subscribe((estadoCanal: string) => {
        // Al recuperar la suscripción se rellena el hueco: lo que entró mientras
        // el socket estaba caído no llega solo.
        if (estadoCanal === 'SUBSCRIBED') void rellenarDesdeUltimo().catch(() => undefined)
      })

    return () => {
      void supabase.removeChannel(canal)
    }
  }, [supabase, refugeId, incorporar, rellenarDesdeUltimo])

  // ── Enviar ────────────────────────────────────────────────────────────────
  const enviar = useCallback(
    async (texto: string, riesgo: RiskLevel) => {
      const clave = claveRef.current
      if (!clave) throw new Error(t('refugios.hilo.sinLlave'))

      const { ciphertextB64, nonceB64 } = await cifrar(clave, texto)
      const { mensaje } = await enviarMensaje(refugeId, {
        ciphertextB64,
        nonceB64,
        encVersion: ENC_VERSION,
        kind: 'text',
        byteSize: new TextEncoder().encode(texto).length,
      })

      incorporar(await descifrarLote(clave, [mensaje]))
      ultimoIdRef.current = Math.max(ultimoIdRef.current, mensaje.id)

      // El registro de crisis va DESPUÉS del envío y sin bloquearlo: el mensaje
      // ya está entregado y los recursos ya están en pantalla. Y viaja SOLO el
      // nivel — nunca el texto, que aquí todavía existe en claro y es justo por
      // eso por lo que este es el sitio donde alguien tendría la tentación.
      if (riesgo === 'high' || riesgo === 'critical') {
        await registrarCrisis({ refugeId, risk: riesgo, recursos: ['tarjeta_refugio'], countryCode: pais }).catch(
          () => undefined,
        )
      }
    },
    [refugeId, incorporar, pais, t],
  )

  const cargarMas = useCallback(async () => {
    if (!estado.siguienteCursor) return
    const pagina = await listarMensajes(refugeId, { cursor: estado.siguienteCursor, limite: 50 })
    const claros = await descifrarLote(claveRef.current, pagina.items)
    setEstado((p) => ({ ...p, siguienteCursor: pagina.siguienteCursor }))
    incorporar(claros)
  }, [estado.siguienteCursor, refugeId, incorporar])

  if (estado.cargando) {
    return (
      <div className={estilos.pagina}>
        <p>{t('refugios.hilo.abriendo')}</p>
      </div>
    )
  }

  return (
    <div className={estilos.hilo}>
      <header className={estilos.hiloCabecera}>
        <h1 className={estilos.filaTitulo}>{titulo ?? t('refugios.hilo.tituloPorDefecto')}</h1>
      </header>

      <div className={estilos.hiloMensajes}>
        {error ? (
          <p className={estilos.error} role="alert">
            {error}
          </p>
        ) : null}

        {!estado.clave ? (
          <AvisoSinClave dispositivoNuevo={estado.identidad?.estado === 'nuevo'} />
        ) : null}

        {estado.mensajes.map((m) => (
          <Burbuja key={m.id} mensaje={m} mio={m.senderId === userId} />
        ))}

        {estado.siguienteCursor ? (
          <Boton variante="fantasma" onClick={() => void cargarMas()}>
            {t('refugios.hilo.verAnteriores')}
          </Boton>
        ) : null}

        {estado.huellaOtro ? <NumeroSeguridad fingerprint={estado.huellaOtro} /> : null}
      </div>

      <Redactor alEnviar={enviar} puedeEscribir={estado.clave !== null} pais={pais} />
    </div>
  )
}

/** `\x48…` → base64. Duplica a propósito lo mínimo de `lib/crypto/base64.ts`
 *  para que el payload de Realtime no obligue a importar el módulo entero en
 *  este componente de cliente. */
function hexABase64(hex: string): string {
  const limpio = hex.startsWith('\\x') ? hex.slice(2) : hex
  const bytes = new Uint8Array(limpio.length / 2)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(limpio.slice(i * 2, i * 2 + 2), 16)
  let binario = ''
  for (const b of bytes) binario += String.fromCharCode(b)
  return btoa(binario)
}
