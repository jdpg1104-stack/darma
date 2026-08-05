// ============================================================================
// Constructores de respuesta de /api/health, /api/health/deep y /api/metrics
//
// POR QUÉ ESTÁN AQUÍ Y NO DENTRO DEL ROUTE HANDLER. Un `route.ts` importa
// `next/server`, que no se puede cargar desde `node --test`; si la lógica vive
// en el handler, la lógica no se prueba y lo que se acaba probando es un mock
// del framework. Aquí todo son funciones puras que devuelven `{status, cuerpo}`
// y el handler es tres líneas de traducción a `NextResponse`. Los tests del
// camino de fallo (Postgres caído → 503, token ausente → 401) atacan estas
// funciones directamente.
//
// LA REGLA DE LA RESPUESTA POBRE. `/api/health` es público. Su cuerpo dice
// exactamente tres cosas: si está sano, qué versión corre y el nombre + estado
// + latencia de cada dependencia. Ni host, ni versión de Postgres, ni mensaje
// del driver, ni cadena de conexión. El `detalle` de cada `Comprobacion` se
// descarta AQUÍ, en un `map` explícito, y no se confía en "es que nadie lo
// serializa": un `...c` de más en un refactor futuro filtraría
// `ECONNREFUSED 10.0.0.4:5432` a Internet.
// ============================================================================

import { esCronAutorizado } from '../cronAuth.ts'

import type { Comprobacion, EstadoDependencia } from './dependencias.ts'
import { evaluarPresupuestos, type Violacion } from './presupuestos.ts'

export interface DependenciaPublica {
  nombre: Comprobacion['nombre']
  estado: EstadoDependencia
  ms: number
}

export interface DatosSalud {
  estado: EstadoDependencia
  /** SHA del commit desplegado, o 'desconocido'. Nunca una versión de Postgres. */
  version: string
  dependencias: DependenciaPublica[]
}

export interface DatosSaludProfunda extends DatosSalud {
  violaciones: Violacion[]
}

export interface Respuesta<T> {
  status: number
  cuerpo: { ok: true; data: T } | { ok: false; code: string; message: string }
}

/**
 * Estado global a partir de las dependencias.
 *
 * `caido` gana sobre `degradado` y `degradado` sobre `ok`: el peor manda. Es la
 * misma lógica que `escalate()` en lib/crisis.ts, y por la misma razón — ante
 * la duda, hacia arriba.
 */
export function estadoGlobal(comprobaciones: readonly Comprobacion[]): EstadoDependencia {
  if (comprobaciones.some((c) => c.estado === 'caido')) return 'caido'
  if (comprobaciones.some((c) => c.estado === 'degradado')) return 'degradado'
  return 'ok'
}

/**
 * Código HTTP.
 *
 *   caido     → 503. Sácame del balanceador: no puedo servir a nadie.
 *   degradado → 200. Puedo servir, peor. Un 503 por lentitud momentánea saca de
 *               rotación instancias sanas justo cuando hay menos capacidad, y
 *               eso convierte un pico en una caída. La degradación se vigila
 *               por percentil (presupuestos.ts), no por semáforo.
 *   ok        → 200.
 */
export function statusPara(estado: EstadoDependencia): number {
  return estado === 'caido' ? 503 : 200
}

/** Recorta cada comprobación a lo publicable. El `detalle` se queda fuera. */
function aPublica(c: Comprobacion): DependenciaPublica {
  return { nombre: c.nombre, estado: c.estado, ms: c.ms }
}

export function versionDespliegue(): string {
  // El SHA del commit no revela nada que no revele el repositorio, y es lo
  // primero que se pregunta en un incidente ("¿qué hay desplegado?").
  return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? 'desconocido'
}

export function construirSalud(
  comprobaciones: readonly Comprobacion[],
  version: string = versionDespliegue(),
): Respuesta<DatosSalud> {
  const estado = estadoGlobal(comprobaciones)
  return {
    status: statusPara(estado),
    cuerpo: {
      ok: true,
      data: { estado, version, dependencias: comprobaciones.map(aPublica) },
    },
  }
}

export function construirSaludProfunda(
  comprobaciones: readonly Comprobacion[],
  instantanea: Record<string, number>,
  version: string = versionDespliegue(),
): Respuesta<DatosSaludProfunda> {
  const estado = estadoGlobal(comprobaciones)
  return {
    status: statusPara(estado),
    cuerpo: {
      ok: true,
      data: {
        estado,
        version,
        dependencias: comprobaciones.map(aPublica),
        violaciones: evaluarPresupuestos(instantanea),
      },
    },
  }
}

// ── Autenticación de las rutas de máquina ───────────────────────────────────
//
// AQUÍ NO HAY FUNCIÓN DE AUTENTICACIÓN, y es a propósito. La hubo: un
// `bearerValido` escrito a mano que era la peor de las cuatro copias que
// llegó a haber en el repo —comparaba `charCodeAt` (UNIDADES UTF-16, no
// bytes) y, sobre todo, **retornaba antes si las longitudes diferían**, que es
// justo el oráculo de longitud que el relleno + `timingSafeEqual` de
// `lib/cronAuth.ts` existe para evitar—.
//
// Ahora las dos rutas de máquina de este bloque llaman a `esCronAutorizado`
// con su propio secreto: `/api/health/deep` con `CRON_SECRET` y `/api/metrics`
// con `METRICS_TOKEN`. La función es la misma; los secretos NO, y no deben
// unificarse: quien pueda leer métricas no tiene por qué poder disparar el
// sondeo caro.
//
// Se quitó también el alias `bearerValido`. Un segundo nombre para la misma
// comparación es como vuelve a empezar la divergencia: alguien "mejora"
// `bearerValido` sin mirar que es la de todos.

export interface RespuestaMetricas {
  status: number
  /** Texto Prometheus, o cadena VACÍA cuando no está autorizado. */
  cuerpo: string
  contentType: string
}

/**
 * Respuesta de `/api/metrics`.
 *
 * Sin token: 401 y **cuerpo vacío**. No un 401 con la lista de nombres de
 * métrica "para ayudar a depurar": esos nombres ya cuentan el volumen de la
 * red, los picos horarios y el tamaño de la cola de moderación, que es
 * exactamente lo que el token protege. Un 401 hablador es una fuga con estilo.
 */
export function construirMetricas(
  cabeceraAuth: string | null | undefined,
  texto: () => string,
  secreto: string | undefined = process.env.METRICS_TOKEN,
): RespuestaMetricas {
  if (!esCronAutorizado(cabeceraAuth, secreto)) {
    return { status: 401, cuerpo: '', contentType: 'text/plain; charset=utf-8' }
  }
  return {
    status: 200,
    cuerpo: texto(),
    contentType: 'text/plain; version=0.0.4; charset=utf-8',
  }
}

/** Error uniforme para las rutas de este bloque. Mismo formato que CONTRATOS §4. */
export function respuestaNoAutenticado(): Respuesta<never> {
  return {
    status: 401,
    cuerpo: { ok: false, code: 'no_autenticado', message: 'Credencial de máquina inválida.' },
  }
}
