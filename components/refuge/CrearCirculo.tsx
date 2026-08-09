'use client'

// ============================================================================
// B10 · «Crear un círculo» — la mitad grupal de los refugios, por fin alcanzable.
//
// Hasta este componente, el ÚNICO punto de creación era `BotonHablarEnPrivado`
// con `kind: 'duo'` fijo: la API aceptaba círculos, la bandeja los pintaba y el
// cifrado multi-sobre existía, pero ninguna pantalla permitía crearlos.
//
// El camino criptográfico es EL MISMO del dúo, generalizado a N personas:
//
//  1. `asegurarIdentidad()` — identidad de este dispositivo, creada si falta.
//  2. `prepararSobresDeSalaNueva(identidad, invitadas)` — genera la clave de la
//     sala EN ESTE NAVEGADOR y envuelve un sobre por invitada con el secreto
//     ECDH de cada par. La clave nunca sale en claro.
//  3. `crearRefugio({ kind: 'circulo', … })` — sala, pertenencias y sobres.
//  4. La clave se guarda en IndexedDB DESPUÉS de que la sala exista, igual que
//     en el dúo: guardarla antes dejaría la llave de un refugio fantasma.
//
// ── LOS DOS «NO» HONESTOS DE ESTA PANTALLA ─────────────────────────────────
//  · Alguien sin clave publicada: no se puede cifrar para esa persona y NO se
//    crea el círculo a medias — se dice QUIÉN falta y se ofrece quitarla. Un
//    círculo parcial sería esa persona dentro de la sala sin poder leer nada.
//  · El servidor responde `no_encontrado` a la creación: se negó sin decir por
//    qué (casi siempre un bloqueo entre dos de las personas elegidas, que a
//    propósito no se detalla — decir quién bloqueó a quién revelaría un bloqueo
//    a la parte bloqueada). Se dice que con ESA selección no se puede, y basta.
// ============================================================================

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { guardarClaveRefugio } from '@/lib/crypto/almacen'
import { Avatar, Boton, Dialogo } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import type { AlmaAfin } from '@/lib/crypto/tipos'

import { ErrorDeRed, crearRefugio, textoDeError } from './api'
import { asegurarIdentidad, prepararSobresDeSalaNueva } from './identidad'
import {
  MAX_INVITADOS_CIRCULO,
  MAX_MIEMBROS_CIRCULO,
  TITULO_MAX,
  aliasesDe,
  alternarInvitado,
  invitadosSinSobre,
  normalizarTitulo,
  validarSeleccion,
} from './circulo.dominio'
import estilos from './refugio.module.css'

export interface CrearCirculoProps {
  /** Quién soy. Hace falta para la identidad criptográfica de este dispositivo. */
  miId: string
  /** Entre quiénes se puede elegir: las almas afines guardadas. */
  almas: readonly AlmaAfin[]
}

export function CrearCirculo({ miId, almas }: CrearCirculoProps) {
  const t = useTraductor()
  const router = useRouter()
  const [abierto, setAbierto] = useState(false)
  const [seleccion, setSeleccion] = useState<ReadonlySet<string>>(new Set())
  const [titulo, setTitulo] = useState('')
  const [estado, setEstado] = useState<'listo' | 'creando'>('listo')
  const [error, setError] = useState<string | null>(null)

  // Sin almas afines no hay entre quién elegir: el estado vacío de la lista ya
  // explica cómo se guarda a alguien, y un botón hacia un diálogo vacío solo
  // añadiría un callejón sin salida.
  if (almas.length === 0) return null

  function cerrar() {
    if (estado === 'creando') return
    setAbierto(false)
    setError(null)
  }

  function alternar(id: string) {
    setSeleccion((previa) => alternarInvitado(previa, id))
    setError(null)
  }

  function mensajeDeError(causa: unknown): string {
    if (causa instanceof ErrorDeRed && causa.code === 'no_encontrado') {
      // El mensaje por defecto del código («No hemos encontrado lo que
      // buscas») es verdad para un GET y absurdo para una creación.
      return t('refugios.circulo.rechazado')
    }
    return textoDeError(causa, t, 'refugios.circulo.error')
  }

  async function crear() {
    const validacion = validarSeleccion(seleccion)
    if (!validacion.ok) {
      setError(
        validacion.motivo === 'sin_nadie'
          ? t('refugios.circulo.sinNadie')
          : t('refugios.circulo.limite', { max: MAX_MIEMBROS_CIRCULO }),
      )
      return
    }

    setEstado('creando')
    setError(null)
    try {
      const invitados = [...seleccion]
      const identidad = await asegurarIdentidad(miId)
      const { clave, sobres } = await prepararSobresDeSalaNueva(identidad, invitados)

      // O todas pueden leer, o no se crea. Ver la cabecera.
      const sinSobre = invitadosSinSobre(invitados, sobres)
      if (sinSobre.length > 0) {
        setError(
          t('refugios.circulo.sinClave', {
            n: sinSobre.length,
            aliases: aliasesDe(sinSobre, almas).join(', '),
          }),
        )
        setEstado('listo')
        return
      }

      const { refugeId } = await crearRefugio({
        kind: 'circulo',
        title: normalizarTitulo(titulo),
        miembros: invitados,
        sobres,
      })

      // La clave se guarda DESPUÉS de que la sala exista: si el guardado fuera
      // primero y la creación fallara, este dispositivo se quedaría con la
      // clave de un refugio fantasma.
      await guardarClaveRefugio(miId, refugeId, clave)
      router.push(`/refugios/${refugeId}`)
    } catch (causa) {
      setError(mensajeDeError(causa))
      setEstado('listo')
    }
  }

  return (
    <div className={estilos.acciones}>
      <Boton variante="secundario" onClick={() => setAbierto(true)}>
        {t('refugios.circulo.abrir')}
      </Boton>

      <Dialogo
        abierto={abierto}
        alCerrar={cerrar}
        titulo={t('refugios.circulo.titulo')}
        descripcion={t('refugios.circulo.descripcion', { max: MAX_MIEMBROS_CIRCULO })}
      >
        <fieldset className={estilos.grupoCirculo} disabled={estado === 'creando'}>
          <legend className={estilos.explicacion}>{t('refugios.circulo.elegir')}</legend>
          <ul className={estilos.lista}>
            {almas.map((alma) => {
              const marcada = seleccion.has(alma.id)
              return (
                <li key={alma.id} className={estilos.almaFila}>
                  <label className={estilos.opcionCirculo}>
                    <input
                      type="checkbox"
                      checked={marcada}
                      // Con el cupo lleno, lo no marcado se apaga en vez de
                      // ignorar el click en silencio (el dominio tampoco lo
                      // aceptaría; esto solo lo hace visible).
                      disabled={!marcada && seleccion.size >= MAX_INVITADOS_CIRCULO}
                      onChange={() => alternar(alma.id)}
                    />
                    <Avatar semilla={alma.avatarSeed} alias={alma.alias} nivel={alma.nivel} tamano={32} />
                    <span>{alma.alias}</span>
                  </label>
                </li>
              )
            })}
          </ul>
        </fieldset>

        {/* El contador anuncia sus cambios: quien navega con lector de pantalla
            marca casillas sin ver el número moverse. */}
        <p className={estilos.explicacion} aria-live="polite">
          {t('refugios.circulo.cuenta', { n: seleccion.size, max: MAX_INVITADOS_CIRCULO })}
        </p>

        <label className={estilos.campoCirculo}>
          <span>{t('refugios.circulo.nombreEtiqueta')}</span>
          <input
            type="text"
            className={estilos.campo}
            maxLength={TITULO_MAX}
            value={titulo}
            onChange={(evento) => setTitulo(evento.target.value)}
            disabled={estado === 'creando'}
          />
        </label>
        {/* El título es el ÚNICO texto en claro de todo el bloque: hay que
            decirlo donde se escribe, no en una nota legal que nadie abre. */}
        <p className={estilos.explicacion}>{t('refugios.circulo.nombreAviso')}</p>

        {error ? (
          <p className={estilos.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={estilos.acciones}>
          <Boton
            onClick={() => void crear()}
            disabled={seleccion.size === 0}
            cargando={estado === 'creando'}
          >
            {t(estado === 'creando' ? 'refugios.circulo.creando' : 'refugios.circulo.crear')}
          </Boton>
          <Boton variante="fantasma" onClick={cerrar} disabled={estado === 'creando'}>
            {t('comun.cancelar')}
          </Boton>
        </div>
      </Dialogo>
    </div>
  )
}
