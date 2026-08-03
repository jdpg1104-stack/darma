// ============================================================================
// Tipos de B05 — y, sobre todo, el tipo que el compilador usa como barrera
//
// ── LA TRAMPA QUE ESTE ARCHIVO EXISTE PARA CERRAR ──────────────────────────
// El perfil propio y el ajeno se pintan con los mismos componentes. Si los dos
// compartieran un tipo con campos opcionales, tarde o temprano alguien
// rellenaría `karmaSpendable?` "por comodidad" en la rama del perfil ajeno y el
// saldo de una persona acabaría en el HTML que ve otra. Por eso hay DOS tipos
// sin herencia entre ellos: `PerfilAjeno` no tiene los campos privados, así que
// no es un descuido lo que los mantiene fuera, es que no se pueden escribir.
//
// Desde el endurecimiento del esquema eso dejó de ser una precaución de estilo:
// Postgres ya no deja leer esos campos ni sobre la propia fila (verificado,
// `42501 permission denied`), así que el tipo separado no es una regla nuestra
// sobre la base de datos — es el reflejo de lo que la base de datos permite.
//
// ── QUÉ CAMBIÓ RESPECTO A LA FICHA B05 ─────────────────────────────────────
// La ficha declaraba `PerfilAjeno { perfil, escuchasDadas, publicaciones,
// insignias }` con `listens_given` y `posts_published` como "contadores
// públicos". YA NO LO SON: `authenticated` no tiene privilegio de columna de
// SELECT sobre ninguno de los dos. Comprobado contra Postgres con dos sesiones
// reales — un `select listens_given,posts_published` de un usuario sobre la
// fila de otro devuelve 403 / 42501. Salen únicamente por `mi_perfil_privado()`,
// que filtra por `auth.uid()`, es decir: solo los ve su dueño.
//
// Se decidió NO devolverles el grant. Volver a conceder columnas que el
// endurecimiento quitó a propósito, desde el bloque que las quiere pintar, es
// exactamente la clase de cambio que deshace una decisión de seguridad sin que
// nadie lo relacione después. Queda anotado en HANDOFF/PEDIDOS.md para B00: si
// se decide que esos dos contadores son públicos, el sitio donde arreglarlo es
// el esquema, no este tipo.
// ============================================================================

import type { KarmaKind, KarmaLevel, LevelProgress } from '../../lib/karma.ts'

/** Espejo del CHECK `availability in (...)` de public.profiles. */
export type Disponibilidad = 'disponible' | 'necesito_hablar' | 'ausente'

/**
 * Copia literal de CONTRATOS §2. Se declara aquí y no se importa de
 * `lib/auth/perfil.ts` (donde B01 tiene la suya) porque ese módulo arrastra
 * `session.ts`, que importa `next/headers` por la vía diferida y no se puede
 * cargar desde `node --test`. Cuando B00 suba el tipo a `lib/tipos.ts` (ya
 * pedido en PEDIDOS.md), este alias desaparece y se importa el común.
 */
export interface PerfilPublico {
  /** uuid — sirve para enlazar, no identifica a nadie. */
  id: string
  /** seudónimo, 3–24 caracteres. */
  alias: string
  /** semilla determinista del avatar generado. NUNCA una URL. */
  avatarSeed: string
  /** derivado del karma vitalicio. */
  nivel: KarmaLevel
  /** solo la reputación; el gastable es privado. */
  karmaReputacion: number
  disponibilidad: Disponibilidad
  esMentor: boolean
}

/**
 * Fila de `profiles` tal y como la devuelve un `select` de las columnas que
 * `authenticated` PUEDE leer. La lista es exactamente el `grant select (...)`
 * de 0001: si añades un campo aquí que no esté en ese grant, la consulta
 * devuelve 42501 en tiempo de ejecución en vez de fallar al compilar, así que
 * este tipo se mantiene a mano y sincronizado con el SQL a conciencia.
 */
export interface FilaPerfilPublica {
  id: string
  alias: string
  avatar_seed: string
  bio: string | null
  karma_reputation: number
  level: KarmaLevel
  availability: Disponibilidad
  created_at: string
  last_seen_at: string
}

/** Fila que devuelve la RPC `mi_perfil_privado()` (0001). Solo el dueño. */
export interface FilaPerfilPrivada {
  karma_spendable: number
  crystals: number
  listen_credits: number
  listens_given: number
  posts_published: number
  daily_karma_earned: number
  banned_until: string | null
}

/** Fila que devuelve la RPC `mi_resumen_karma()` (0105). Solo el dueño. */
export interface FilaResumenKarma {
  reputacion: number
  ganado_hoy: number
  streak_days: number
  streak_last_date: string | null
  desglose_30d: unknown
}

/** Fila que devuelve la RPC `mi_historial_karma()` (0105). Solo el dueño. */
export interface FilaEventoKarma {
  id: number | string
  kind: string
  delta_reputation: number
  delta_spendable: number
  ref_type: string | null
  ref_id: string | null
  created_at: string
}

// ── Contrato de la API ──────────────────────────────────────────────────────

/** `GET /api/karma/resumen` → `{ ok: true, data: ResumenKarma }`. */
export interface ResumenKarma {
  nivel: KarmaLevel
  etiquetaNivel: string
  reputacion: number
  /** Devuelto TAL CUAL por `progressToNextLevel()`. No se recalcula nada. */
  progreso: LevelProgress
  hoy: { ganado: number; tope: number; restante: number }
  racha: { dias: number; activaHoy: boolean }
  desglose30d: DesgloseKarma[]
}

export interface DesgloseKarma {
  kind: KarmaKind
  total: number
  veces: number
  /** `KARMA_WEIGHTS[kind].description`, resuelto en TypeScript. */
  descripcion: string
}

/**
 * Una línea del ledger tal y como sale de la API.
 *
 * `id` NO está, y no es un olvido: `karma_events.id` es un `bigint identity` y
 * CONTRATOS §1 dice que los bigint de los ledgers no salen de la API. Sale
 * únicamente dentro del cursor opaco, que el cliente no interpreta. Un id
 * secuencial expuesto es, además, un contador del volumen global de eventos de
 * la red: dos peticiones separadas en el tiempo dan la tasa de actividad de
 * Darma entera a cualquiera con una cuenta.
 */
export interface EventoKarma {
  kind: KarmaKind
  deltaReputacion: number
  deltaGastable: number
  descripcion: string
  refTipo: string | null
  /** uuid, nunca el bigint del ledger. */
  refId: string | null
  /** ISO-8601. */
  ocurridoEn: string
}

/** CONTRATOS §5. El cursor es opaco: el cliente lo devuelve, no lo lee. */
export interface PaginaCursor<T> {
  items: T[]
  siguienteCursor: string | null
}

/** `GET /api/karma/insignias` → `{ ok: true, data: Insignia[] }`. */
export interface Insignia {
  clave: ClaveInsignia
  nombre: string
  descripcion: string
  /** Cómo se consigue. Obligatorio: una insignia que no lo explica es una
   *  mecánica oscura, y aquí la economía es auditable por principio. */
  comoSeConsigue: string
  conseguida: boolean
  /** ISO-8601. `null` mientras no haya un evento fechado que la respalde: los
   *  contadores desnormalizados no guardan CUÁNDO se cruzó cada umbral, y
   *  inventar una fecha en una pantalla de transparencia es peor que no darla. */
  conseguidaEn: string | null
}

export type ClaveInsignia =
  | 'primera_voz'
  | 'primera_escucha'
  | 'diez_escuchas'
  | 'cien_escuchas'
  | 'brote'
  | 'guia'
  | 'mentor'
  | 'racha_7'
  | 'racha_30'
  | 'corazon_util'

// ── Las dos formas del perfil ───────────────────────────────────────────────

/**
 * Perfil de OTRA persona. Exactamente esto y nada más.
 *
 * Sin `escuchasDadas` ni `publicaciones`: ver la cabecera del archivo. Sin
 * `bio` tampoco — es legible por privilegio, pero CONTRATOS §2 define
 * `PerfilPublico` sin ella y este tipo no amplía el contrato por su cuenta.
 */
export interface PerfilAjeno {
  perfil: PerfilPublico
  /** SOLO las conseguidas, y solo las que se derivan de datos públicos. */
  insignias: Insignia[]
}

/** Perfil PROPIO. Es el único sitio donde los campos privados existen. */
export interface PerfilPropio {
  perfil: PerfilPublico
  bio: string | null
  privado: {
    karmaGastable: number
    cristales: number
    creditosEscucha: number
    escuchasDadas: number
    publicaciones: number
  }
  resumen: ResumenKarma
  insignias: Insignia[]
}

/**
 * Estado que devuelve la Server Action de edición a `useActionState`.
 *
 * `ok: false` con `mensaje` SIEMPRE que algo falle. No hay ninguna rama que
 * devuelva `ok: true` sin haber escrito: fingir éxito en una pantalla de
 * identidad es peor que un error, porque la persona se va creyendo que su alias
 * cambió y descubre que no la próxima vez que entre.
 */
export interface EstadoEdicion {
  ok: boolean
  mensaje: string | null
  /** Qué campo señalar en el formulario. `null` = error general. */
  campo: 'alias' | 'bio' | 'avatarSeed' | 'disponibilidad' | null
}

/** Entrada de la Server Action de edición. Cuatro campos, ni uno más: son
 *  EXACTAMENTE los del `grant update (alias, avatar_seed, bio, availability)`
 *  de 0001. Cualquier otro no daría error — simplemente no se escribiría. */
export interface EditarPerfilInput {
  alias?: string
  avatarSeed?: string
  bio?: string
  disponibilidad?: Disponibilidad
}

/**
 * Objeto que llega al `UPDATE`. Sus claves son EXACTAMENTE las del
 * `grant update (alias, avatar_seed, bio, availability)` de 0001.
 *
 * Que sea un tipo cerrado es lo que impide que `karma_reputation` o `crystals`
 * lleguen al UPDATE aunque alguien los meta en el formulario: no habría dónde
 * ponerlos. Postgres los rechazaría igualmente, pero un UPDATE que Postgres
 * ignora en silencio parece haber funcionado, y eso es peor que un error.
 */
export interface CambiosPerfil {
  alias?: string
  avatar_seed?: string
  bio?: string | null
  availability?: Disponibilidad
}
