// ============================================================================
// components/ui — el barril. La ÚNICA vía de import para el resto de bloques.
//
//     import { Boton, Tarjeta, BotonCrisis } from '@/components/ui'
//
// Nunca desde el archivo suelto: doce bloques (B01–B12, B19, B20) consumen esta
// superficie y este archivo es el contrato entre todos ellos. Si un componente
// se parte en dos, se renombra o cambia de carpeta, aquí no se nota; si alguien
// importa `@/components/ui/Boton.tsx` directamente, sí.
//
// ── REGLAS DEL CONTRATO (ningún bloque puede saltárselas) ────────────────────
//  · Ninguna prop se llama `className` salvo en `Boton` y `Tarjeta`, y ahí se
//    FUSIONA con `twMerge`, no se sustituye.
//  · Ningún componente acepta `style`. Si necesitas otro color, falta una
//    variante: pídela en HANDOFF/PEDIDOS.md en vez de inyectarla.
//  · Ningún componente acepta `dangerouslySetInnerHTML`. El cuerpo de un post
//    lo escribe una persona anónima; renderizarlo como HTML es XSS servido.
//  · Ningún componente acepta `email`, `phone`, `ip`, `country`, `contactHash`
//    ni una URL de foto: CONTRATOS.md §2. El tipo de props ES la barrera —lo
//    que no se puede pasar no se puede filtrar—, y hay una prueba que falla si
//    alguien añade una de esas claves.
//
// ── COSTE EN CLIENTE ────────────────────────────────────────────────────────
// Ocho de los diez componentes son Server Components y envían 0 bytes de JS.
// Solo `Dialogo` (necesita `showModal()` y devolver el foco) y `BotonCrisis`
// (necesita saber si está en un layout) llevan `'use client'`. Eso es lo que
// deja margen dentro de los 120 KB por ruta de CONTRATOS.md §11 para lo que sí
// necesita interactividad de verdad.
// ============================================================================

export { Boton } from './Boton.tsx'
export type { BotonProps, VarianteBoton, TamanoBoton } from './Boton.tsx'

export { Tarjeta } from './Tarjeta.tsx'
export type { TarjetaProps } from './Tarjeta.tsx'

export { Chip } from './Chip.tsx'
export type { ChipProps } from './Chip.tsx'

export { Avatar } from './Avatar.tsx'
export type { AvatarProps, TamanoAvatar } from './Avatar.tsx'

export { Insignia } from './Insignia.tsx'
export type { InsigniaProps } from './Insignia.tsx'

export { EstadoVacio } from './EstadoVacio.tsx'
export type { EstadoVacioProps } from './EstadoVacio.tsx'

export { Dialogo } from './Dialogo.tsx'
export type { DialogoProps } from './Dialogo.tsx'

export { Cargando } from './Cargando.tsx'
export type { CargandoProps } from './Cargando.tsx'

export { MedidorKarma } from './MedidorKarma.tsx'
export type { MedidorKarmaProps } from './MedidorKarma.tsx'

export { BotonCrisis } from './BotonCrisis.tsx'
export type { BotonCrisisProps } from './BotonCrisis.tsx'

// ── Utilidades ──────────────────────────────────────────────────────────────
export { ratioContraste, cumpleAA } from './contraste.ts'
export { ACCENT_FILL, COLOR_POR_NIVEL, TAMANOS_AVATAR } from './tokens.ts'

/**
 * `'semilla' | 'brote' | 'guia' | 'mentor'`. Alias de `KarmaLevel` de
 * `lib/karma.ts`, con el nombre que usa CONTRATOS.md §2. Se exporta porque los
 * bloques que consumen `Avatar`, `Insignia` o `MedidorKarma` necesitan tipar la
 * prop `nivel` y no deberían tener que saber de dónde sale.
 */
export type { Nivel } from './tokens.ts'
