// ============================================================================
// components/refuge — el barril del bloque B10.
//
// `identidad.ts`, `api.ts` y `miembros.ts` NO se exportan aquí a propósito: son
// el cableado interno del bloque (criptografía y red) y no superficie para
// otros bloques. Lo que sí puede consumir alguien de fuera es lo que se pinta.
// ============================================================================

export { ListaRefugios } from './ListaRefugios'
export type { ListaRefugiosProps } from './ListaRefugios'

export { Hilo } from './Hilo'
export type { HiloProps } from './Hilo'

export { Burbuja } from './Burbuja'
export type { BurbujaProps } from './Burbuja'

export { Redactor } from './Redactor'
export type { RedactorProps } from './Redactor'

export { NumeroSeguridad } from './NumeroSeguridad'
export type { NumeroSeguridadProps } from './NumeroSeguridad'

export { AvisoClaveCambiada, AvisoSinClave } from './AvisoClaveCambiada'
export type { AvisoClaveCambiadaProps, AvisoSinClaveProps } from './AvisoClaveCambiada'

export { ListaAlmasAfines } from './ListaAlmasAfines'
export type { ListaAlmasAfinesProps } from './ListaAlmasAfines'

export { MenuBloquear } from './MenuBloquear'
export type { MenuBloquearProps } from './MenuBloquear'

export { DialogoFraseRecuperacion } from './DialogoFraseRecuperacion'
export type { DialogoFraseRecuperacionProps } from './DialogoFraseRecuperacion'

export { TarjetaCrisis } from './TarjetaCrisis'
export type { TarjetaCrisisProps } from './TarjetaCrisis'

export { BotonHablarEnPrivado } from './BotonHablarEnPrivado'
export type { BotonHablarEnPrivadoProps } from './BotonHablarEnPrivado'
