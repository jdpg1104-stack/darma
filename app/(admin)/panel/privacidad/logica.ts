// ============================================================================
// /panel/privacidad · Lógica pura y consultas de la vista de solicitudes RGPD
//
// Existe por el pedido de B20 a B19 (HANDOFF/PEDIDOS.md, «privacy_requests»):
// sin esta vista no se puede DEMOSTRAR el cumplimiento del plazo de un mes del
// art. 12.3 RGPD. Los datos viven en `privacy_requests`, con RLS activada y
// CERO políticas: solo los lee `service_role`, y por eso todo entra por el
// cliente admin inyectado por parámetro (mismo patrón que `_lib/dashboard.ts`,
// probable con `node --test` sin red ni variables de entorno).
//
// ── QUÉ SIGNIFICA «VENCER» AQUÍ ────────────────────────────────────────────
// Cada estado tiene un reloj distinto, y confundirlos pinta falsas alarmas:
//
//   · `pending_confirm` y las exportaciones abiertas viven atadas a
//     `expires_at` (el TTL del token o del enlace de descarga, ≤ 7 días por
//     `crear_solicitud_privacidad`). Pasado ese momento la solicitud está
//     MUERTA, no incumplida: el servicio respondió; fue la persona quien no
//     siguió. Se clasifican como `caducada`, nunca como `vencida`.
//   · Un borrado `confirmed`/`processing` vence al terminar el arrepentimiento
//     (`confirmed_at` + 30 días — espejo EXACTO de `borrados_vencidos()` y de
//     `confirmar_borrado()` en 0201). El cron tiene un margen de ejecución de
//     `DIAS_MARGEN_EJECUCION` días; más allá, es un incumplimiento y se marca
//     `vencida`.
//   · El plazo del art. 12.3 (un mes CIVIL desde la solicitud, calculado como
//     manda el Reglamento 1182/71: mismo día del mes siguiente, o el último
//     día si no existe) se usa como prueba HISTÓRICA: cada exportación
//     ejecutada declara si se completó dentro del mes. Para los borrados el
//     mes no aplica tal cual —los 30 días de arrepentimiento los pide la
//     propia persona— y medirlos contra el mes marcaría vencido cada borrado
//     bien hecho.
//
// ── ANONIMATO (CONTRATOS §2) ───────────────────────────────────────────────
// De `privacy_requests` NO se selecciona `user_id` (sería publicar quién está
// a punto de irse), ni `token_sha256`, ni `error` (texto libre escrito por el
// ejecutor: podría arrastrar detalle que no debe pintarse en una pantalla).
// Solo ids de solicitud, tipo, estado y marcas de tiempo. Los conteos se
// muestran EXACTOS y sin `enmascarar()`: son eventos operativos cuyo número
// exacto es justo lo que el art. 12.3 obliga a poder demostrar, y la propia
// pantalla lista cada fila — enmascarar el total sería teatro.
//
// ── CONSULTAS E ÍNDICES ────────────────────────────────────────────────────
// TRES consultas por render (presupuesto de CONTRATOS §11). Índices de 0201:
//   · `idx_privacy_requests_pendientes (requested_at) where state in
//     ('confirmed','processing')` cubre el grueso de `leerAbiertas`, pero NO
//     `pending_confirm`, ni el filtro de `leerFallidas`, ni el orden del
//     historial. Los índices que faltan están ANOTADOS EN PEDIDOS, no creados
//     aquí (la migración es de quien opera el esquema). Mientras tanto las
//     consultas son correctas y la tabla es pequeña por naturaleza: una fila
//     por solicitud de privacidad, no por post ni por comentario — por eso el
//     `count: 'exact'` del historial no es la agregación en vivo que
//     `_lib/dashboard.ts` prohíbe sobre las tablas grandes.
//
// ── EL COPY VIVE EN EL CATÁLOGO, NO AQUÍ ───────────────────────────────────
// Todo el texto de la pantalla está en `messages/{es,en}.json` bajo
// `admin.privacidad.*`. Este módulo sigue siendo PURO y sin traductor: las
// `CLAVE_*` mapean cada valor del esquema (`kind`, `state`, urgencia) a la
// CLAVE de su etiqueta, y la página la resuelve con `t()`. Así las pruebas de
// clasificación siguen comprobando la DECISIÓN (qué vence y cuándo) y no la
// redacción, que es lo que puede cambiar de idioma.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

// ── Contrato público ────────────────────────────────────────────────────────

export type TipoSolicitud = 'export' | 'erase'

export type EstadoSolicitud =
  | 'pending_confirm'
  | 'confirmed'
  | 'processing'
  | 'done'
  | 'failed'
  | 'cancelled'

/**
 * Forma cruda de la fila, declarada a mano mientras B15 no regenere
 * `lib/supabase/database.types.ts` con las tablas de 0201 (anotado en
 * PEDIDOS.md; mismo criterio que `lib/privacy/exportar.ts`). Sin `user_id`,
 * sin `token_sha256` y sin `error` A PROPÓSITO — ver la cabecera.
 */
export interface FilaSolicitud {
  id: string
  kind: TipoSolicitud
  state: EstadoSolicitud
  requested_at: string
  confirmed_at: string | null
  completed_at: string | null
  expires_at: string
}

export type Urgencia = 'vencida' | 'vence_pronto' | 'en_plazo' | 'caducada'

/** Una solicitud ya derivada para pintar: la página no calcula nada. */
export interface SolicitudVista {
  id: string
  kind: TipoSolicitud
  state: EstadoSolicitud
  solicitadaEn: string
  edadSegundos: number
  venceEn: string | null
  urgencia: Urgencia | null
  /** Solo para `done`: ¿se completó dentro de su plazo? `null` si no aplica. */
  cumplioPlazo: boolean | null
}

// ── Constantes ──────────────────────────────────────────────────────────────

/** Espejo del `interval '30 days'` de `confirmar_borrado()` y
 *  `borrados_vencidos()` en 0201. Si allí cambia, aquí también. */
export const DIAS_ARREPENTIMIENTO = 30

/** Margen del cron tras el fin del arrepentimiento. Un borrado ejecutado hasta
 *  aquí sigue siendo «sin dilación indebida»; más allá, no. */
export const DIAS_MARGEN_EJECUCION = 7

/** Cuántos días antes del vencimiento la solicitud sube marcada al principio. */
export const DIAS_AVISO_VENCIMIENTO = 7

/** Mismo criterio que `TOPE_COLA_CRISIS`: si hay más de 500 solicitudes
 *  abiertas, el propio desborde es el incidente, no la página que falta. */
export const TOPE_ABIERTAS = 500

export const LIMITE_PAGINA_HISTORIAL = 25

const MS_POR_DIA = 86_400_000

// ── Fechas ──────────────────────────────────────────────────────────────────

function aFecha(iso: string): Date {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) throw new Error('fecha inválida')
  return d
}

/** ISO de `iso` + `dias` días exactos (en milisegundos, sin meses civiles). */
export function sumarDias(iso: string, dias: number): string {
  return new Date(aFecha(iso).getTime() + dias * MS_POR_DIA).toISOString()
}

/**
 * Fin del plazo del art. 12.3: un MES CIVIL desde la solicitud, en UTC.
 *
 * «Un mes» no son 30 días: del 1 de febrero es el 1 de marzo (28 días) y del
 * 15 de enero el 15 de febrero (31). Cuando el día no existe en el mes
 * siguiente (31 de enero → ¿31 de febrero?) se recorta al último día real,
 * como fija el Reglamento 1182/71 — que es recortar hacia ANTES, la dirección
 * conservadora para una fecha límite.
 */
export function plazoArt123(solicitadaEn: string): string {
  const d = aFecha(solicitadaEn)
  const anio = d.getUTCFullYear()
  const mes = d.getUTCMonth()
  // Día 0 del mes m+2 = último día del mes m+1. `Date.UTC` desborda de año solo.
  const ultimoDiaMesSiguiente = new Date(Date.UTC(anio, mes + 2, 0)).getUTCDate()
  return new Date(
    Date.UTC(
      anio,
      mes + 1,
      Math.min(d.getUTCDate(), ultimoDiaMesSiguiente),
      d.getUTCHours(),
      d.getUTCMinutes(),
      d.getUTCSeconds(),
      d.getUTCMilliseconds(),
    ),
  ).toISOString()
}

// ── El reloj de cada solicitud ──────────────────────────────────────────────

/** Cuándo vence (o caduca) una solicitud. `null` para los estados terminales. */
export function venceEn(
  fila: Pick<FilaSolicitud, 'kind' | 'state' | 'requested_at' | 'confirmed_at' | 'expires_at'>,
): string | null {
  switch (fila.state) {
    case 'pending_confirm':
      // El TTL del token de confirmación. Pasado, la solicitud muere sola.
      return fila.expires_at
    case 'confirmed':
    case 'processing':
      if (fila.kind === 'erase') {
        // Fin del arrepentimiento. `confirmed_at` nulo no debería pasar (la
        // transición lo escribe), pero si pasa, la cota honesta es la solicitud.
        return sumarDias(fila.confirmed_at ?? fila.requested_at, DIAS_ARREPENTIMIENTO)
      }
      // Exportación lista: vive hasta que caduque el enlace de descarga.
      return fila.expires_at
    default:
      return null
  }
}

/**
 * Clasifica la solicitud frente a su reloj.
 *
 *   · `vencida` / `vence_pronto` — SOLO borrados por ejecutar: es la única
 *     situación en la que el sistema (no la persona) tiene un deber pendiente.
 *   · `caducada` — el token o el enlace expiró sin que la persona actuara.
 *     Madera muerta, no incumplimiento.
 *   · `null` — estados terminales; el historial usa `cumplioPlazo`.
 */
export function urgenciaDe(
  fila: Pick<FilaSolicitud, 'kind' | 'state' | 'requested_at' | 'confirmed_at' | 'expires_at'>,
  ahora: Date,
): Urgencia | null {
  const vence = venceEn(fila)
  if (vence === null) return null

  const t = ahora.getTime()
  const v = aFecha(vence).getTime()

  const borradoPorEjecutar =
    fila.kind === 'erase' && (fila.state === 'confirmed' || fila.state === 'processing')

  if (!borradoPorEjecutar) {
    return t > v ? 'caducada' : 'en_plazo'
  }

  if (t > v + DIAS_MARGEN_EJECUCION * MS_POR_DIA) return 'vencida'
  if (t > v - DIAS_AVISO_VENCIMIENTO * MS_POR_DIA) return 'vence_pronto'
  return 'en_plazo'
}

/**
 * Para una solicitud `done`: ¿se completó dentro de su plazo? Es la prueba
 * histórica del cumplimiento — cada fila del historial responde por sí misma.
 *
 *   · Exportación: contra el mes civil del art. 12.3.
 *   · Borrado: contra fin del arrepentimiento + margen de ejecución.
 *   · `cancelled`, `failed` y las abiertas: `null` (no hay plazo que juzgar;
 *     una fallida es un incidente sea cual sea su edad, y tiene su sección).
 */
export function cumplioPlazo(
  fila: Pick<FilaSolicitud, 'kind' | 'state' | 'requested_at' | 'confirmed_at' | 'completed_at'>,
): boolean | null {
  if (fila.state !== 'done' || fila.completed_at === null) return null
  const fin = aFecha(fila.completed_at).getTime()
  if (fila.kind === 'export') {
    return fin <= aFecha(plazoArt123(fila.requested_at)).getTime()
  }
  const limite = sumarDias(
    fila.confirmed_at ?? fila.requested_at,
    DIAS_ARREPENTIMIENTO + DIAS_MARGEN_EJECUCION,
  )
  return fin <= aFecha(limite).getTime()
}

/** Segundos desde la solicitud. Nunca negativo: un reloj adelantado no puede
 *  pintar una edad imposible. */
export function edadSegundos(solicitadaEn: string, ahora: Date): number {
  return Math.max(0, Math.round((ahora.getTime() - aFecha(solicitadaEn).getTime()) / 1000))
}

export function aVista(fila: FilaSolicitud, ahora: Date): SolicitudVista {
  return {
    id: fila.id,
    kind: fila.kind,
    state: fila.state,
    solicitadaEn: fila.requested_at,
    edadSegundos: edadSegundos(fila.requested_at, ahora),
    venceEn: venceEn(fila),
    urgencia: urgenciaDe(fila, ahora),
    cumplioPlazo: cumplioPlazo(fila),
  }
}

// ── Preparación de las abiertas ─────────────────────────────────────────────

export interface AbiertasPreparadas {
  /** Vencidas primero, luego las que vencen pronto; dentro, la más urgente
   *  antes. Van ARRIBA y marcadas: es el pedido literal de B20. */
  urgentes: SolicitudVista[]
  enPlazo: SolicitudVista[]
  caducadas: SolicitudVista[]
}

export function prepararAbiertas(
  filas: readonly FilaSolicitud[],
  ahora: Date,
): AbiertasPreparadas {
  const vistas = filas.map((f) => aVista(f, ahora))

  const urgentes = vistas.filter(
    (v) => v.urgencia === 'vencida' || v.urgencia === 'vence_pronto',
  )
  // Se reordena EN MEMORIA sobre como mucho TOPE_ABIERTAS filas — el tope es lo
  // que hace honesto este sort. Por época y no por texto: `expires_at` llega de
  // PostgREST con `+00:00` y `sumarDias` devuelve `Z`; compararlos como cadenas
  // ordenaría mal.
  urgentes.sort((a, b) => {
    if (a.urgencia !== b.urgencia) return a.urgencia === 'vencida' ? -1 : 1
    return new Date(a.venceEn ?? 0).getTime() - new Date(b.venceEn ?? 0).getTime()
  })

  return {
    urgentes,
    enPlazo: vistas.filter((v) => v.urgencia === 'en_plazo'),
    caducadas: vistas.filter((v) => v.urgencia === 'caducada'),
  }
}

export interface ResumenAbiertas {
  total: number
  /** `pending_confirm` con el token aún vivo. */
  pendientesConfirmar: number
  /** `confirmed` no caducadas: borrados en arrepentimiento y exportaciones listas. */
  confirmadas: number
  enEjecucion: number
  vencidas: number
  vencenPronto: number
  caducadas: number
}

export function resumirAbiertas(
  filas: readonly FilaSolicitud[],
  ahora: Date,
): ResumenAbiertas {
  const resumen: ResumenAbiertas = {
    total: filas.length,
    pendientesConfirmar: 0,
    confirmadas: 0,
    enEjecucion: 0,
    vencidas: 0,
    vencenPronto: 0,
    caducadas: 0,
  }

  for (const fila of filas) {
    const urgencia = urgenciaDe(fila, ahora)
    if (urgencia === 'vencida') resumen.vencidas += 1
    if (urgencia === 'vence_pronto') resumen.vencenPronto += 1
    if (urgencia === 'caducada') {
      // Caducada NO cuenta además como pendiente/confirmada: sumaría dos veces
      // la misma fila y el total del encabezado dejaría de cuadrar con la vista.
      resumen.caducadas += 1
      continue
    }
    if (fila.state === 'pending_confirm') resumen.pendientesConfirmar += 1
    if (fila.state === 'confirmed') resumen.confirmadas += 1
    if (fila.state === 'processing') resumen.enEjecucion += 1
  }

  return resumen
}

// ── Cursor del historial (keyset, CONTRATOS §5: nunca OFFSET) ───────────────

export interface CursorHistorial {
  /** `requested_at` de la última fila vista. */
  t: string
  /** Desempate por id: dos solicitudes con el mismo instante no pueden
   *  repetirse ni perderse entre páginas. */
  id: string
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Charset CERRADO a propósito: lo que pase esta validación se interpola en un
// filtro `or()` de PostgREST, cuya gramática usa comas y paréntesis. Sin esta
// regex, un cursor manipulado reescribiría el filtro de la consulta.
const RE_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/

export function codificarCursor(fila: Pick<FilaSolicitud, 'requested_at' | 'id'>): string {
  // `_` no aparece ni en un ISO-8601 ni en un uuid: el corte es inequívoco.
  return `${fila.requested_at}_${fila.id}`
}

/** Un cursor que no valide EXACTO se ignora y se sirve la primera página: un
 *  enlace viejo o manipulado no es un error de pantalla ni una vía de entrada. */
export function parsearCursor(crudo: unknown): CursorHistorial | null {
  if (typeof crudo !== 'string' || crudo.length === 0 || crudo.length > 80) return null
  const partes = crudo.split('_')
  if (partes.length !== 2) return null
  const [t, id] = partes
  if (!RE_TIMESTAMP.test(t) || Number.isNaN(new Date(t).getTime())) return null
  if (!RE_UUID.test(id)) return null
  return { t, id }
}

// ── Acceso a la base (cliente inyectado; TRES consultas por render) ─────────

const CAMPOS_SOLICITUD = 'id, kind, state, requested_at, confirmed_at, completed_at, expires_at'

const ESTADOS_ABIERTOS: readonly EstadoSolicitud[] = ['pending_confirm', 'confirmed', 'processing']
const ESTADOS_CERRADOS: readonly EstadoSolicitud[] = ['done', 'cancelled']

export interface LoteSolicitudes {
  filas: FilaSolicitud[]
  /** Había más de `TOPE_ABIERTAS`: la página lo dice en vez de fingir que no. */
  desbordadas: boolean
}

/**
 * Todas las solicitudes ABIERTAS, de más vieja a más nueva, con tope.
 *
 * `idx_privacy_requests_pendientes` cubre `confirmed`/`processing` pero no
 * `pending_confirm` (índice pedido en PEDIDOS). Sin `count(*)`: el tope + 1
 * dice si hay desborde, igual que `leerColaCrisisViva`.
 */
export async function leerAbiertas(admin: SupabaseClient): Promise<LoteSolicitudes> {
  const { data, error } = await admin
    .from('privacy_requests')
    .select(CAMPOS_SOLICITUD)
    .in('state', [...ESTADOS_ABIERTOS])
    .order('requested_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(TOPE_ABIERTAS + 1)

  if (error) throw new Error(`privacidad_abiertas: ${error.code ?? 'error'}`)

  const filas = (data ?? []) as FilaSolicitud[]
  return { filas: filas.slice(0, TOPE_ABIERTAS), desbordadas: filas.length > TOPE_ABIERTAS }
}

/**
 * Las FALLIDAS, la cifra que el pedido de B20 nombra explícitamente. Deberían
 * ser cero; cada una es un incidente abierto sea cual sea su edad. (Índice
 * parcial pedido en PEDIDOS; hoy el filtro recorre una tabla pequeña.)
 */
export async function leerFallidas(admin: SupabaseClient): Promise<LoteSolicitudes> {
  const { data, error } = await admin
    .from('privacy_requests')
    .select(CAMPOS_SOLICITUD)
    .eq('state', 'failed')
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(TOPE_ABIERTAS + 1)

  if (error) throw new Error(`privacidad_fallidas: ${error.code ?? 'error'}`)

  const filas = (data ?? []) as FilaSolicitud[]
  return { filas: filas.slice(0, TOPE_ABIERTAS), desbordadas: filas.length > TOPE_ABIERTAS }
}

export interface PaginaHistorial {
  filas: FilaSolicitud[]
  hayMas: boolean
  /** Para el enlace «más antiguas». `null` en la última página. */
  siguienteCursor: string | null
  /** Cerradas desde el corte del cursor hacia atrás. En la primera página, el
   *  total de ejecutadas + canceladas. */
  totalDesdeCursor: number
}

/**
 * Historial de cerradas (`done` + `cancelled`; las fallidas tienen su sección),
 * de más nueva a más vieja, por keyset sobre `(requested_at, id)` — nunca
 * OFFSET (CONTRATOS §5). Las fallas de índice están anotadas en PEDIDOS.
 */
export async function leerHistorial(
  admin: SupabaseClient,
  cursor: CursorHistorial | null,
): Promise<PaginaHistorial> {
  let consulta = admin
    .from('privacy_requests')
    .select(CAMPOS_SOLICITUD, { count: 'exact' })
    .in('state', [...ESTADOS_CERRADOS])
    .order('requested_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIMITE_PAGINA_HISTORIAL + 1)

  if (cursor) {
    // Ambos valores pasaron el charset cerrado de `parsearCursor`: aquí no
    // puede entrar gramática de PostgREST.
    consulta = consulta.or(
      `requested_at.lt.${cursor.t},and(requested_at.eq.${cursor.t},id.lt.${cursor.id})`,
    )
  }

  const { data, error, count } = await consulta
  if (error) throw new Error(`privacidad_historial: ${error.code ?? 'error'}`)

  const filas = (data ?? []) as FilaSolicitud[]
  const hayMas = filas.length > LIMITE_PAGINA_HISTORIAL
  const visibles = hayMas ? filas.slice(0, LIMITE_PAGINA_HISTORIAL) : filas

  return {
    filas: visibles,
    hayMas,
    siguienteCursor: hayMas ? codificarCursor(visibles[visibles.length - 1]) : null,
    totalDesdeCursor: count ?? 0,
  }
}

// ── Claves del copy (el texto vive en el catálogo; ver la cabecera) ─────────

export const CLAVE_TIPO: Readonly<Record<TipoSolicitud, string>> = {
  export: 'admin.privacidad.tipoExport',
  erase: 'admin.privacidad.tipoErase',
}

export const CLAVE_ESTADO: Readonly<Record<EstadoSolicitud, string>> = {
  pending_confirm: 'admin.privacidad.estadoPendienteConfirmar',
  confirmed: 'admin.privacidad.estadoConfirmada',
  processing: 'admin.privacidad.estadoEnEjecucion',
  done: 'admin.privacidad.estadoEjecutada',
  failed: 'admin.privacidad.estadoFallida',
  cancelled: 'admin.privacidad.estadoCancelada',
}

export const CLAVE_URGENCIA: Readonly<Record<Urgencia, string>> = {
  vencida: 'admin.privacidad.urgenciaVencida',
  vence_pronto: 'admin.privacidad.urgenciaVencePronto',
  en_plazo: 'admin.privacidad.urgenciaEnPlazo',
  caducada: 'admin.privacidad.urgenciaCaducada',
}

