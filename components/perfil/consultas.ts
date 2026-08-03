// ============================================================================
// Acceso a datos de B05. SOLO SERVIDOR.
//
// ── CERO CLIENTE ADMIN EN TODO EL BLOQUE ───────────────────────────────────
// Todo pasa por `lib/supabase/server.ts`, que lleva la anon key y se presenta
// ante Postgres como el usuario de la cookie: RLS y los privilegios de columna
// se aplican igual que si la petición viniera del navegador. Si algo no se
// puede leer desde aquí, es que no se debe leer, y la respuesta correcta es
// cambiar el esquema en una migración —a la vista— y no saltárselo con
// `service_role` en una ruta que nadie vuelve a mirar.
//
// ── EL PRESUPUESTO DE CONSULTAS, Y POR QUÉ SUBIÓ A CUATRO ──────────────────
// La ficha pedía 3 para el perfil propio. Son 4, y la cuarta no es un descuido:
//
//   1. `profiles` por PK  → las columnas PÚBLICAS (alias, avatar, nivel…).
//   2. `mi_perfil_privado()` → saldos y contadores. OBLIGATORIAMENTE una RPC:
//      `authenticated` no tiene privilegio de SELECT sobre esas columnas ni
//      sobre su propia fila (`42501`, comprobado contra Postgres).
//   3. `mi_resumen_karma()`  → racha + tope diario + desglose de 30 días. Ya
//      viene fusionada: por separado serían tres.
//   4. primera página del ledger (`idx_karma_events_user_keyset`).
//
// Es decir: la consulta "de más" es la que el endurecimiento del esquema partió
// en dos. Insignias y progreso de nivel siguen siendo funciones puras sobre
// datos ya cargados: cero consultas. El perfil AJENO sigue siendo UNA.
// ============================================================================

import { createClient } from '@/lib/supabase/server'
import { ErrorApi } from '@/lib/auth/errores'
import { codificarCursor } from './cursor.ts'
import { argumentosHistorial, type ParametrosHistorial } from './argumentos.ts'
import {
  eventoKarmaDesdeFila,
  fechaHoyISO,
  perfilAjenoDesdeFila,
  perfilPublicoDesdeFila,
  resumenDesdeFila,
  vecesMeAyudo,
} from './proyecciones.ts'
import { calcularInsignias } from './insignias.ts'
import type {
  EventoKarma,
  FilaEventoKarma,
  FilaPerfilPrivada,
  FilaPerfilPublica,
  FilaResumenKarma,
  PaginaCursor,
  PerfilAjeno,
  PerfilPropio,
  ResumenKarma,
} from './tipos.ts'

/**
 * Las columnas que `authenticated` PUEDE leer de `profiles`.
 *
 * Es literalmente el `grant select (...)` de 0001. Pedir una columna de más no
 * devuelve esa columna vacía: devuelve `42501 permission denied for table
 * profiles` y la consulta ENTERA falla. Por eso está en una constante y no
 * escrita a mano en cada `.select()`.
 */
export const COLUMNAS_PERFIL_PUBLICO =
  'id,alias,avatar_seed,bio,karma_reputation,level,availability,created_at,last_seen_at'

/** `returns table(...)` llega como array; una RPC escalar, como objeto. */
function primeraFila<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
  return (data as T | null) ?? null
}

// ── Perfil ajeno · UNA consulta ─────────────────────────────────────────────

/**
 * Perfil de otra persona, o `null` si no existe (o si RLS no lo devuelve, que
 * para quien mira es lo mismo y debe serlo: distinguir "no existe" de "no
 * puedes verlo" es un oráculo de existencia de cuentas).
 */
export async function leerPerfilAjeno(id: string): Promise<PerfilAjeno | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select(COLUMNAS_PERFIL_PUBLICO)
    .eq('id', id)
    .maybeSingle()

  if (error) throw new ErrorApi('error_interno', { causa: error })
  if (!data) return null

  return perfilAjenoDesdeFila(data as unknown as FilaPerfilPublica)
}

/**
 * Lo que necesita la pantalla de edición: los cuatro campos editables, y nada
 * más. UNA consulta a las columnas públicas por PK.
 *
 * No reutiliza `leerPerfilAjeno` porque ese descarta la `bio` a propósito
 * (`PerfilAjeno` no la declara). Aquí la bio ES imprescindible: sin ella el
 * `<textarea>` nace vacío y el primer "Guardar" le borra la biografía a la
 * persona sin que haya tocado ese campo.
 */
export async function leerPerfilEditable(
  userId: string,
): Promise<{ perfil: ReturnType<typeof perfilPublicoDesdeFila>; bio: string | null } | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select(COLUMNAS_PERFIL_PUBLICO)
    .eq('id', userId)
    .maybeSingle()

  if (error) throw new ErrorApi('error_interno', { causa: error })
  if (!data) return null

  const fila = data as unknown as FilaPerfilPublica
  return { perfil: perfilPublicoDesdeFila(fila), bio: fila.bio }
}

// ── Perfil propio ───────────────────────────────────────────────────────────

/** Resumen del karma propio. Una RPC. */
export async function leerResumen(): Promise<ResumenKarma> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('mi_resumen_karma')
  if (error) throw new ErrorApi('error_interno', { causa: error })

  const fila = primeraFila<FilaResumenKarma>(data)
  // Cero filas = hay sesión pero no hay perfil (falta el onboarding). No es un
  // fallo del servidor: es un estado legítimo del usuario.
  if (!fila) throw new ErrorApi('sin_permiso')

  return resumenDesdeFila(fila, fechaHoyISO())
}

/**
 * Perfil propio completo: 3 consultas aquí (pública + privada + resumen) y la
 * primera página del ledger la pide la pantalla aparte, porque el historial
 * también se recarga solo al pulsar "cargar más".
 */
export async function leerPerfilPropio(userId: string): Promise<PerfilPropio> {
  const supabase = await createClient()

  const [publica, privada, resumen] = await Promise.all([
    supabase.from('profiles').select(COLUMNAS_PERFIL_PUBLICO).eq('id', userId).maybeSingle(),
    supabase.rpc('mi_perfil_privado'),
    supabase.rpc('mi_resumen_karma'),
  ])

  if (publica.error) throw new ErrorApi('error_interno', { causa: publica.error })
  if (privada.error) throw new ErrorApi('error_interno', { causa: privada.error })
  if (resumen.error) throw new ErrorApi('error_interno', { causa: resumen.error })

  const filaPublica = publica.data as unknown as FilaPerfilPublica | null
  const filaPrivada = primeraFila<FilaPerfilPrivada>(privada.data)
  const filaResumen = primeraFila<FilaResumenKarma>(resumen.data)

  if (!filaPublica || !filaPrivada || !filaResumen) throw new ErrorApi('sin_permiso')

  const resumenKarma = resumenDesdeFila(filaResumen, fechaHoyISO())

  return {
    perfil: perfilPublicoDesdeFila(filaPublica),
    bio: filaPublica.bio,
    privado: {
      karmaGastable: filaPrivada.karma_spendable,
      cristales: filaPrivada.crystals,
      creditosEscucha: filaPrivada.listen_credits,
      escuchasDadas: filaPrivada.listens_given,
      publicaciones: filaPrivada.posts_published,
    },
    resumen: resumenKarma,
    // Cero consultas: función pura sobre lo que ya está cargado.
    insignias: calcularInsignias({
      karmaReputacion: filaPublica.karma_reputation,
      publicaciones: filaPrivada.posts_published,
      escuchasDadas: filaPrivada.listens_given,
      rachaDias: resumenKarma.racha.dias,
      vecesMeAyudo: vecesMeAyudo(resumenKarma.desglose30d),
    }),
  }
}

// ── Historial del ledger · keyset ───────────────────────────────────────────

/**
 * Página del historial. Keyset descendente sobre `(created_at, id)`.
 *
 * El cursor se emite cuando la página vuelve LLENA. Puede producir una última
 * petición que devuelva `[]` — se prefiere eso a pedir `limite + 1` filas, que
 * obligaría a bajar el máximo real por debajo de los 50 del contrato para no
 * chocar con el tope que la propia función SQL impone.
 */
export async function leerHistorial(
  parametros: ParametrosHistorial,
): Promise<PaginaCursor<EventoKarma>> {
  const supabase = await createClient()

  const { data, error } = await supabase.rpc('mi_historial_karma', argumentosHistorial(parametros))
  if (error) throw new ErrorApi('error_interno', { causa: error })

  const filas = (Array.isArray(data) ? data : []) as FilaEventoKarma[]

  const items: EventoKarma[] = []
  for (const fila of filas) {
    const evento = eventoKarmaDesdeFila(fila)
    if (evento) items.push(evento)
  }

  const ultima = filas[filas.length - 1]
  const siguienteCursor =
    ultima && filas.length >= parametros.limite
      ? codificarCursor({ creadoEn: ultima.created_at, id: String(ultima.id) })
      : null

  return { items, siguienteCursor }
}
