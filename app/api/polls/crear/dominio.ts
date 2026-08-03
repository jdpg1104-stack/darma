// ============================================================================
// Todo lo que decide `POST /api/polls/crear`, SIN Next, SIN red y SIN reloj
// propio.
//
// Está separado de `route.ts` por el mismo motivo que `lib/auth/respuestas.ts`
// está separado de `http.ts`: así las pruebas de los caminos de fallo —sin rol,
// una sola opción, opciones duplicadas, señales de crisis, `total_votes`
// inyectado— son pruebas de la decisión real y no de un doble de Supabase. Un
// doble de cliente nunca puede demostrar un permiso; una función pura sí puede
// demostrar una decisión.
//
// Las rutas relativas con `.ts` (y no el alias `@/` de CONTRATOS §1) son
// obligadas: `node --test --experimental-strip-types` no resuelve el alias del
// tsconfig. Mismo precedente que `app/(admin)/_lib/acceso.ts` y
// `app/api/feed/validacion.test.ts`.
// ============================================================================

import { z } from 'zod'

import { cumpleRol, type RolAdmin } from '../../../(admin)/_lib/acceso.ts'
import { ErrorApi } from '../../../../lib/auth/errores.ts'
import { evaluarRiesgoEncuesta, type RiesgoEncuesta } from '../../../../lib/polls/riesgo.ts'
import { esquemaEncuestaNueva } from '../../../../lib/polls/validacion.ts'
import { MIN_REVELACION_POR_DEFECTO } from '../../../../lib/polls/limites.ts'
import {
  IDIOMAS,
  MIN_REVELACION_SUELO,
  MIN_REVELACION_TECHO,
  ROL_MINIMO,
  type IdiomaEncuesta,
} from './limites.ts'

// Los números viven en `limites.ts`, que no importa ni un solo valor y por eso
// lo puede consumir el formulario `'use client'` sin arrastrar el cliente
// `service_role` al navegador. Ver la cabecera de ese archivo.
export { IDIOMAS, LIMITE_CREAR, MIN_REVELACION_SUELO, MIN_REVELACION_TECHO, ROL_MINIMO } from './limites.ts'
export type { IdiomaEncuesta } from './limites.ts'

// ── El esquema ──────────────────────────────────────────────────────────────
// `esquemaEncuestaNueva` (B09) aporta `pregunta` y `opciones` con los límites
// ya importados de `limites.ts`; aquí solo se añade lo que la creación necesita
// y que B09 no podía saber.
//
// `.strict()` NO es higiene: es la defensa que hace que `{ ..., total_votes:
// 40000 }` sea un 422 y no un campo ignorado en silencio. `0109_1` §0(a)
// documenta que ese era el ataque real —publicar una encuesta ya con el
// recuento que te conviene—, y aunque hoy la RPC ni siquiera acepta ese
// parámetro, un esquema permisivo convierte cualquier ampliación futura de la
// función en un agujero sin que nadie toque esta línea.
export const esquemaCrearEncuesta = esquemaEncuestaNueva
  .extend({
    idioma: z.enum(IDIOMAS).default('es'),
    minRevelacion: z
      .number()
      .int()
      .min(MIN_REVELACION_SUELO)
      .max(MIN_REVELACION_TECHO)
      .default(MIN_REVELACION_POR_DEFECTO),
    /** ISO-8601 (CONTRATOS §1). `null` = no cierra. */
    cierraEn: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict()

export interface PlanCreacion {
  pregunta: string
  opciones: string[]
  idioma: IdiomaEncuesta
  minRevelacion: number
  cierraEn: string | null
  /**
   * `hidden` cuando el texto trae señales de crisis. Ver §Crisis más abajo.
   */
  estado: 'active' | 'hidden'
  riesgo: RiesgoEncuesta
}

/**
 * Normaliza una opción para compararla con las demás.
 *
 * Espejo EXACTO de la normalización de `crear_encuesta()` en Postgres
 * (`lower(btrim(regexp_replace(o, '\s+', ' ', 'g')))`). Si las dos divergen, la
 * que manda es la de la base y esta pasa a ser un aviso adelantado que a veces
 * falla — que es peor que no tenerlo, porque nadie lo sospecha.
 */
export function normalizarOpcion(opcion: string): string {
  return opcion.trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * ¿Hay dos opciones que dicen lo mismo?
 *
 * No es una manía de limpieza: dos opciones equivalentes parten en dos el voto
 * de quien piensa igual y hunden ambas por debajo del umbral de revelación, así
 * que la encuesta no enseña resultados nunca y nadie entiende por qué.
 */
export function hayOpcionesDuplicadas(opciones: readonly string[]): boolean {
  const vistas = new Set(opciones.map(normalizarOpcion))
  return vistas.size !== opciones.length
}

export interface EntradaPlan {
  cuerpo: unknown
  /** Rol EFECTIVO que devolvió el guard. Nunca algo que venga del cliente. */
  rol: RolAdmin
  /** Se inyecta para que la función sea pura y la prueba no dependa del reloj. */
  ahora?: Date
}

/**
 * Valida, autoriza y decide. Lanza `ErrorApi`; nunca devuelve un error.
 *
 * ── §Crisis · CONTRATOS §9 ────────────────────────────────────────────────
 * Una encuesta con señales de crisis NO se rechaza y NO se borra: §9.2 dice
 * que la persona debe seguir siendo escuchada, y devolver un 422 seco a quien
 * acaba de escribir «¿alguien más ha pensado en no estar?» es exactamente
 * callarla. Pero §9.3 prohíbe amplificar contenido autodestructivo en el feed,
 * y una encuesta se le sirve a TODA la red: publicarla ES amplificarla.
 *
 * La única salida que respeta las dos cosas: se crea en `hidden`, se registra
 * en `crisis_events` y quien la escribió recibe los recursos de ayuda EN LA
 * MISMA RESPUESTA (§9.1), junto con el hecho de que la encuesta existe y está
 * esperando revisión. Nada ocurre en silencio.
 */
export function prepararCreacion(entrada: EntradaPlan): PlanCreacion {
  // ── 1. Rol ────────────────────────────────────────────────────────────────
  // Redundante con `requireAdmin()` y con el 42501 de la propia RPC, y las tres
  // se quedan: el guard audita, esta hace que el caso sea probable sin base de
  // datos, y la de Postgres es la que no se puede rodear.
  if (!cumpleRol(entrada.rol, ROL_MINIMO)) {
    throw new ErrorApi('sin_permiso')
  }

  // ── 2. Forma ──────────────────────────────────────────────────────────────
  const analisis = esquemaCrearEncuesta.safeParse(entrada.cuerpo)
  if (!analisis.success) {
    // El detalle de zod se queda en `causa`: describe la forma exacta de la
    // validación, y eso es información sobre el sistema (misma regla que
    // `lib/polls/validacion.ts`).
    throw new ErrorApi('entrada_invalida', { causa: analisis.error })
  }
  const datos = analisis.data

  // ── 3. Opciones distintas entre sí ────────────────────────────────────────
  if (hayOpcionesDuplicadas(datos.opciones)) {
    throw new ErrorApi('entrada_invalida', {
      mensaje: 'Hay dos opciones que dicen lo mismo. Cada opción tiene que ser distinta.',
    })
  }

  // ── 4. La fecha de cierre, si la hay, tiene que estar por delante ─────────
  if (datos.cierraEn !== null) {
    const ahora = entrada.ahora ?? new Date()
    if (new Date(datos.cierraEn).getTime() <= ahora.getTime()) {
      throw new ErrorApi('entrada_invalida', {
        mensaje: 'La fecha de cierre ya ha pasado.',
      })
    }
  }

  // ── 5. Crisis ─────────────────────────────────────────────────────────────
  // Sobre la pregunta Y sobre cada opción: el riesgo puede estar en una opción
  // («ya lo he intentado») aunque la pregunta parezca inocua.
  const riesgo = evaluarRiesgoEncuesta(datos.pregunta, datos.opciones)

  return {
    pregunta: datos.pregunta,
    opciones: [...datos.opciones],
    idioma: datos.idioma,
    minRevelacion: datos.minRevelacion,
    cierraEn: datos.cierraEn,
    estado: riesgo.requiereIntervencion ? 'hidden' : 'active',
    riesgo,
  }
}

// ── Forma de la respuesta ───────────────────────────────────────────────────
// Lo que sale por la API, campo a campo y nunca con un spread de la fila: es la
// misma regla que la cabecera de `lib/polls/tipos.ts`. `min_reveal` NO sale
// (publicarlo dice «faltan 2 votos para ver los resultados», que es una
// invitación a traer dos cuentas) y `author_id` tampoco.

export interface OpcionCreada {
  id: string
  ordinal: number
  label: string
}

/** Un recurso de ayuda, traducido al español como todo lo que cruza la API.
 *  `verifiedAt` NO se copia: la fecha de verificación es información interna y
 *  hoy además miente (es la fecha en que se escribieron los números, no en que
 *  se verificaron — bug ya anotado en PEDIDOS.md por B17). */
export interface RecursoAyuda {
  nombre: string
  telefono?: string
  url?: string
  horario: string
}

export interface TarjetaRecursos {
  mensaje: string
  recursos: RecursoAyuda[]
}

export interface EncuestaCreada {
  id: string
  pregunta: string
  opciones: OpcionCreada[]
  idioma: IdiomaEncuesta
  /** false ⇒ existe pero no está en el feed. Ver §Crisis. */
  publicada: boolean
  /** Presente SOLO cuando hubo señales de crisis (CONTRATOS §9.1). */
  ayuda?: TarjetaRecursos
}

/** El `jsonb` que devuelve `crear_encuesta()`. Declarado a mano porque
 *  `lib/supabase/database.types.ts` todavía no contiene la función (misma nota
 *  que el resto del repo; anotado en PEDIDOS.md). */
export interface FilaEncuestaCreada {
  id: string
  state: 'active' | 'hidden'
  origin: string
  language: string
  options: OpcionCreada[]
}

/** Proyecta la fila de Postgres al contrato público. */
export function proyectar(fila: FilaEncuestaCreada, plan: PlanCreacion): EncuestaCreada {
  const salida: EncuestaCreada = {
    id: fila.id,
    pregunta: plan.pregunta,
    opciones: fila.options.map((o) => ({ id: o.id, ordinal: o.ordinal, label: o.label })),
    idioma: plan.idioma,
    publicada: fila.state === 'active',
  }

  if (plan.riesgo.requiereIntervencion && plan.riesgo.mensaje !== null) {
    salida.ayuda = {
      mensaje: plan.riesgo.mensaje,
      recursos: plan.riesgo.recursos.map((r) => {
        const recurso: RecursoAyuda = { nombre: r.name, horario: r.hours }
        if (r.phone !== undefined) recurso.telefono = r.phone
        if (r.url !== undefined) recurso.url = r.url
        return recurso
      }),
    }
  }

  return salida
}
