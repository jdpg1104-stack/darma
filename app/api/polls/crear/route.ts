// ============================================================================
// POST /api/polls/crear  →  { ok: true, data: EncuestaCreada }
//
// La ruta que faltaba: el banco se repone solo y `encuesta_siguiente()` sirve
// las encuestas al feed, pero hasta ahora nadie podía publicar una (pedido de
// B09 → B00 en HANDOFF/PEDIDOS.md).
//
// ── EL ORDEN, QUE ES LO ÚNICO QUE IMPORTA AQUÍ ────────────────────────────
//   1. `requireAdmin('moderador')` — sesión, rate limit del panel y rol REAL
//      en Postgres. Audita SIEMPRE, concedido o denegado (B19).
//   2. Rate limit de ESCRITURA, aparte del anterior. El del guard es de panel
//      (120/min de lectura); publicar en el feed de toda la red no puede
//      compartir presupuesto con refrescar una pantalla.
//   3. `prepararCreacion()` — zod `.strict()`, opciones distintas, y la
//      evaluación de crisis sobre la pregunta Y sobre cada opción. TODO esto
//      ANTES de escribir nada (CONTRATOS §9).
//   4. `crear_encuesta()` — la escritura, por una función `security definer`
//      concedida solo a `service_role`.
//   5. `crisis_events` + la tarjeta de recursos en ESTA MISMA respuesta.
//
// ── POR QUÉ EL CLIENTE ADMIN Y NO EL RLS (CONTRATOS §6 pide justificarlo) ──
// Porque `0109_1` §5 revoca a `authenticated` el INSERT de `origin`,
// `min_reveal`, `language` y `state` a propósito: son justo las columnas que
// declaran «esto es del banco», «bájame el umbral hasta des-anonimizar a quien
// vota» y «esto entra en el feed». Una encuesta creada con el cliente RLS
// nacería con el idioma y el umbral por defecto y no habría forma de elegirlos.
// El privilegio no se le devuelve al cliente: la escritura entra por la RPC,
// que además vuelve a comprobar el rol dentro del motor (42501). Es el mismo
// patrón que `reponer_encuestas()` y que `award_karma()`.
//
// ── LO QUE NO HACE ESTA RUTA ──────────────────────────────────────────────
// No acepta `authorId`, ni `origin`, ni `total_votes`, ni `state`. El autor
// sale de la sesión (CONTRATOS §6) y el estado lo decide la evaluación de
// crisis. `.strict()` convierte cualquiera de esos campos en un 422.
// ============================================================================

import { ErrorApi, codigoDesdePostgres } from '@/lib/auth/errores'
import { manejarRuta } from '@/lib/auth/http'
import { sobreOk } from '@/lib/auth/respuestas'
import { rateLimit } from '@/lib/rateLimit'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAdmin } from '../../admin/_guard.ts'
import { auditar } from '@/app/(admin)/_lib/acceso'
import {
  LIMITE_CREAR,
  ROL_MINIMO,
  prepararCreacion,
  proyectar,
  type FilaEncuestaCreada,
  type PlanCreacion,
} from './dominio.ts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Acción auditada. Cadena literal y no una constante de `ACCIONES` porque ese
 *  objeto es de B19 y añadirle una clave desde aquí es editar su archivo. El
 *  prefijo `admin.` mantiene la consulta forense agrupada. */
const ACCION = 'admin.encuestas.crear'

async function leerCuerpo(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    // Un cuerpo vacío o no-JSON es una petición mal formada, no un 500.
    throw new ErrorApi('entrada_invalida')
  }
}

/**
 * Registra el evento de crisis. CONTRATOS §9.1.
 *
 * NO lanza nunca: si hay que elegir entre la trazabilidad y enseñarle un
 * teléfono a alguien que acaba de escribir lo que ha escrito, se enseña el
 * teléfono. Mismo criterio que `app/api/comments/crisisHilo.ts`.
 *
 * El país va a `null` a propósito: resolverlo exige leer `identity_vault`, que
 * es la tabla que vincula alias y persona real, y abrirla en la ruta de crear
 * una encuesta no se justifica. `helpResourcesFor(null)` devuelve el directorio
 * internacional, que nunca es una lista vacía.
 */
async function registrarCrisis(
  admin: ReturnType<typeof createAdminClient>,
  plan: PlanCreacion,
  encuestaId: string,
  autorId: string,
): Promise<void> {
  if (!plan.riesgo.requiereIntervencion) return

  const { error } = await admin.from('crisis_events').insert({
    user_id: autorId,
    ref_type: 'poll',
    ref_id: encuestaId,
    risk: plan.riesgo.evaluacion.risk_level,
    // QUÉ se mostró exactamente, no solo que se detectó.
    resources_shown: plan.riesgo.recursos.map((r) => r.name),
    country_code: null,
  })

  if (error) {
    console.error('[darma][b00] no se pudo registrar crisis_events', {
      encuesta: encuestaId,
      code: error.code,
    })
  }
}

export async function POST(request: Request) {
  return manejarRuta(async () => {
    // ── 1 · Sesión + rol + auditoría ─────────────────────────────────────────
    const contexto = await requireAdmin(ROL_MINIMO, { limite: 'lectura', accion: ACCION })

    const admin = createAdminClient()

    // ── 2 · Rate limit de escritura ──────────────────────────────────────────
    // `failClosed`: esto publica en el feed de toda la red. Ante la duda, no.
    const permitido = await rateLimit({
      key: `polls:crear:${contexto.userId}`,
      limit: LIMITE_CREAR.limite,
      windowSeconds: LIMITE_CREAR.ventanaSegundos,
      supabase: admin,
      failClosed: true,
    })
    if (!permitido.ok) {
      throw new ErrorApi('demasiadas_peticiones', { retryAfter: permitido.retryAfter })
    }

    // ── 3 · Validación, opciones distintas y crisis — antes de escribir ─────
    const plan = prepararCreacion({ cuerpo: await leerCuerpo(request), rol: contexto.rol })

    // ── 4 · La escritura ─────────────────────────────────────────────────────
    const { data, error } = await admin.rpc('crear_encuesta', {
      p_autor: contexto.userId,
      p_pregunta: plan.pregunta,
      p_opciones: plan.opciones,
      p_idioma: plan.idioma,
      p_min_reveal: plan.minRevelacion,
      p_cierra_en: plan.cierraEn,
      p_estado: plan.estado,
    })

    if (error) {
      // `codigoDesdePostgres()` traduce el 42501 de la RPC a `sin_permiso` sin
      // que el mensaje del motor salga de aquí. Los tres `raise` de validación
      // de la función (22023) caen en `error_interno` a propósito: si llegan
      // hasta ahí es que el zod de arriba y el CHECK de la base discrepan, y
      // eso es un fallo NUESTRO, no de quien llama.
      const codigo = codigoDesdePostgres(error)
      if (codigo === 'sin_permiso') {
        await auditar({
          actorId: contexto.userId,
          action: 'admin.denegado',
          targetType: 'ruta',
          targetId: ACCION,
          params: { motivo: 'sin_rol_en_base' },
        })
      }
      throw new ErrorApi(codigo, { causa: error })
    }

    const fila = data as FilaEncuestaCreada | null
    if (fila === null) throw new ErrorApi('error_interno')

    // ── 5 · Crisis: registro + recursos en la misma respuesta ────────────────
    await registrarCrisis(admin, plan, fila.id, contexto.userId)

    await auditar({
      actorId: contexto.userId,
      action: ACCION,
      targetType: 'encuesta',
      targetId: fila.id,
      // Ni la pregunta ni las opciones: `admin_audit_log.params` lleva los
      // PARÁMETROS de la acción, no el contenido sobre el que se actuó.
      params: { idioma: plan.idioma, publicada: fila.state === 'active' },
    })

    return sobreOk(proyectar(fila, plan), 201)
  })
}
