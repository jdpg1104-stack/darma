// ============================================================================
// Comprobación REAL de dependencias
//
// UN /api/health QUE SIEMPRE DEVUELVE 200 ES PEOR QUE NO TENER ENDPOINT. El
// balanceador —o el uptime checker— lo interpreta como "este proceso puede
// atender tráfico" y le sigue mandando gente a un servidor que no puede hablar
// con la base de datos. El endpoint que miente no es neutral: prolonga la
// caída. De ahí que aquí se ejecute una consulta de verdad y que el resultado
// pueda ser 503.
//
// DOS NIVELES, POR COSTE:
//
//   · comprobarSuperficial() — lo que se sondea cada 30 s. Una sola consulta
//     barata con timeout de 2 s. Tiene que costar menos que el propio sondeo:
//     una comprobación de salud cara es una carga sostenida que se autoinflige,
//     y encima es la primera que se dispara cuando el sistema va justo,
//     generando falsas alarmas en cascada.
//
//   · comprobarProfundo() — lo que corre el cron cada hora, protegido por
//     CRON_SECRET. Aquí sí se paga: consulta real del feed, estado del
//     clasificador, cuadre del ledger de cristales y profundidad de la cola de
//     crisis.
//
// TIMEOUT ANTES QUE ESPERA. Una dependencia que tarda 30 s está caída a efectos
// prácticos, y esperarla convierte la comprobación en parte del incidente. El
// límite es de 2 s en superficial: por encima, `degradado`.
//
// INYECCIÓN DE SONDAS. Las funciones aceptan un objeto `Sondas` con valor por
// defecto, así que la firma pública sigue siendo la del contrato
// (`comprobarSuperficial(): Promise<Comprobacion[]>`) y a la vez se puede
// probar el camino de fallo —Postgres caído, Postgres lento— sin una base de
// datos delante.
// ============================================================================

import { conLimite, TiempoAgotadoError } from './traza.ts'
import { ponerSaturacion } from './metricas.ts'
import { PRESUPUESTOS } from './presupuestos.ts'

export type EstadoDependencia = 'ok' | 'degradado' | 'caido'

export interface Comprobacion {
  nombre: 'postgres' | 'auth' | 'ia' | 'ledger' | 'cola_crisis'
  estado: EstadoDependencia
  ms: number
  /** Interno, para el log. NUNCA se serializa al cliente (ver salud.ts). */
  detalle?: string
}

/** Límite de la comprobación barata. Ver "TIMEOUT ANTES QUE ESPERA". */
export const TIMEOUT_SUPERFICIAL_MS = 2000
/** El cron puede permitirse más: mide consultas reales del producto. */
export const TIMEOUT_PROFUNDO_MS = 5000

/**
 * Las operaciones concretas contra el mundo exterior. Se inyectan para poder
 * simular caída y lentitud en los tests.
 */
export interface Sondas {
  /** Consulta trivial contra Postgres/PostgREST. Lanza si no se puede. */
  ping(): Promise<void>
  /** Consulta REAL del feed (keyset sobre idx_posts_hot). */
  consultaFeed(): Promise<void>
  /** Estado del clasificador de riesgo/calidad. */
  clasificadorIa(): Promise<{ estado: EstadoDependencia; detalle: string }>
  /** Nº de perfiles cuyo `crystals` no cuadra con la suma de `crystal_ledger`. */
  descuadreLedger(): Promise<number>
  /** Nº de eventos de crisis de riesgo alto/crítico sin atender. */
  crisisSinAtender(): Promise<number>
}

function ahora(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now()
}

/**
 * Ejecuta una sonda y la traduce a `Comprobacion`.
 *
 * El error se convierte en `detalle` con su NOMBRE, nunca con su mensaje: el
 * mensaje de un driver de Postgres lleva host, puerto y a veces la cadena de
 * conexión entera (`ECONNREFUSED 10.0.0.4:5432`). Ese texto ni siquiera llega a
 * la respuesta (salud.ts lo descarta), pero aquí ya se recorta por si algún día
 * alguien serializa esto por error.
 */
async function medir(
  nombre: Comprobacion['nombre'],
  limiteMs: number,
  fn: () => Promise<Omit<Comprobacion, 'nombre' | 'ms'>>,
): Promise<Comprobacion> {
  const t0 = ahora()
  try {
    const r = await conLimite(nombre, limiteMs, fn)
    return { nombre, ms: Math.round(ahora() - t0), ...r }
  } catch (causa) {
    const ms = Math.round(ahora() - t0)
    if (causa instanceof TiempoAgotadoError) {
      // Timeout ≠ caída. Puede ser una tormenta de conexiones que se resuelve
      // sola, y sacar el proceso del balanceador por eso amplifica el problema
      // justo cuando el sistema está saturado. Se marca `degradado` y se deja
      // que la alerta de p95 lo escale si persiste.
      return { nombre, estado: 'degradado', ms, detalle: `timeout_${limiteMs}ms` }
    }
    return {
      nombre,
      estado: 'caido',
      ms,
      detalle: causa instanceof Error ? causa.name : 'error_desconocido',
    }
  }
}

// ── Sondas reales ───────────────────────────────────────────────────────────

/**
 * Cliente anónimo para el sondeo superficial.
 *
 * Se usa la ANON KEY y no la service_role a propósito: `/api/health` es público
 * y no debe existir ningún camino en el que una ruta pública construya el
 * cliente que salta RLS. `karma_weights` tiene lectura pública por diseño (ver
 * 0001_core.sql), así que un `select` sobre ella prueba de verdad la cadena
 * completa —red, PostgREST, Postgres, RLS— sin tocar ni un dato de nadie.
 */
async function clienteAnonimo() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('ConfiguracionAusente')
  const { createClient } = await import('@supabase/supabase-js')
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

async function clienteAdmin() {
  const { createAdminClient } = await import('../supabase/admin.ts')
  return createAdminClient()
}

export function sondasReales(): Sondas {
  return {
    async ping() {
      const sb = await clienteAnonimo()
      const { error } = await sb.from('karma_weights').select('kind').limit(1)
      if (error) throw new Error('ConsultaFallida')
    },

    async consultaFeed() {
      // La consulta canónica de CONTRATOS.md §5, sin cursor (página 1). Mide lo
      // que mide el usuario, no un `select 1` que siempre va rápido.
      const sb = await clienteAdmin()
      const { error } = await sb
        .from('posts')
        .select('id,author_id,kind,topic,upvote_count,reply_count,hot_score,created_at')
        .eq('state', 'active')
        .order('hot_score', { ascending: false })
        .order('id', { ascending: false })
        .limit(20)
      if (error) throw new Error('ConsultaFeedFallida')
    },

    async clasificadorIa() {
      // El sistema de moderación falla CERRADO (ver ARCHITECTURE.md §6): sin
      // clave, ningún comentario se valida y por tanto NADIE gana crédito de
      // reciprocidad. Eso no es "una integración apagada": es el bucle central
      // del producto detenido, y tiene que verse como degradación.
      if (!process.env.MODERATION_API_KEY) {
        return { estado: 'degradado' as const, detalle: 'sin_clave_apagado_a_proposito' }
      }
      const endpoint = process.env.MODERATION_HEALTH_URL
      if (!endpoint) {
        // No se inventa un "ok": se declara qué se ha comprobado exactamente
        // (que la clave existe) y qué no (que el proveedor responda).
        return { estado: 'ok' as const, detalle: 'clave_presente_sin_endpoint_de_sondeo' }
      }
      const r = await fetch(endpoint, { method: 'GET', signal: AbortSignal.timeout(3000) })
      return r.ok
        ? { estado: 'ok' as const, detalle: 'proveedor_responde' }
        : { estado: 'caido' as const, detalle: `proveedor_${r.status}` }
    },

    async descuadreLedger() {
      // Comparar `profiles.crystals` con `sum(crystal_ledger.delta)` es una
      // agregación sobre dos tablas grandes: no se puede hacer desde PostgREST
      // sin traerse el mundo, y hacerlo en la app sería el N+1 que este bloque
      // existe para evitar. Se delega en una función SQL (pendiente: ver
      // HANDOFF/PEDIDOS.md, petición de B14 a F2).
      //
      // Si la función no existe todavía, se LANZA. La alternativa —devolver 0—
      // sería reportar "la economía cuadra" sin haberla mirado, que es el tipo
      // de mentira que este bloque entero existe para no contar.
      const sb = await clienteAdmin()
      const { data, error } = await sb.rpc('auditar_cristales')
      if (error) throw new Error('RpcAuditarCristalesAusente')
      return typeof data === 'number' ? data : Number(data ?? 0)
    },

    async crisisSinAtender() {
      // Barata de verdad: idx_crisis_pending es un índice PARCIAL sobre
      // exactamente este predicado, así que su tamaño es el del backlog vivo y
      // no el del histórico (ver el comment on index en 0002_comunidad.sql).
      const sb = await clienteAdmin()
      const { count, error } = await sb
        .from('crisis_events')
        .select('id', { count: 'exact', head: true })
        .is('attended_at', null)
        .in('risk', ['high', 'critical'])
      if (error) throw new Error('ConsultaCrisisFallida')
      return count ?? 0
    },
  }
}

// ── Comprobaciones ──────────────────────────────────────────────────────────

/**
 * Comprobación barata (< 50 ms en el caso bueno). Una sola consulta.
 *
 * `auth` no hace ninguna llamada de red: comprueba que las variables de entorno
 * críticas existen. Un despliegue al que le falta `NEXT_PUBLIC_SUPABASE_ANON_KEY`
 * arranca perfectamente y falla en la primera pantalla del primer usuario; esta
 * comprobación lo convierte en un 503 inmediato, que es cuando todavía se puede
 * hacer rollback.
 */
export async function comprobarSuperficial(sondas: Sondas = sondasReales()): Promise<Comprobacion[]> {
  const postgres = await medir('postgres', TIMEOUT_SUPERFICIAL_MS, async () => {
    await sondas.ping()
    return { estado: 'ok' as const }
  })

  const faltan = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'].filter(
    (v) => !process.env[v],
  )
  const auth: Comprobacion = {
    nombre: 'auth',
    estado: faltan.length === 0 ? 'ok' : 'caido',
    ms: 0,
    // Nombres de VARIABLE, nunca valores. Saber que falta una variable no ayuda
    // a nadie a entrar; conocer su valor, sí.
    detalle: faltan.length === 0 ? undefined : `variables_ausentes:${faltan.join(',')}`,
  }

  return [postgres, auth]
}

/** Comprobación cara. Solo desde el cron, con CRON_SECRET. */
export async function comprobarProfundo(sondas: Sondas = sondasReales()): Promise<Comprobacion[]> {
  const superficial = await comprobarSuperficial(sondas)

  const feed = await medir('postgres', TIMEOUT_PROFUNDO_MS, async () => {
    await sondas.consultaFeed()
    return { estado: 'ok' as const, detalle: 'consulta_feed' }
  })

  const ia = await medir('ia', TIMEOUT_PROFUNDO_MS, async () => sondas.clasificadorIa())

  const ledger = await medir('ledger', TIMEOUT_PROFUNDO_MS, async () => {
    const descuadre = await sondas.descuadreLedger()
    ponerSaturacion('ledger_descuadre', descuadre)
    // Un descuadre NO tumba la app (nadie deja de poder escribir por eso), pero
    // significa que el caché de `profiles.crystals` y el libro no coinciden: es
    // dinero real mal contado y se mira hoy, no la semana que viene.
    return {
      estado: descuadre === 0 ? ('ok' as const) : ('degradado' as const),
      detalle: `descuadre:${descuadre}`,
    }
  })

  const colaCrisis = await medir('cola_crisis', TIMEOUT_PROFUNDO_MS, async () => {
    const pendientes = await sondas.crisisSinAtender()
    ponerSaturacion('crisis_sin_atender', pendientes)
    return {
      estado:
        pendientes > PRESUPUESTOS.crisis_sin_atender_max ? ('degradado' as const) : ('ok' as const),
      detalle: `pendientes:${pendientes}`,
    }
  })

  // El `postgres` del sondeo profundo (consulta real del feed) sustituye al
  // superficial: mide lo mismo, mejor.
  return [feed, ...superficial.filter((c) => c.nombre !== 'postgres'), ia, ledger, colaCrisis]
}
