// ============================================================================
// B13 · Barril de `lib/push`. La única vía de import para el resto de bloques:
//
//     import { avisar, avisarAlmasAfines } from '@/lib/push'
//
// Lo que un bloque de producto necesita es `avisar()` y `avisarAlmasAfines()`;
// todo lo demás (transporte, plantillas, política) es interior de B13 y se
// exporta solo porque las rutas y las pruebas lo consumen.
//
// `despacho.ts` y `enviar.ts` acaban importando `lib/supabase/admin.ts` de forma
// diferida (`await import`), así que este barril NUNCA debe importarse desde un
// componente con `'use client'`. Los componentes de `components/pwa/**` hablan
// con `/api/push/*` por `fetch`, no con este módulo.
// ============================================================================

export { avisar, avisarAlmasAfines, configurarDespacho } from './despacho.ts'
export type { ArgumentosAviso, PuertoDatosPush, ResultadoAviso } from './despacho.ts'

export {
  PREFS_POR_DEFECTO,
  TIPOS_NOTIFICACION,
  esTipoNotificacion,
  estaActivo,
  revelaAlias,
  sanitizarPrefs,
} from './preferencias.ts'
export type { Preferencias, TipoNotificacion } from './preferencias.ts'

export {
  SILENCIO_DESDE_POR_DEFECTO,
  SILENCIO_HASTA_POR_DEFECTO,
  TECHO_DIARIO,
  TIPO_EXENTO,
  VENTANA_AGRUPACION_MS,
  decidirEnvio,
} from './horario.ts'
export type { DecisionEnvio } from './horario.ts'

export { construirCarga, todosLosTextos } from './plantillas.ts'

export { enviarA, enviarAVarias, pushConfigurado } from './enviar.ts'
export type { CargaPush, ResultadoEnvio, Suscripcion } from './tipos.ts'

export { clavePublicaVapid, configuracionVapid } from './vapid.ts'

export { endpointValido, hostPermitido } from './endpoint.ts'

export {
  APLAZAMIENTO_MS,
  CLAVE_OPTIN,
  ESTADO_INICIAL,
  MAX_APLAZAMIENTOS,
  aceptar,
  aplazar,
  debeMostrarOptIn,
  leerEstado,
} from './optIn.ts'
export type { ContextoOptIn, EstadoOptIn, MomentoOportuno } from './optIn.ts'
