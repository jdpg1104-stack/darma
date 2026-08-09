'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { guardarClaveRefugio } from '@/lib/crypto/almacen'
import { Boton } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'

import { crearRefugio, textoDeError } from './api'
import { asegurarIdentidad, prepararSobresDeSalaNueva } from './identidad'
import estilos from './refugio.module.css'

export interface BotonHablarEnPrivadoProps {
  /** Quién soy. Hace falta para la identidad criptográfica de este dispositivo. */
  miId: string
  /** A quién invito. */
  otroId: string
  otroAlias: string
}

/**
 * «Hablar en privado» — el puente que faltaba entre el perfil y los refugios.
 *
 * Sin este botón, los refugios existían pero no había forma de abrir uno: la
 * pieza cayó entre el bloque del perfil y el de los refugios, cada uno esperando
 * que la pusiera el otro.
 *
 * Lo que pasa al pulsarlo, en este orden y todo en el navegador:
 *
 *  1. Se asegura de que este dispositivo tiene identidad criptográfica; si es la
 *     primera vez, la genera y publica solo la parte pública.
 *  2. Genera la clave del refugio y la envuelve para la otra persona con el
 *     secreto ECDH compartido. **La clave nunca sale en claro**: lo único que
 *     viaja es el sobre.
 *  3. Crea la sala y guarda la clave en este dispositivo.
 *
 * El caso que hay que tratar con cuidado —y que no es un error— es que la otra
 * persona **todavía no tenga clave publicada**, porque no ha abierto los
 * refugios desde ningún dispositivo. No se puede cifrar para alguien cuya clave
 * no existe, y fabricar una en su nombre sería exactamente lo que el número de
 * seguridad existe para detectar. Así que no se crea la sala y se explica por
 * qué, en vez de abrir un refugio que la otra persona nunca podrá leer.
 */
export function BotonHablarEnPrivado({ miId, otroId, otroAlias }: BotonHablarEnPrivadoProps) {
  const t = useTraductor()
  const router = useRouter()
  const [estado, setEstado] = useState<'listo' | 'creando'>('listo')
  const [error, setError] = useState<string | null>(null)

  async function abrir() {
    setEstado('creando')
    setError(null)
    try {
      const identidad = await asegurarIdentidad(miId)
      const { clave, sobres } = await prepararSobresDeSalaNueva(identidad, [otroId])

      if (sobres.length === 0) {
        setError(t('refugios.privado.sinClave', { alias: otroAlias }))
        setEstado('listo')
        return
      }

      const { refugeId } = await crearRefugio({
        kind: 'duo',
        miembros: [otroId],
        sobres,
      })

      // La clave se guarda DESPUÉS de que la sala exista: si el guardado fuera
      // primero y la creación fallara, este dispositivo se quedaría con la clave
      // de un refugio fantasma.
      await guardarClaveRefugio(miId, refugeId, clave)
      router.push(`/refugios/${refugeId}`)
    } catch (e) {
      setError(textoDeError(e, t, 'refugios.privado.error'))
      setEstado('listo')
    }
  }

  return (
    <div className={estilos.accionPerfil}>
      <Boton onClick={abrir} disabled={estado === 'creando'} data-testid="refugio-boton-hablar">
        {t(estado === 'creando' ? 'refugios.privado.abriendo' : 'refugios.privado.abrir')}
      </Boton>
      {error ? (
        <p className={estilos.avisoAccion} role="status">
          {error}
        </p>
      ) : null}
    </div>
  )
}
