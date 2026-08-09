'use client'

// ============================================================================
// B10 · La pantalla de la copia de seguridad — la decisión difícil, en la UI
//
// ⚠️ LAS TRES ADVERTENCIAS SE MUESTRAN **ANTES** DE ENSEÑAR LAS PALABRAS, Y SON
// LITERALES. Vienen de `ADVERTENCIAS_RESPALDO` (`lib/crypto/respaldo.ts`) y hay
// una prueba que las vigila, precisamente para que nadie las suavice para
// mejorar la conversión:
//
//   1. Quien tenga esta frase puede leer todo tu historial.
//   2. Darma no puede recuperarla si la pierdes.
//   3. Sin copia de seguridad, cambiar de móvil borra tus conversaciones.
//
// Desde la traducción son CLAVES (`refugios.respaldo.advertencias.*`) y el
// texto vive en el catálogo, en los dos idiomas. La prueba que las vigila
// comprueba las dos versiones: en inglés dicen exactamente lo mismo, sin
// suavizar, porque esta es la pantalla en la que una traducción amable le
// cuesta a alguien su historial.
//
// Las tres son verdad a la vez y hay que decir las tres. Contar solo la 3 vende
// la copia como un seguro sin coste; contar solo la 1 asusta y hace que nadie
// la active y pierda su historial en el primer cambio de móvil. La persona
// decide, pero decide sabiendo.
//
// ── POR QUÉ ESTÁ DESACTIVADA POR DEFECTO ──────────────────────────────────
// Porque el valor por defecto es una decisión que tomamos nosotros por mucha
// gente a la vez. Por defecto, la clave vive solo en el dispositivo y nadie —ni
// Darma, ni quien le robe el móvil a alguien, ni quien reciba una orden
// judicial dirigida a nosotros— puede leer lo que se escribió. El coste de ese
// defecto lo paga quien cambia de móvil; el coste del defecto contrario lo
// pagaría todo el mundo, y no se enteraría.
// ============================================================================

import { useState } from 'react'

import { Boton, Dialogo } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import { crearFraseRecuperacionSincrona } from '@/lib/crypto/frase'
import { ADVERTENCIAS_RESPALDO } from '@/lib/crypto/respaldo'
import { textoDeError } from './api'
import estilos from './refugio.module.css'

export interface DialogoFraseRecuperacionProps {
  abierto: boolean
  alCerrar: () => void
  /** Guarda la copia. Recibe la frase; es quien deriva el KEK y sube el blob.
   *  La frase NO viaja a ninguna red desde aquí. */
  alConfirmar: (frase: readonly string[]) => Promise<void>
}

type Paso = 'advertencias' | 'frase' | 'guardada'

export function DialogoFraseRecuperacion({ abierto, alCerrar, alConfirmar }: DialogoFraseRecuperacionProps) {
  const t = useTraductor()
  const [paso, setPaso] = useState<Paso>('advertencias')
  const [frase, setFrase] = useState<readonly string[] | null>(null)
  const [apuntada, setApuntada] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function generar() {
    // La frase se genera AQUÍ, en el navegador, con `crypto.getRandomValues`.
    // Si la generara el servidor, el servidor la conocería, y entonces podría
    // abrir la copia de cualquiera: la copia dejaría de ser una copia y pasaría
    // a ser una llave maestra.
    setFrase(crearFraseRecuperacionSincrona())
    setPaso('frase')
  }

  async function confirmar() {
    if (!frase) return
    setEnviando(true)
    setError(null)
    try {
      await alConfirmar(frase)
      setPaso('guardada')
    } catch (causa) {
      setError(textoDeError(causa, t, 'refugios.respaldo.errorGuardar'))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      abierto={abierto}
      alCerrar={alCerrar}
      titulo={t('refugios.respaldo.titulo')}
      descripcion={t('refugios.respaldo.descripcion')}
      // No se cierra por accidente: cerrar en mitad de la pantalla que enseña
      // la frase significa perderla, y la persona no lo sabría hasta el día que
      // cambiara de móvil.
      cierreAccidental={paso !== 'frase'}
    >
      {paso === 'advertencias' ? (
        <>
          <ul className={estilos.advertencias}>
            {ADVERTENCIAS_RESPALDO.map((clave) => (
              <li key={clave}>{t(clave)}</li>
            ))}
          </ul>
          <p className={estilos.explicacion}>{t('refugios.respaldo.sinRecuperacion')}</p>
          <div className={estilos.acciones}>
            <Boton onClick={generar}>{t('refugios.respaldo.generar')}</Boton>
            <Boton variante="fantasma" onClick={alCerrar}>
              {t('refugios.respaldo.dejarDesactivado')}
            </Boton>
          </div>
        </>
      ) : null}

      {paso === 'frase' && frase ? (
        <>
          <p className={estilos.explicacion}>
            {t('refugios.respaldo.apuntarAntes')}{' '}
            <strong>{t('refugios.respaldo.apuntarEnfasis')}</strong>
            {t('refugios.respaldo.apuntarDespues')}
          </p>
          <ol className={estilos.frase}>
            {frase.map((palabra, indice) => (
              <li key={`${indice}-${palabra}`} className={estilos.frasePalabra}>
                <span className={estilos.fraseIndice}>{indice + 1}</span>
                <span>{palabra}</span>
              </li>
            ))}
          </ol>

          <label>
            <input type="checkbox" checked={apuntada} onChange={(e) => setApuntada(e.target.checked)} />{' '}
            {t('refugios.respaldo.confirmacion')}
          </label>

          {error ? (
            <p className={estilos.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={estilos.acciones}>
            <Boton disabled={!apuntada} cargando={enviando} onClick={() => void confirmar()}>
              {t('refugios.respaldo.activar')}
            </Boton>
            <Boton variante="fantasma" onClick={alCerrar}>
              {t('comun.cancelar')}
            </Boton>
          </div>
        </>
      ) : null}

      {paso === 'guardada' ? (
        <>
          <p>{t('refugios.respaldo.hecho')}</p>
          <p className={estilos.explicacion}>{t('refugios.respaldo.hechoExplicacion')}</p>
          <div className={estilos.acciones}>
            <Boton onClick={alCerrar}>{t('comun.cerrar')}</Boton>
          </div>
        </>
      ) : null}
    </Dialogo>
  )
}
