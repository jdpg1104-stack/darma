// ============================================================================
// lib/video — el barril de B07. Lo que otros bloques pueden importar.
//
//     import { objetivoCompletado, type ItemVideo } from '@/lib/video'
//
// Bloqueados por B07 y consumidores previstos:
//   · B05 (perfil, «contenidos completados») → `ItemVideo`, `urlMiniatura`.
//   · B13 (push, «tu vídeo diario»)          → `ItemVideo`, `urlEmbed`.
//
// ⚠️ `lib/video/servidor.ts` NO se re-exporta aquí, y es a propósito: importa
// el cliente `service_role`. Si estuviera en el barril, cualquier componente
// cliente que importase un TIPO de `@/lib/video` arrastraría la cadena hasta
// `lib/supabase/admin.ts`. Quien necesite las RPC lo importa por su ruta
// completa, desde un Route Handler, y eso se ve en el diff.
// ============================================================================

export type {
  ItemVideo,
  PaginaCursor,
  EstadoLatido,
  MotivoNoAcreditado,
  MotivoRpc,
  ResultadoCompletado,
  FilaFeed,
} from './tipos.ts'

export {
  ORIGEN_EMBED,
  ORIGEN_MINIATURA,
  urlEmbed,
  urlEmbedDeItem,
  urlMiniatura,
  itemVideoDesde,
  esReproducible,
  esIdYoutubeValido,
  origenPropio,
} from './embed.ts'
export type { CandidatoEmbed, OpcionesEmbed } from './embed.ts'

export {
  TOPE_POR_LATIDO_S,
  INTERVALO_LATIDO_MS,
  FRACCION_COMPLETADO,
  DURACION_POR_DEFECTO_S,
  objetivoCompletado,
  acreditarLatido,
  faltanSegundos,
  estaListo,
} from './acreditacion.ts'

export {
  UMBRAL_VISIBILIDAD,
  autoplayPermitido,
  elegirActivo,
  ventanaDeIframes,
} from './autoplay.ts'
export type { PreferenciasReproduccion, Visibilidad } from './autoplay.ts'

export {
  GESTOS_VALIDOS,
  GESTOS_INVALIDOS,
  esGestoValido,
  estadoInicial,
  puedeSonar,
  registrarGesto,
} from './audio.ts'
export type { EstadoAudio, ActivacionUsuario } from './audio.ts'

export {
  ESTADO,
  parsearMensaje,
  enviarComando,
  suscribirse,
} from './reproductor.ts'
export type {
  ComandoReproductor,
  EstadoReproductor,
  MensajeReproductor,
  MensajeEntrante,
  DestinoComando,
} from './reproductor.ts'

export {
  CURSOR_INICIAL,
  codificarCursor,
  decodificarCursor,
  siguienteCursor,
} from './cursor.ts'
export type { Cursor } from './cursor.ts'
