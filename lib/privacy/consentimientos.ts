// ============================================================================
// Consentimientos versionados.
//
// ── LA REGLA QUE JUSTIFICA TODO EL MÓDULO ──────────────────────────────────
// El consentimiento lo registra el SERVIDOR después de haber servido el texto,
// no el cliente afirmando que aceptó. La diferencia no es formal: si el cliente
// pudiera insertar la fila, podría declarar que aceptó una versión que nunca se
// le mostró, y el art. 7.1 del RGPD —«el responsable deberá ser capaz de
// demostrar que el interesado consintió»— dejaría de cumplirse justo en el
// único sitio donde se puede comprobar.
//
// Por eso `consents` no tiene ni un `grant insert (…)` para `authenticated`
// (migración 0201) y todo pasa por `registrar_consentimiento()`, concedida solo
// a `service_role`. El cliente afirma que PULSÓ; el servidor registra qué texto
// exacto tenía delante.
// ============================================================================

import type { SupabaseClient } from '@supabase/supabase-js'

import { DOCUMENTOS_LEGALES, type TipoDocumentoLegal } from './textos.ts'

export type TipoConsentimiento =
  | 'terminos'
  | 'privacidad'
  | 'no_es_terapia'
  | 'edad_minima'
  | 'datos_agregados'

export interface Consentimiento {
  tipo: TipoConsentimiento
  version: string
  /** ISO-8601 */
  aceptadoEn: string
  /** ISO-8601 o null si sigue vigente. */
  revocadoEn: string | null
}

/**
 * Documento legal que respalda cada tipo de consentimiento.
 *
 * `edad_minima` y `datos_agregados` no tienen documento propio: se apoyan en
 * `menores` y en `privacidad`, que son los textos donde de verdad se explica
 * qué se está consintiendo. Sin este mapa habría que inventar una versión para
 * ellos, y una versión que no corresponde a ningún texto no se puede auditar.
 */
const DOCUMENTO_DE: Readonly<Record<TipoConsentimiento, TipoDocumentoLegal>> = {
  terminos: 'terminos',
  privacidad: 'privacidad',
  no_es_terapia: 'no_es_terapia',
  edad_minima: 'menores',
  datos_agregados: 'privacidad',
}

/** Los que hay que tener aceptados para poder usar Darma. */
export const CONSENTIMIENTOS_OBLIGATORIOS: readonly TipoConsentimiento[] = [
  'terminos',
  'privacidad',
  'no_es_terapia',
  'edad_minima',
]

/** Versión vigente de un tipo de consentimiento. */
export function versionVigente(tipo: TipoConsentimiento): string {
  return DOCUMENTOS_LEGALES[DOCUMENTO_DE[tipo]].version
}

/** Huella declarada del texto vigente. */
export function huellaVigente(tipo: TipoConsentimiento): string {
  return DOCUMENTOS_LEGALES[DOCUMENTO_DE[tipo]].sha256
}

/**
 * ¿La versión que la persona aceptó cubre el uso actual?
 *
 * Comparación EXACTA y no «mayor o igual», a propósito. Un orden sobre las
 * versiones tentaría a decir «aceptó la v2, la vigente es la v3, casi»: y el
 * cambio de la v3 puede ser precisamente el que introduce un tratamiento nuevo.
 * Si el texto cambió, hay que volver a preguntar. `null` (nunca aceptó) es
 * false por la misma razón.
 */
export function cubreVersionActual(tipo: TipoConsentimiento, version: string | null): boolean {
  if (version === null) return false
  return version === versionVigente(tipo)
}

/** Fila cruda de `consents`. Se declara a mano mientras B15 no regenere
 *  `lib/supabase/database.types.ts` con las tablas de 0201 (ver PEDIDOS.md). */
interface FilaConsentimiento {
  kind: string
  version: string
  accepted_at: string
  revoked_at: string | null
}

const TIPOS_VALIDOS: readonly string[] = [
  'terminos',
  'privacidad',
  'no_es_terapia',
  'edad_minima',
  'datos_agregados',
]

function esTipoConsentimiento(valor: string): valor is TipoConsentimiento {
  return TIPOS_VALIDOS.includes(valor)
}

/**
 * Consentimientos vigentes (no revocados) de una persona.
 *
 * Recibe el cliente por parámetro y no lo importa: así el módulo se puede
 * probar con `node --test` sin arrastrar `next/headers`. Sirve tanto el cliente
 * RLS —la política `consents_read_own` ya filtra por `auth.uid()`— como el
 * admin en las rutas que ya lo tienen en la mano.
 */
export async function leerConsentimientos(
  supabase: SupabaseClient,
  userId: string,
): Promise<Consentimiento[]> {
  const { data, error } = await supabase
    .from('consents')
    .select('kind, version, accepted_at, revoked_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .order('accepted_at', { ascending: false })
    .limit(100)

  if (error) throw new Error(error.message)

  const filas = (data ?? []) as FilaConsentimiento[]
  return filas
    .filter((f) => esTipoConsentimiento(f.kind))
    .map((f) => ({
      tipo: f.kind as TipoConsentimiento,
      version: f.version,
      aceptadoEn: f.accepted_at,
      revocadoEn: f.revoked_at,
    }))
}

/**
 * Registra el consentimiento del tipo indicado, en su versión vigente y con la
 * huella del texto vigente.
 *
 * No acepta ni versión ni huella por parámetro: si quien llama pudiera
 * elegirlas, una ruta podría registrar «aceptó la v1» mientras la app sirve la
 * v2, y el registro dejaría de significar nada. La única fuente es `textos.ts`.
 *
 * ⚠️ Exige el cliente ADMIN: `registrar_consentimiento()` está concedida solo a
 * `service_role`.
 */
export async function anotarConsentimiento(
  supabase: SupabaseClient,
  userId: string,
  tipo: TipoConsentimiento,
): Promise<void> {
  const { error } = await supabase.rpc('registrar_consentimiento', {
    p_user: userId,
    p_kind: tipo,
    p_version: versionVigente(tipo),
    p_sha256: huellaVigente(tipo),
  })

  if (error) throw new Error(error.message)
}

// ── Las dos firmas literales del contrato de la ficha (B20 §Contrato) ──────
// Las de arriba reciben el cliente para poder probarse sin base de datos; estas
// dos son las que consumen los demás bloques y construyen el cliente admin por
// su cuenta. El import es DIFERIDO a propósito: `lib/supabase/admin.ts` lee
// SUPABASE_SERVICE_ROLE_KEY, y con el import estático cualquier módulo que
// importara `TipoConsentimiento` arrastraría ese archivo al grafo.

/** Contrato de la ficha. Usa `service_role`: solo desde el servidor. */
export async function consentimientosVigentes(userId: string): Promise<Consentimiento[]> {
  const { createAdminClient } = await import('../supabase/admin.ts')
  return leerConsentimientos(createAdminClient(), userId)
}

/** Contrato de la ficha. Usa `service_role`: solo desde el servidor. */
export async function registrarConsentimiento(
  userId: string,
  tipo: TipoConsentimiento,
): Promise<void> {
  const { createAdminClient } = await import('../supabase/admin.ts')
  return anotarConsentimiento(createAdminClient(), userId, tipo)
}

/** Qué le falta por aceptar a esta persona. Vacío = todo al día. */
export function consentimientosPendientes(
  vigentes: readonly Consentimiento[],
): TipoConsentimiento[] {
  return CONSENTIMIENTOS_OBLIGATORIOS.filter((tipo) => {
    const aceptado = vigentes.find((c) => c.tipo === tipo)
    return !cubreVersionActual(tipo, aceptado?.version ?? null)
  })
}
