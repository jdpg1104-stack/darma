'use client'

// ============================================================================
// B10 · Bloquear o silenciar
//
// Las dos opciones NO son lo mismo y la pantalla tiene que decirlo, porque
// elegir mal aquí tiene consecuencias reales:
//
// · BLOQUEAR corta la relación en los dos sentidos. Los refugios que
//   compartíais dejan de existir para ambos —`refuge_has_block()` entra en el
//   USING de las políticas—, y eso incluye el historial.
// · SILENCIAR solo te oculta a ti. La otra persona no nota nada, y eso es
//   justamente lo que hace seguro silenciar a alguien agresivo: no le das
//   ninguna señal a la que reaccionar.
//
// Lo que esta pantalla NO hace es «ocultar en la interfaz». El bloqueo se
// escribe en `blocks` y lo aplica el motor; si viviera aquí, un `curl` a
// PostgREST con la anon key lo saltaría, que es exactamente lo que hace quien
// de verdad quiere alcanzar a alguien.
// ============================================================================

import { useState } from 'react'

import { Boton, Dialogo } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import { bloquear, textoDeError } from './api'
import estilos from './refugio.module.css'

export interface MenuBloquearProps {
  userId: string
  alias: string
}

export function MenuBloquear({ userId, alias }: MenuBloquearProps) {
  const t = useTraductor()
  const [abierto, setAbierto] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hecho, setHecho] = useState<'block' | 'mute' | null>(null)

  async function aplicar(modo: 'block' | 'mute') {
    setEnviando(true)
    setError(null)
    try {
      await bloquear(userId, modo)
      setHecho(modo)
      setAbierto(false)
    } catch (causa) {
      setError(textoDeError(causa, t, 'refugios.bloquear.error'))
    } finally {
      setEnviando(false)
    }
  }

  if (hecho) {
    return (
      <span className={estilos.filaMeta}>
        {t(hecho === 'block' ? 'refugios.bloquear.bloqueada' : 'refugios.bloquear.silenciada')}
      </span>
    )
  }

  return (
    <>
      <Boton variante="fantasma" tamano="sm" onClick={() => setAbierto(true)}>
        {t('refugios.bloquear.accion')}
      </Boton>

      <Dialogo
        abierto={abierto}
        alCerrar={() => setAbierto(false)}
        titulo={t('refugios.bloquear.titulo', { alias })}
        descripcion={t('refugios.bloquear.descripcion')}
      >
        <ul className={estilos.advertencias}>
          <li>
            <strong>{t('refugios.bloquear.bloquearNombre')}</strong>{' '}
            {t('refugios.bloquear.bloquearExplicacion')}
          </li>
          <li>
            <strong>{t('refugios.bloquear.silenciarNombre')}</strong>{' '}
            {t('refugios.bloquear.silenciarExplicacion')}
          </li>
        </ul>

        {error ? (
          <p className={estilos.error} role="alert">
            {error}
          </p>
        ) : null}

        <div className={estilos.acciones}>
          <Boton variante="peligro" cargando={enviando} onClick={() => void aplicar('block')}>
            {t('refugios.bloquear.accion')}
          </Boton>
          <Boton variante="secundario" cargando={enviando} onClick={() => void aplicar('mute')}>
            {t('refugios.bloquear.silenciar')}
          </Boton>
          <Boton variante="fantasma" onClick={() => setAbierto(false)}>
            {t('refugios.bloquear.ahoraNo')}
          </Boton>
        </div>
      </Dialogo>
    </>
  )
}
