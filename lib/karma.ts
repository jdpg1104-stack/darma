// ============================================================================
// Karma — SSOT en TypeScript de la economía de Darma
//
// La AUTORIDAD de la economía es Postgres: la tabla public.karma_weights y la
// función award_karma() (SECURITY DEFINER, con el tope diario dentro de la
// misma transacción). `authenticated` no tiene privilegio UPDATE sobre las
// columnas de karma, así que nadie puede regalarse reputación con un PATCH a
// PostgREST. Este módulo NO otorga karma: replica los pesos para poder pintar
// la UI, previsualizar ("esto te dará +10"), validar formularios y razonar en
// tests sin ir a la base de datos.
//
// Por eso hay un test —lib/economySync.test.ts— que lee
// supabase/migrations/0001_core.sql y comprueba literal a literal que estas
// constantes coinciden con las del INSERT de karma_weights y con el tope 120
// que hay escrito dentro de award_karma. Es el test que impide el peor bug
// posible de esta app: que la UI prometa un número y la base pague otro. Una
// economía en la que el contrato mostrado no se cumple destruye la confianza
// mucho más rápido que un bug funcional.
//
// PRINCIPIO DE DISEÑO DE LA ECONOMÍA (por qué dos magnitudes del mismo evento):
//   · karma_reputation → vitalicio, solo sube, define el NIVEL. Es identidad.
//     Si se gastara, la gente sentiría que "pierde quién es" al usar la app.
//   · karma_spendable  → el 30 % de lo ganado. Es lo que se consume.
// Separarlos permite que gastar no penalice el estatus, y que el estatus no se
// pueda comprar gastando. Un solo saldo obligaba a elegir entre las dos cosas.
// ============================================================================

// ── Pesos (espejo de public.karma_weights) ──────────────────────────────────
/** Tipos de evento de karma. Espejo de la PK de karma_weights. */
export type KarmaKind =
  | 'comment_validated'
  | 'marked_helpful'
  | 'circle_hosted'
  | 'content_completed'
  | 'spam_penalty'
  | 'report_upheld'
  | 'karma_spend'

export interface KarmaWeight {
  /** Delta de reputación. Negativo en las penalizaciones. */
  readonly reputation: number
  /** Fracción de lo ganado que además se acredita como gastable. */
  readonly spendablePct: number
  /** ¿Cuenta para el tope diario? Las penalizaciones NO (ver abajo). */
  readonly countsToCap: boolean
  /** Texto para la UI (ledger, tooltips). */
  readonly description: string
}

export const KARMA_WEIGHTS: Readonly<Record<KarmaKind, KarmaWeight>> = {
  /** Comentario de apoyo que pasó la validación de calidad (lib/moderation.ts
   *  y, después, el clasificador de IA). Es el evento nuclear de Darma: además
   *  del karma otorga 1 crédito de escucha para el gate 3:1. */
  comment_validated: {
    reputation: 10,
    spendablePct: 0.3,
    countsToCap: true,
    description: 'Comentario de apoyo validado por IA',
  },
  /** El autor del post marcó tu comentario como "me ayudó". Vale más que la
   *  validación automática porque la firma una persona que estaba sufriendo:
   *  es la única señal de la red que no puede fabricar una máquina. */
  marked_helpful: {
    reputation: 15,
    spendablePct: 0.3,
    countsToCap: true,
    description: 'El autor marcó tu comentario como "me ayudó"',
  },
  /** Hostear un círculo grupal (solo Guía/Mentor). Es la aportación más cara en
   *  tiempo y responsabilidad de toda la app, y por eso paga más. */
  circle_hosted: {
    reputation: 30,
    spendablePct: 0.3,
    countsToCap: true,
    description: 'Hostear un círculo grupal (Guía/Mentor)',
  },
  /** Ver una pieza de contenido de bienestar entera. Paga 1 a propósito: es un
   *  acto de autocuidado, no una aportación a la comunidad. Debe notarse que
   *  existe sin que sea nunca una vía de farmeo. */
  content_completed: {
    reputation: 1,
    spendablePct: 0.3,
    countsToCap: true,
    description: 'Ver contenido de bienestar completo',
  },
  /** Comentario spam o de relleno detectado. −40: cuatro veces lo que paga un
   *  comentario bueno. La asimetría es deliberada — con castigo simétrico, el
   *  farmeo sale a cuenta en cuanto aciertas más de la mitad de las veces. */
  spam_penalty: {
    reputation: -40,
    spendablePct: 0,
    countsToCap: false,
    description: 'Comentario spam o de relleno',
  },
  /** Reporte de otra persona confirmado por moderación. */
  report_upheld: {
    reputation: -30,
    spendablePct: 0,
    countsToCap: false,
    description: 'Reporte confirmado en tu contra',
  },
  /** Clase del ledger para los GASTOS (boost, regalo, fruto). No es una
   *  concesión: `reputation` es 0 y el movimiento real es el `delta_spendable`
   *  negativo que escribe spend_karma().
   *
   *  Existe porque el ledger tiene una FK a karma_weights(kind) y sin esta
   *  clase spend_karma() tenía que reutilizar 'comment_validated' para
   *  satisfacerla: un boost de −50 aparecía en el historial de la persona
   *  etiquetado como "comentario validado". La pantalla de transparencia del
   *  karma es justo la que sostiene la confianza en la economía; no puede
   *  mentir. NUNCA se pasa a award_karma(). */
  karma_spend: {
    reputation: 0,
    spendablePct: 0,
    countsToCap: false,
    description: 'Gasto de karma gastable (boost, fruto, regalo)',
  },
} as const

// ── Tope diario ─────────────────────────────────────────────────────────────
/**
 * Máximo de reputación POSITIVA acumulable en un día natural (120).
 *
 * 120 = 12 comentarios validados, o 8 "me ayudó", o 4 círculos. Es
 * deliberadamente alcanzable en una tarde de apoyo genuino y absurdamente bajo
 * para quien quiera farmear: el techo convierte el farmeo en una actividad sin
 * retorno en vez de en una carrera armamentística de detección.
 *
 * Comportamiento en el borde (espejo de award_karma): al pasarse NO se rechaza
 * la acción, se RECORTA el excedente. Quien ayuda de más nunca debe recibir un
 * error por ayudar; simplemente deja de acumular.
 *
 * Las penalizaciones NO cuentan para el tope (countsToCap: false). Si contaran,
 * un troll podría "gastarse" el tope con spam para dejar su cuenta inmune al
 * resto del día, y peor: una penalización nunca debe liberar cupo.
 */
export const DAILY_KARMA_CAP = 120

/** Fracción por defecto de lo ganado que se acredita como gastable (30 %). */
export const SPENDABLE_PCT = 0.3

// ── Niveles ─────────────────────────────────────────────────────────────────
/** Espejo de la columna generada `level` de public.profiles. Sin tilde en
 *  'guia' porque así está en el SQL y el valor viaja por la API. */
export type KarmaLevel = 'semilla' | 'brote' | 'guia' | 'mentor'

export interface LevelDefinition {
  readonly level: KarmaLevel
  /** Umbral inclusivo de reputación. */
  readonly min: number
  /** Etiqueta para la UI (esta sí con tilde). */
  readonly label: string
}

/**
 * Umbrales. Ordenados de MAYOR a menor a propósito: `levelForKarma` recorre y
 * devuelve el primero que cumple, que es exactamente la estructura del CASE de
 * la columna generada en SQL. Mantener el mismo orden en ambos lados hace que
 * comparar los dos archivos sea trivial.
 */
export const KARMA_LEVELS: readonly LevelDefinition[] = [
  { level: 'mentor', min: 5000, label: 'Mentor' },
  { level: 'guia', min: 2000, label: 'Guía' },
  { level: 'brote', min: 500, label: 'Brote' },
  { level: 'semilla', min: 0, label: 'Semilla' },
] as const

// ── Costes ──────────────────────────────────────────────────────────────────
/**
 * Costes en karma GASTABLE. Positivos aquí; spend_karma() recibe el importe en
 * positivo y resta. (En el ledger quedan como delta_spendable negativo.)
 */
export const KARMA_COSTS = {
  /** Impulsar tu propio post: sube en el feed durante la ventana de boost.
   *  Ver lib/feedRanking.ts — el boost NO salta moderación ni crisis. */
  boost: 50,
  /** Regalar un boost al post de otra persona. Mismo precio que impulsarse a
   *  uno mismo, no más barato: si regalar saliera más barato se convertiría en
   *  un mercado de intercambios recíprocos ("bóosteame y te bóosteo"), que es
   *  farmeo de visibilidad con otro nombre. */
  gift_boost: 50,
  /** Fruto de bienestar: desbloquea una pieza premium de contenido. 500 = diez
   *  boosts, y ~17 días de tope diario completo convertido a gastable. Es el
   *  objetivo a largo plazo de la economía; barato dejaría la moneda sin uso. */
  wellness_fruit: 500,
} as const

export type KarmaCostKind = keyof typeof KARMA_COSTS

// ── Funciones puras ─────────────────────────────────────────────────────────

/**
 * Nivel correspondiente a una reputación. Espejo del CASE de la columna
 * generada `profiles.level`.
 *
 * Valores negativos → 'semilla'. En la base es imposible (hay un CHECK
 * `karma_reputation >= 0`), pero esta función también se usa para previsualizar
 * el efecto de una penalización antes de aplicarla, y ahí sí puede llegar un
 * número negativo.
 */
export function levelForKarma(reputation: number): KarmaLevel {
  for (const def of KARMA_LEVELS) {
    if (reputation >= def.min) return def.level
  }
  return 'semilla'
}

/** Etiqueta bonita del nivel, para la UI. */
export function levelLabel(level: KarmaLevel): string {
  return KARMA_LEVELS.find((d) => d.level === level)?.label ?? 'Semilla'
}

/**
 * Karma gastable que genera una concesión de reputación.
 *
 * Espejo de `floor(greatest(v_grant, 0) * w.spendable_pct)::integer`:
 *   · floor, no round — la base trunca; redondear aquí mostraría a veces 1 más
 *     del que luego se acredita, y ese "1 que falta" es el tipo de detalle que
 *     hace que la gente deje de fiarse del contador.
 *   · las concesiones negativas no generan gastable (greatest(_, 0)): una
 *     penalización baja la reputación pero NO te quita saldo ya acreditado; el
 *     saldo gastable ya podría estar gastado y dejarlo negativo rompería el
 *     CHECK `karma_spendable >= 0`.
 */
export function spendableFrom(grantedReputation: number, pct: number = SPENDABLE_PCT): number {
  return Math.floor(Math.max(grantedReputation, 0) * pct)
}

/** Resultado de aplicar el tope diario a una concesión. */
export interface DailyCapResult {
  /** Reputación que se concede realmente tras recortar. */
  granted: number
  /** Cuánto se perdió por el tope (0 si no aplicó). Sirve para avisar en UI. */
  clipped: number
  /** ¿Se alcanzó el tope con esta concesión? */
  capReached: boolean
}

/**
 * Aplica el tope diario a una concesión. Espejo de la rama
 * `if w.counts_to_cap and v_grant > 0 then v_grant := least(v_grant, greatest(0, 120 - v_earned_today))`.
 *
 * @param weight             el peso del evento (para saber si cuenta al tope).
 * @param earnedToday        reputación positiva ya acumulada HOY.
 * @param cap                el tope, inyectable para tests.
 */
export function applyDailyCap(
  weight: Pick<KarmaWeight, 'reputation' | 'countsToCap'>,
  earnedToday: number,
  cap: number = DAILY_KARMA_CAP,
): DailyCapResult {
  const raw = weight.reputation

  // Penalizaciones y eventos exentos pasan enteros: el tope limita lo que se
  // GANA, nunca lo que se pierde.
  if (!weight.countsToCap || raw <= 0) {
    return { granted: raw, clipped: 0, capReached: false }
  }

  const remaining = Math.max(0, cap - Math.max(0, earnedToday))
  const granted = Math.min(raw, remaining)

  return {
    granted,
    clipped: raw - granted,
    capReached: granted < raw,
  }
}

/** Progreso hacia el siguiente nivel, listo para pintar una barra. */
export interface LevelProgress {
  level: KarmaLevel
  label: string
  /** Umbral del nivel actual. */
  currentThreshold: number
  /** Siguiente nivel, o `null` si ya es Mentor. */
  nextLevel: KarmaLevel | null
  /** Umbral del siguiente nivel, o `null` si ya es Mentor. */
  nextThreshold: number | null
  /** Karma que falta para subir. 0 si ya es Mentor. */
  remaining: number
  /** Fracción [0, 1] del tramo actual recorrida. 1 si ya es Mentor. */
  ratio: number
}

/**
 * Progreso dentro del tramo ACTUAL, no desde cero.
 *
 * Con 2 400 de karma (Guía, tramo 2000→5000) la barra muestra 400/3000 = 13 %,
 * no 2400/5000 = 48 %. La segunda opción se descartó porque miente sobre lo que
 * queda: la barra se vería casi llena justo cuando faltan 2 600 puntos, y una
 * barra que engaña sobre el esfuerzo restante es peor que no tener barra.
 */
export function progressToNextLevel(reputation: number): LevelProgress {
  const safe = Math.max(0, reputation)
  const level = levelForKarma(safe)

  // KARMA_LEVELS está de mayor a menor; el índice del actual y el anterior
  // (índice − 1) es el siguiente nivel hacia arriba.
  const index = KARMA_LEVELS.findIndex((d) => d.level === level)
  const current = KARMA_LEVELS[index]!
  const next = index > 0 ? KARMA_LEVELS[index - 1]! : null

  if (!next) {
    return {
      level,
      label: levelLabel(level),
      currentThreshold: current.min,
      nextLevel: null,
      nextThreshold: null,
      remaining: 0,
      ratio: 1,
    }
  }

  const span = next.min - current.min
  const done = safe - current.min

  return {
    level,
    label: levelLabel(level),
    currentThreshold: current.min,
    nextLevel: next.level,
    nextThreshold: next.min,
    remaining: Math.max(0, next.min - safe),
    // span > 0 siempre con los umbrales actuales; la guarda protege de un
    // futuro cambio de tabla que introdujera dos niveles con el mismo umbral.
    ratio: span > 0 ? Math.min(1, Math.max(0, done / span)) : 1,
  }
}

/**
 * ¿Alcanza el saldo gastable para este gasto?
 *
 * El saldo llega de la RPC `mi_perfil_privado()`: karma_spendable y crystals
 * son campos PRIVADOS y `authenticated` no tiene privilegio de SELECT sobre
 * ellos (si lo tuviera, cualquiera podría leer el saldo de cualquiera con un
 * `?select=karma_spendable`).
 *
 * Es SOLO para deshabilitar el botón y explicar cuánto falta. La comprobación
 * real es el `where ... and karma_spendable >= p_amount` de spend_karma(), que
 * comprueba y descuenta en la misma sentencia: por eso dos peticiones
 * simultáneas no pueden gastar el mismo saldo. Esta función, en cambio, mira un
 * saldo que ya puede estar obsoleto.
 */
export function canAfford(spendable: number, cost: KarmaCostKind): { ok: boolean; missing: number } {
  const amount = KARMA_COSTS[cost]
  return { ok: spendable >= amount, missing: Math.max(0, amount - spendable) }
}
