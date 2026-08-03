// ============================================================================
// B13 · Despacho · el sitio donde se aplican TODAS las reglas antes de vibrar
//
// Otros bloques llaman aquí y a ningún otro sitio:
//
//     await avisar({ destinatarioId, tipo: 'te_escucharon', emisorId, url })
//     await avisarAlmasAfines(quienNecesitaHablar)
//
// El orden de las comprobaciones es el contenido de este archivo, y no es
// arbitrario:
//
//   1. BLOQUEO, lo primero de todo. Que alguien bloqueado no pueda escribirte
//      pero sí hacer vibrar tu teléfono sería un agujero grande, y silencioso.
//      Se comprueba en Postgres (`is_blocked_between`), no en la app.
//   2. SILENCIO DEL REFUGIO (`refuge_members.muted`).
//   3. PREFERENCIAS, silencio nocturno y agrupación (`decidirEnvio`, puro).
//   4. TECHO DIARIO, que se consume en Postgres y SOLO si todo lo anterior dijo
//      que sí — ver la nota sobre el orden más abajo.
//   5. ALIAS DEL EMISOR, decidido con los datos DEL EMISOR.
//   6. Envío.
//
// ── POR QUÉ EL TECHO SE CONSULTA EL ÚLTIMO ────────────────────────────────
// `check_rate_limit()` CUENTA al preguntar. Si se llamara antes que el silencio
// nocturno o la agrupación, un aviso que nunca se llegó a entregar gastaría uno
// de los cuatro del día, y la persona se quedaría sin recibir el que sí
// importaba. Por eso `decidirEnvio` se evalúa primero con `enviadosHoy: 0` (que
// solo puede devolver 'desactivado', 'silencio' o 'agrupado') y solo si dice
// que sí se consume el contador. Cuando el contador dice que no, se vuelve a
// llamar a `decidirEnvio` con el techo agotado para que el motivo salga de la
// misma función y no de un `if` suelto.
//
// ── LA CRISIS NO PASA POR EL CONTADOR ─────────────────────────────────────
// `alma_afin_en_crisis` ni siquiera lo consulta. No es una optimización: es que
// no debe existir ningún estado del sistema capaz de impedir ese aviso.
// ============================================================================

import { decidirEnvio, TECHO_DIARIO, TIPO_EXENTO, type DecisionEnvio } from './horario.ts'
import { construirCarga } from './plantillas.ts'
import { revelaAlias, sanitizarPrefs, type TipoNotificacion } from './preferencias.ts'
import { enviarAVarias } from './enviar.ts'
import { pushConfigurado } from './vapid.ts'
import type { Suscripcion } from './tipos.ts'

/** Lo que el despacho necesita saber de la base. Es un PUERTO para que las
 *  pruebas no monten un Supabase entero. */
export interface PuertoDatosPush {
  hayBloqueo(a: string, b: string): Promise<boolean>
  silenciadoEnRefugio(userId: string, refugeId: string): Promise<boolean>
  ajustesDe(userId: string): Promise<{
    prefs: unknown
    quietFrom: number | null
    quietTo: number | null
    tzOffset: number
  }>
  /** Alias del emisor SOLO si esa persona permite revelarlo. `null` si no. */
  aliasSiRevela(emisorId: string): Promise<string | null>
  suscripcionesDe(userId: string): Promise<Suscripcion[]>
  /** Último aviso de este tipo (epoch ms) y cuántos quedaron acumulados. */
  estadoDe(userId: string, tipo: TipoNotificacion): Promise<{
    ultimoMs: number | null
    pendientes: number
  }>
  /** Consume uno de los 4 del día. `false` = techo alcanzado. */
  consumirTecho(userId: string): Promise<boolean>
  anotarEnviado(userId: string, tipo: TipoNotificacion): Promise<void>
  acumular(userId: string, tipo: TipoNotificacion, diferidoHasta: string | null): Promise<void>
}

export interface ArgumentosAviso {
  destinatarioId: string
  tipo: TipoNotificacion
  /** Quién lo provoca. `null` en `nivel_alcanzado`, que no viene de nadie. */
  emisorId: string | null
  url: string
  /** Solo para `mensaje_refugio`: permite respetar `refuge_members.muted`. */
  refugeId?: string
  ahora?: Date
}

export interface ResultadoAviso {
  enviado: boolean
  motivo: DecisionEnvio['motivo'] | 'bloqueado' | 'silenciado_refugio' | 'sin_dispositivos' | 'apagado'
  /** Cuántas suscripciones aceptaron la entrega. */
  entregas: number
}

let puertoInyectado: PuertoDatosPush | null = null

/** SOLO para pruebas. */
export function configurarDespacho(puerto: PuertoDatosPush | null): void {
  puertoInyectado = puerto
}

/**
 * Envía un aviso aplicando la política entera. Nunca lanza.
 *
 * Devuelve por qué NO se envió cuando no se envía: quien llama (B04, B10) no
 * hace nada con ese motivo salvo, quizá, registrarlo — pero tener el motivo
 * tipado es lo que permite probar la política desde fuera.
 */
export async function avisar(args: ArgumentosAviso): Promise<ResultadoAviso> {
  if (!pushConfigurado()) return { enviado: false, motivo: 'apagado', entregas: 0 }

  const puerto = puertoInyectado ?? (await puertoPorDefecto())
  if (!puerto) return { enviado: false, motivo: 'apagado', entregas: 0 }

  try {
    const ahora = args.ahora ?? new Date()

    // ── 1. Bloqueo, antes que nada ────────────────────────────────────────
    if (args.emisorId && args.emisorId !== args.destinatarioId) {
      if (await puerto.hayBloqueo(args.destinatarioId, args.emisorId)) {
        return { enviado: false, motivo: 'bloqueado', entregas: 0 }
      }
    }

    // ── 2. Refugio silenciado ─────────────────────────────────────────────
    if (args.tipo === 'mensaje_refugio' && args.refugeId) {
      if (await puerto.silenciadoEnRefugio(args.destinatarioId, args.refugeId)) {
        return { enviado: false, motivo: 'silenciado_refugio', entregas: 0 }
      }
    }

    const ajustes = await puerto.ajustesDe(args.destinatarioId)
    const estado = await puerto.estadoDe(args.destinatarioId, args.tipo)

    // ── 3. Política pura, SIN consumir el techo todavía ───────────────────
    const prefs = sanitizarPrefs(ajustes.prefs)
    const base = {
      tipo: args.tipo,
      prefs,
      quietFrom: ajustes.quietFrom,
      quietTo: ajustes.quietTo,
      tzOffset: ajustes.tzOffset,
      ultimoDelTipoMs: estado.ultimoMs,
      ahora,
    }

    let decision = decidirEnvio({ ...base, enviadosHoy: 0 })

    // ── 4. Techo, solo si lo anterior dijo que sí y no es crisis ──────────
    if (decision.enviar && args.tipo !== TIPO_EXENTO) {
      const cabe = await puerto.consumirTecho(args.destinatarioId)
      if (!cabe) decision = decidirEnvio({ ...base, enviadosHoy: TECHO_DIARIO })
    }

    if (!decision.enviar) {
      // Lo que no se manda no se pierde: queda acumulado para salir agregado
      // («3 personas te escucharon») en cuanto se pueda.
      await puerto.acumular(args.destinatarioId, args.tipo, decision.diferidoHasta)
      return { enviado: false, motivo: decision.motivo, entregas: 0 }
    }

    // ── 5. El alias es decisión del EMISOR ────────────────────────────────
    // Nunca del receptor y nunca del cliente. Sin emisor (nivel_alcanzado) no
    // hay alias que revelar.
    const alias = args.emisorId ? await puerto.aliasSiRevela(args.emisorId) : null

    const suscripciones = await puerto.suscripcionesDe(args.destinatarioId)
    if (suscripciones.length === 0) {
      return { enviado: false, motivo: 'sin_dispositivos', entregas: 0 }
    }

    const carga = construirCarga({
      tipo: args.tipo,
      aliasEmisor: alias,
      // Lo acumulado desde el último aviso + este.
      agregados: estado.pendientes + 1,
      url: args.url,
    })

    const { enviadas } = await enviarAVarias(suscripciones, carga)
    await puerto.anotarEnviado(args.destinatarioId, args.tipo)

    return { enviado: enviadas > 0, motivo: null, entregas: enviadas }
  } catch {
    // Un aviso que falla no puede romper la acción que lo provocó.
    console.warn('[darma][b13] despacho fallido')
    return { enviado: false, motivo: 'apagado', entregas: 0 }
  }
}

/**
 * Avisa a quienes tienen guardada como Alma Afín a `usuarioId`.
 *
 * La consulta de destinatarios vive en Postgres (`destinatarios_alma_afin`,
 * migración 0131) porque ahí ya filtra por `blocks` y usa `idx_kindred_reverse`.
 * Aquí solo se recorre la lista.
 */
export async function avisarAlmasAfines(
  usuarioId: string,
  opciones: { url?: string; ahora?: Date } = {},
): Promise<{ destinatarios: number; enviados: number }> {
  if (!pushConfigurado()) return { destinatarios: 0, enviados: 0 }

  const destinatarios = await destinatariosAlmaAfin(usuarioId)
  let enviados = 0

  for (const destinatarioId of destinatarios) {
    const r = await avisar({
      destinatarioId,
      tipo: 'alma_afin_en_crisis',
      emisorId: usuarioId,
      url: opciones.url ?? '/refugios',
      ahora: opciones.ahora,
    })
    if (r.enviado) enviados++
  }

  return { destinatarios: destinatarios.length, enviados }
}

// ── Implementación real del puerto ──────────────────────────────────────────
// ⛔ Usa el cliente ADMIN, y es una excepción justificada de CONTRATOS §6: el
// aviso se despacha en nombre del SISTEMA hacia alguien que no está pidiendo
// nada (puede estar durmiendo). No hay `auth.uid()` con el que RLS pueda
// trabajar, y `push_dispatch_state` no tiene —ni debe tener— política alguna.

async function destinatariosAlmaAfin(usuarioId: string): Promise<string[]> {
  try {
    const { createAdminClient } = await import('../supabase/admin.ts')
    const { data, error } = await createAdminClient().rpc('destinatarios_alma_afin', {
      p_usuario: usuarioId,
    })
    if (error) throw new Error(error.code ?? 'rpc')
    const filas = (Array.isArray(data) ? data : []) as { owner_id: string }[]
    return filas.map((f) => f.owner_id)
  } catch {
    console.warn('[darma][b13] no se pudieron resolver los destinatarios')
    return []
  }
}

async function puertoPorDefecto(): Promise<PuertoDatosPush | null> {
  try {
    const { createAdminClient } = await import('../supabase/admin.ts')
    const admin = createAdminClient()

    return {
      async hayBloqueo(a, b) {
        const { data } = await admin.rpc('is_blocked_between', { p_a: a, p_b: b })
        // Ante la duda (RPC caída, migración sin aplicar) se asume BLOQUEO.
        // Fail-closed a propósito: el coste de equivocarse es un aviso perdido;
        // el de acertar al revés es una persona bloqueada haciendo vibrar el
        // teléfono de quien la bloqueó.
        return data !== false
      },

      async silenciadoEnRefugio(userId, refugeId) {
        const { data } = await admin
          .from('refuge_members')
          .select('muted')
          .eq('user_id', userId)
          .eq('refuge_id', refugeId)
          .maybeSingle()
        return data?.muted === true
      },

      async ajustesDe(userId) {
        const { data } = await admin
          .from('notification_prefs')
          .select('prefs, quiet_from, quiet_to, tz_offset')
          .eq('user_id', userId)
          .maybeSingle()
        return {
          // Sin fila: defaults. Nunca un error — que alguien no haya tocado sus
          // preferencias no puede impedirle recibir un aviso de crisis.
          prefs: data?.prefs ?? {},
          quietFrom: data?.quiet_from ?? null,
          quietTo: data?.quiet_to ?? null,
          tzOffset: data?.tz_offset ?? 0,
        }
      },

      async aliasSiRevela(emisorId) {
        const [{ data: ajustes }, { data: perfil }] = await Promise.all([
          admin.from('notification_prefs').select('prefs').eq('user_id', emisorId).maybeSingle(),
          admin.from('profiles').select('alias').eq('id', emisorId).maybeSingle(),
        ])
        // El default de `revelar_alias` es true, pero si no se puede leer el
        // perfil el alias se omite: «alguien» siempre es una respuesta segura.
        if (!revelaAlias(ajustes?.prefs ?? {})) return null
        return typeof perfil?.alias === 'string' ? perfil.alias : null
      },

      async suscripcionesDe(userId) {
        const { data } = await admin
          .from('push_subscriptions')
          .select('id, endpoint, p256dh, auth')
          .eq('user_id', userId)
        return (data ?? []) as Suscripcion[]
      },

      async estadoDe(userId, tipo) {
        const { data } = await admin
          .from('push_dispatch_state')
          .select('last_sent_at, pendientes')
          .eq('user_id', userId)
          .eq('tipo', tipo)
          .maybeSingle()
        return {
          ultimoMs: data?.last_sent_at ? Date.parse(data.last_sent_at) : null,
          pendientes: typeof data?.pendientes === 'number' ? data.pendientes : 0,
        }
      },

      async consumirTecho(userId) {
        const { data, error } = await admin.rpc('check_rate_limit', {
          p_key: `push:${userId}`,
          p_limit: TECHO_DIARIO,
          p_window_seconds: 86_400,
        })
        // Fail-CLOSED: si el contador no responde, no se manda. Es el lado
        // correcto en el que fallar para una política antiadicción — la
        // alternativa es una app que bombardea justo cuando algo va mal.
        if (error) return false
        return data === true
      },

      async anotarEnviado(userId, tipo) {
        await admin.from('push_dispatch_state').upsert(
          {
            user_id: userId,
            tipo,
            last_sent_at: new Date().toISOString(),
            pendientes: 0,
            diferido_hasta: null,
          },
          { onConflict: 'user_id,tipo' },
        )
      },

      async acumular(userId, tipo, diferidoHasta) {
        const { data } = await admin
          .from('push_dispatch_state')
          .select('pendientes')
          .eq('user_id', userId)
          .eq('tipo', tipo)
          .maybeSingle()

        await admin.from('push_dispatch_state').upsert(
          {
            user_id: userId,
            tipo,
            pendientes: (typeof data?.pendientes === 'number' ? data.pendientes : 0) + 1,
            diferido_hasta: diferidoHasta,
          },
          { onConflict: 'user_id,tipo' },
        )
      },
    }
  } catch {
    return null
  }
}
