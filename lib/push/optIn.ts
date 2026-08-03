// ============================================================================
// B13 · Cuándo se pide permiso de notificaciones
//
// ── EL ERROR QUE NO SE PUEDE DESHACER CON UN DESPLIEGUE ────────────────────
// `Notification.requestPermission()` en el primer render se deniega, y la
// denegación de Chrome es PERMANENTE para el origen: no hay segunda
// oportunidad, y la persona tendría que entrar en la configuración del sitio
// para revertirla. Un bug normal se arregla desplegando; este no.
//
// De ahí las tres condiciones que impone este módulo, todas a la vez:
//   1. Ha ocurrido un momento en el que la notificación TIENE SENTIDO para esa
//      persona: su primer comentario se validó, o guardó su primera Alma Afín.
//      Antes de eso no hay nada que avisar y el permiso se pide en el vacío.
//   2. Hay explicación previa en la UI y un gesto explícito. Nunca al cargar.
//   3. El «ahora no» pospone 7 días, y se acaba dejando de preguntar.
//
// La lógica vive aquí, pura y sin `window`, para que se pueda probar sin
// navegador. El componente (`components/pwa/OptInPush.tsx`) solo la consume.
//
// ── LO QUE SE REGISTRA ─────────────────────────────────────────────────────
// Si se mostró, si se aceptó y si se descartó. Nada más: ni cuándo, ni desde
// qué dispositivo, ni ningún identificador. Vive en `localStorage`, no viaja al
// servidor y no hay ninguna tabla donde caiga.
// ============================================================================

/** Clave única en `localStorage`. Prefijada para no chocar con otros bloques. */
export const CLAVE_OPTIN = 'darma.push.optin'

/** Un «ahora no» aplaza una semana. */
export const APLAZAMIENTO_MS = 7 * 24 * 60 * 60 * 1000

/** Tras tres «ahora no», se deja de preguntar. Insistir es acoso de producto. */
export const MAX_APLAZAMIENTOS = 3

/** Momentos en los que la notificación empieza a tener sentido para alguien. */
export type MomentoOportuno =
  | 'primer_comentario_validado'
  | 'primera_alma_afin'
  | 'primer_refugio'

/** Estado persistido. Sin fechas absolutas salvo la del aplazamiento. */
export interface EstadoOptIn {
  /** Se llegó a mostrar la explicación alguna vez. */
  mostrado: boolean
  /** La persona aceptó (independientemente de lo que dijera el navegador). */
  aceptado: boolean
  /** Cuántas veces dijo «ahora no». */
  aplazamientos: number
  /** Epoch ms hasta el que no se vuelve a preguntar. */
  aplazadoHasta: number | null
}

export const ESTADO_INICIAL: Readonly<EstadoOptIn> = Object.freeze({
  mostrado: false,
  aceptado: false,
  aplazamientos: 0,
  aplazadoHasta: null,
})

/** Normaliza lo que haya en `localStorage`, que puede ser cualquier cosa. */
export function leerEstado(crudo: string | null): EstadoOptIn {
  if (!crudo) return { ...ESTADO_INICIAL }
  try {
    const dato = JSON.parse(crudo) as Record<string, unknown>
    if (typeof dato !== 'object' || dato === null) return { ...ESTADO_INICIAL }
    return {
      mostrado: dato.mostrado === true,
      aceptado: dato.aceptado === true,
      aplazamientos:
        typeof dato.aplazamientos === 'number' && dato.aplazamientos >= 0
          ? Math.floor(dato.aplazamientos)
          : 0,
      aplazadoHasta:
        typeof dato.aplazadoHasta === 'number' && Number.isFinite(dato.aplazadoHasta)
          ? dato.aplazadoHasta
          : null,
    }
  } catch {
    // JSON corrupto = empezar de cero. Nunca lanzar: esto corre en el render.
    return { ...ESTADO_INICIAL }
  }
}

export interface ContextoOptIn {
  /** ¿Hay llaves VAPID? Si no, no hay nada que ofrecer y no se pinta nada. */
  configurado: boolean
  /** `Notification.permission`, o `null` si el navegador no lo soporta. */
  permiso: 'default' | 'granted' | 'denied' | null
  /** El momento que acaba de ocurrir, o `null` si no ha ocurrido ninguno. */
  momento: MomentoOportuno | null
  estado: EstadoOptIn
  ahora: number
}

/**
 * ¿Se puede mostrar la explicación previa AHORA?
 *
 * Todas las condiciones son necesarias. El orden está escrito de lo más barato
 * a lo más específico para que se lea como una lista de razones por las que
 * NO se pregunta.
 */
export function debeMostrarOptIn(ctx: ContextoOptIn): boolean {
  // Sin llaves VAPID la feature está apagada entera: pedir permiso para algo
  // que no se puede entregar quema el origen a cambio de nada.
  if (!ctx.configurado) return false
  // Navegador sin soporte, o permiso ya resuelto en cualquier sentido.
  if (ctx.permiso !== 'default') return false
  if (ctx.estado.aceptado) return false
  if (ctx.estado.aplazamientos >= MAX_APLAZAMIENTOS) return false
  if (ctx.estado.aplazadoHasta !== null && ctx.ahora < ctx.estado.aplazadoHasta) return false
  // Y, sobre todo: que haya pasado algo que justifique el aviso.
  return ctx.momento !== null
}

/** Nuevo estado tras un «ahora no». */
export function aplazar(estado: EstadoOptIn, ahora: number): EstadoOptIn {
  return {
    ...estado,
    mostrado: true,
    aplazamientos: estado.aplazamientos + 1,
    aplazadoHasta: ahora + APLAZAMIENTO_MS,
  }
}

/** Nuevo estado tras aceptar (haya dicho lo que haya dicho el navegador). */
export function aceptar(estado: EstadoOptIn): EstadoOptIn {
  return { ...estado, mostrado: true, aceptado: true, aplazadoHasta: null }
}
