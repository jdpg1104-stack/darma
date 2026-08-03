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
import { crearFraseRecuperacionSincrona } from '@/lib/crypto/frase'
import { ADVERTENCIAS_RESPALDO } from '@/lib/crypto/respaldo'
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
      setError(causa instanceof Error ? causa.message : 'No hemos podido guardar la copia.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo
      abierto={abierto}
      alCerrar={alCerrar}
      titulo="Copia de seguridad de tus conversaciones"
      descripcion="Está desactivada. Antes de activarla, lee esto."
      // No se cierra por accidente: cerrar en mitad de la pantalla que enseña
      // la frase significa perderla, y la persona no lo sabría hasta el día que
      // cambiara de móvil.
      cierreAccidental={paso !== 'frase'}
    >
      {paso === 'advertencias' ? (
        <>
          <ul className={estilos.advertencias}>
            {ADVERTENCIAS_RESPALDO.map((advertencia) => (
              <li key={advertencia}>{advertencia}</li>
            ))}
          </ul>
          <p className={estilos.explicacion}>
            No hay recuperación por correo, ni por soporte, ni comprobando quién eres.
            Cualquiera de esas cosas obligaría a que Darma tuviera tu clave, y entonces
            podríamos leer lo que escribes. No la tenemos y no queremos tenerla.
          </p>
          <div className={estilos.acciones}>
            <Boton onClick={generar}>Entendido, generar mi frase</Boton>
            <Boton variante="fantasma" onClick={alCerrar}>
              Dejarlo desactivado
            </Boton>
          </div>
        </>
      ) : null}

      {paso === 'frase' && frase ? (
        <>
          <p className={estilos.explicacion}>
            Apúntalas <strong>en papel</strong>, en orden, y guárdalas donde guardarías algo
            importante. En las notas del móvil no: si pierdes el móvil, pierdes las dos cosas
            a la vez.
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
            Las he apuntado y sé que Darma no puede recuperarlas.
          </label>

          {error ? (
            <p className={estilos.error} role="alert">
              {error}
            </p>
          ) : null}

          <div className={estilos.acciones}>
            <Boton disabled={!apuntada} cargando={enviando} onClick={() => void confirmar()}>
              Activar la copia
            </Boton>
            <Boton variante="fantasma" onClick={alCerrar}>
              Cancelar
            </Boton>
          </div>
        </>
      ) : null}

      {paso === 'guardada' ? (
        <>
          <p>Listo. La copia está guardada y solo tu frase la abre.</p>
          <p className={estilos.explicacion}>
            Si algún día cambias de móvil, escribe esas doce palabras y tus conversaciones
            volverán. Si las pierdes, no.
          </p>
          <div className={estilos.acciones}>
            <Boton onClick={alCerrar}>Cerrar</Boton>
          </div>
        </>
      ) : null}
    </Dialogo>
  )
}
