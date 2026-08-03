// ============================================================================
// components/polls — la superficie que consume B02 desde el feed.
//
// Un barril, y por la misma razón que el de `components/ui`: el punto de
// integración con B02 es un contrato entre dos bloques, y si mañana la tarjeta
// se parte en dos archivos o cambia de carpeta, aquí no se nota. Si B02
// importara `@/components/polls/TarjetaEncuesta.tsx` directamente, sí.
//
// ⚠️ `TarjetaEncuesta` es el ÚNICO componente con `'use client'`. `BarraResultado`
// y `EstadoOculto` son Server Components y no envían un byte de JS; se exportan
// para que quien pinte resultados fuera del feed (una página de encuesta, el
// panel de B19) no tenga que llevarse el cliente entero.
// ============================================================================

export { TarjetaEncuesta } from './TarjetaEncuesta.tsx'
export type { TarjetaEncuestaProps } from './TarjetaEncuesta.tsx'

export { BarraResultado } from './BarraResultado.tsx'
export type { BarraResultadoProps } from './BarraResultado.tsx'

export { EstadoOculto } from './EstadoOculto.tsx'
export type { EstadoOcultoProps } from './EstadoOculto.tsx'
