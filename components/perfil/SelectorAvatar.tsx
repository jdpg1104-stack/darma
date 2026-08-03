'use client'

// ============================================================================
// SelectorAvatar — regenera la semilla EN EL CLIENTE, sin ir al servidor.
//
// ── POR QUÉ NO SE PIDE LA SEMILLA AL SERVIDOR ──────────────────────────────
// Probar avatares es una acción que la gente repite veinte veces seguidas hasta
// que uno le gusta. Un viaje al servidor por cada pulsación son veinte
// peticiones y veinte esperas para elegir un dibujo. La semilla es solo un
// número aleatorio: no autoriza nada, no identifica nada y no vale nada hasta
// que el formulario se envía y el servidor la valida contra
// `^[0-9a-f]{8,32}$`.
//
// ── POR QUÉ NO SE IMPORTA `lib/anonymity.ts` ───────────────────────────────
// Ese módulo hace `import { randomBytes } from 'node:crypto'` en la primera
// línea, así que arrastrarlo a un componente de cliente rompe el bundle del
// navegador. Aquí se usa `crypto.getRandomValues`, que es la primitiva
// equivalente de la Web Crypto API, y se producen 8 bytes = 16 hex: exactamente
// el formato del default de la columna (`encode(gen_random_bytes(8),'hex')`) y
// el que devuelve `deriveAvatarSeed`.
//
// Lo que NO cambia respecto a lib/anonymity.ts es lo importante: la semilla es
// ALEATORIA y no se deriva del user id ni del email. Si se derivara, cualquiera
// con una lista de user ids podría recalcular el avatar de cada persona y
// quedarse con la tabla completa avatar → cuenta.
// ============================================================================

import { useState } from 'react'

import { useTraductor } from '@/i18n/Proveedor'
import { Avatar, Boton } from '../ui/index.ts'
import type { KarmaLevel } from '../../lib/karma.ts'
import estilos from './perfil.module.css'

export interface SelectorAvatarProps {
  /** `profiles.avatar_seed` actual. */
  semillaInicial: string
  alias: string
  nivel: KarmaLevel
  /** Nombre del campo oculto que viaja en el `FormData`. */
  nombreCampo?: string
}

/** 8 bytes aleatorios en hexadecimal. Mismo formato que el default de la
 *  columna y que `deriveAvatarSeed()`. */
function nuevaSemilla(): string {
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function SelectorAvatar({
  semillaInicial,
  alias,
  nivel,
  nombreCampo = 'avatarSeed',
}: SelectorAvatarProps) {
  const t = useTraductor()
  const [semilla, setSemilla] = useState(semillaInicial)

  return (
    <div className={estilos.campo}>
      <span className={estilos.etiqueta} id="etiqueta-avatar">
        {t('perfil.edicion.etiquetaAvatar')}
      </span>

      <div className={estilos.selectorAvatar}>
        <Avatar semilla={semilla} tamano={80} alias={alias} nivel={nivel} />

        <Boton variante="secundario" onClick={() => setSemilla(nuevaSemilla())}>
          {t('perfil.edicion.botonAvatar')}
        </Boton>
      </div>

      {/* El valor viaja en el envío del formulario. Si el JS no ha hidratado,
          el campo conserva la semilla actual y el avatar no cambia — que es
          exactamente lo correcto: no se pierde nada. */}
      <input type="hidden" name={nombreCampo} value={semilla} readOnly />

      <p className={estilos.pista}>{t('perfil.edicion.pistaAvatar')}</p>
    </div>
  )
}
