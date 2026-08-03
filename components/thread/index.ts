// ============================================================================
// components/thread — barril del hilo (B04). Mismo criterio que components/ui:
// quien consume importa de aquí y nunca del archivo suelto, para que partir o
// renombrar un componente no rompa a nadie.
// ============================================================================

export { PostCompleto } from './PostCompleto.tsx'
export type { PostCompletoProps } from './PostCompleto.tsx'

export { Comentario } from './Comentario.tsx'
export type { ComentarioProps } from './Comentario.tsx'

export { ListaComentarios } from './ListaComentarios.tsx'
export type { ListaComentariosProps } from './ListaComentarios.tsx'

export { CompositorRespuesta } from './CompositorRespuesta.tsx'
export type { CompositorRespuestaProps } from './CompositorRespuesta.tsx'

export { HiloEnVivo } from './HiloEnVivo.tsx'
export type { HiloEnVivoProps } from './HiloEnVivo.tsx'

export { BotonUtil } from './BotonUtil.tsx'
export type { BotonUtilProps } from './BotonUtil.tsx'

export { BotonApoyo } from './BotonApoyo.tsx'
export type { BotonApoyoProps } from './BotonApoyo.tsx'

export { EstadoValidacion } from './EstadoValidacion.tsx'
export type { EstadoValidacionProps, Estado } from './EstadoValidacion.tsx'
