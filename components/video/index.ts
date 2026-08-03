// ============================================================================
// components/video — barril de B07.
//
// `FeedVertical` es lo único que monta `/animo`. `TarjetaVideo` se exporta
// porque B13 (push «tu vídeo diario») necesitará abrir un vídeo suelto sin el
// scroll alrededor.
// ============================================================================

export { FeedVertical } from './FeedVertical.tsx'
export type { FeedVerticalProps } from './FeedVertical.tsx'

export { TarjetaVideo } from './TarjetaVideo.tsx'
export type { TarjetaVideoProps } from './TarjetaVideo.tsx'

export { useAutoplayEnVista, useActivoDelFeed, useAutoplayPermitido, leerPreferencias } from './useAutoplayEnVista.ts'
export { useDesbloqueoAudio, puedeSonar } from './desbloqueoAudio.ts'
