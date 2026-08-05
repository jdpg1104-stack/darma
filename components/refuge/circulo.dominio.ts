// ============================================================================
// B10 · Dominio de la creación de un círculo — lógica pura, sin red ni React.
//
// Un círculo es la mitad grupal de los refugios: la misma sala cifrada del dúo
// pero con varias personas dentro, cada una con SU sobre (la clave de la sala
// envuelta con el secreto ECDH entre quien crea y cada invitada). Este módulo
// no cifra ni pide nada: decide qué selección es válida y qué invitación es
// imposible, para que la pantalla lo diga ANTES de intentar crear.
//
// ── LOS NÚMEROS, Y POR QUÉ ESTOS ───────────────────────────────────────────
// Hay tres techos y mandan los de abajo:
//   · Postgres (`b10_crear_refugio`): entre 2 y 8 personas en total.
//   · La ruta (`esquemaCrearRefugio`): entre 1 y 7 invitadas.
//   · Este flujo: hasta MAX_INVITADOS_CIRCULO invitadas — un círculo de
//     MIN_MIEMBROS_CIRCULO a MAX_MIEMBROS_CIRCULO personas contándote a ti.
// Que el cliente sea MÁS estricto que el servidor es deliberado y es barato de
// relajar (una constante); lo contrario —un cliente que deja marcar a más gente
// de la que el servidor acepta— se descubre con el error puesto en la cara de
// alguien que ya eligió a sus siete personas.
// ============================================================================

/** Aforo del círculo, CONTÁNDOTE a ti. */
export const MAX_MIEMBROS_CIRCULO = 7
export const MIN_MIEMBROS_CIRCULO = 2

/** Cuántas almas afines se pueden marcar (todas menos tú). */
export const MAX_INVITADOS_CIRCULO = MAX_MIEMBROS_CIRCULO - 1
export const MIN_INVITADOS_CIRCULO = MIN_MIEMBROS_CIRCULO - 1

/** El mismo tope que `esquemaCrearRefugio.title` (60). El título viaja SIN
 *  cifrar —es el único texto en claro del bloque— y por eso se acota igual
 *  aquí que allí. */
export const TITULO_MAX = 60

export type MotivoSeleccionInvalida = 'sin_nadie' | 'demasiada_gente'

export type ResultadoSeleccion =
  | { ok: true }
  | { ok: false; motivo: MotivoSeleccionInvalida }

/**
 * Marca o desmarca a una persona. Inmutable: devuelve un set NUEVO, o el MISMO
 * si el cambio no está permitido (así un `setState` con el resultado no
 * re-renderiza cuando no cambió nada).
 *
 * El tope se aplica al añadir, nunca al quitar: con la selección llena siempre
 * se puede desmarcar a alguien para hacer sitio.
 */
export function alternarInvitado(
  seleccion: ReadonlySet<string>,
  id: string,
): ReadonlySet<string> {
  if (seleccion.has(id)) {
    const copia = new Set(seleccion)
    copia.delete(id)
    return copia
  }
  if (seleccion.size >= MAX_INVITADOS_CIRCULO) return seleccion
  const copia = new Set(seleccion)
  copia.add(id)
  return copia
}

/** ¿Se puede crear un círculo con esta selección? */
export function validarSeleccion(seleccion: ReadonlySet<string>): ResultadoSeleccion {
  if (seleccion.size < MIN_INVITADOS_CIRCULO) return { ok: false, motivo: 'sin_nadie' }
  if (seleccion.size > MAX_INVITADOS_CIRCULO) return { ok: false, motivo: 'demasiada_gente' }
  return { ok: true }
}

/** Cuántas personas tendría el círculo, contando a quien lo crea. */
export function miembrosTotales(seleccion: ReadonlySet<string>): number {
  return seleccion.size + 1
}

/**
 * Quiénes de la selección se quedaron SIN sobre tras preparar la sala.
 *
 * `prepararSobresDeSalaNueva` solo envuelve para quien tiene clave publicada:
 * quien nunca abrió sus refugios no tiene, y fabricarle una sería exactamente
 * lo que el número de seguridad existe para detectar. Un círculo donde alguien
 * entra sin poder descifrar es esa persona sentada en la sala sin oír nada, así
 * que la pantalla usa esta lista para NEGARSE a crear y decir quién falta.
 */
export function invitadosSinSobre(
  invitados: readonly string[],
  sobres: ReadonlyArray<{ recipientId: string }>,
): string[] {
  const conSobre = new Set(sobres.map((s) => s.recipientId))
  return invitados.filter((id) => !conSobre.has(id))
}

/**
 * Alias visibles de una lista de ids, en el orden de los ids. Un id que no esté
 * entre las almas se omite: no hay nada honesto que enseñar de alguien de quien
 * no se conoce ni el alias.
 */
export function aliasesDe(
  ids: readonly string[],
  almas: ReadonlyArray<{ id: string; alias: string }>,
): string[] {
  const porId = new Map(almas.map((a) => [a.id, a.alias]))
  return ids.flatMap((id) => {
    const alias = porId.get(id)
    return alias === undefined ? [] : [alias]
  })
}

/**
 * El título tal cual viaja al servidor: recortado de espacios y `null` si no
 * queda nada. `null`, no `''`: la ruta valida `min(1)` y una cadena vacía sería
 * un 422 por un campo que la persona dejó en blanco a propósito.
 */
export function normalizarTitulo(crudo: string): string | null {
  const limpio = crudo.trim().slice(0, TITULO_MAX).trim()
  return limpio === '' ? null : limpio
}
