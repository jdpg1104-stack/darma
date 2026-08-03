// ============================================================================
// components/polls — la superficie que consume B02 desde el feed.
//
// Un barril, y por la misma razón que el de `components/ui`: el punto de
// integración con B02 es un contrato entre dos bloques, y si mañana la tarjeta
// se parte en dos archivos o cambia de carpeta, aquí no se nota. Si B02
// importara `@/components/polls/TarjetaEncuesta.tsx` directamente, sí.
//
// ⚠️ Los tres llevan `'use client'` desde que el copy se movió al catálogo:
// `BarraResultado` y `EstadoOculto` leen su texto con `useTraductor()`.
//
// En bytes no cambia nada respecto a antes: el único sitio que los pinta es
// `TarjetaEncuesta`, que ya era cliente, y un módulo importado desde cliente
// entra en el bundle lleve o no la directiva. Lo que cambia es que ahora la
// frontera está escrita, así que quien los use desde un Server Component
// —una página de encuesta, el panel de B19— obtiene una frontera de cliente
// bien formada en vez de un error de hooks en tiempo de ejecución.
// ============================================================================

export { TarjetaEncuesta } from './TarjetaEncuesta.tsx'
export type { TarjetaEncuestaProps } from './TarjetaEncuesta.tsx'

export { BarraResultado } from './BarraResultado.tsx'
export type { BarraResultadoProps } from './BarraResultado.tsx'

export { EstadoOculto } from './EstadoOculto.tsx'
export type { EstadoOcultoProps } from './EstadoOculto.tsx'
