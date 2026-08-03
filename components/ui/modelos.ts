// ============================================================================
// Modelos de presentación — la lógica de los componentes, sin JSX.
//
// Todo lo que un componente DECIDE (qué atributos ARIA emite, qué texto lee un
// lector de pantalla, si un click cierra un diálogo) vive aquí, en funciones
// puras. Los `.tsx` solo traducen esto a marcado.
//
// Dos motivos, y el segundo es el importante:
//   1. `node --test` no puede cargar un archivo con JSX sin transpilador, y
//      este bloque no añade dependencias (§Consultas y rendimiento de B16.md).
//   2. Lo que hay que probar de un botón no es que emita un `<button>`, es que
//      con `cargando` emita `aria-busy` Y `disabled`, y que un diálogo de crisis
//      NO se cierre al pinchar fuera. Eso es lógica, y aquí se puede probar sin
//      montar un navegador entero.
// ============================================================================

import { levelLabel, progressToNextLevel } from '@/lib/karma'
import type { Nivel } from './tokens.ts'

// ── Boton ───────────────────────────────────────────────────────────────────

export interface AtributosBoton {
  readonly disabled: boolean
  readonly 'aria-busy': boolean | undefined
  /** Sin esto, un lector de pantalla no anuncia nada al empezar la espera. */
  readonly 'aria-live': 'polite' | undefined
}

/**
 * Atributos de estado del botón.
 *
 * `cargando` deshabilita: si la acción está en vuelo, el segundo click duplica
 * el comentario o el post. Pero `disabled` a secas saca el botón del orden de
 * tabulación y el foco se pierde al vacío, así que además se anuncia con
 * `aria-busy` para que quien no ve la pantalla sepa por qué dejó de responder.
 *
 * Lo que NO hace: cambiar el ancho. Sustituir el texto por un spinner encoge el
 * botón, mueve todo lo que hay debajo y a veces desplaza el puntero sobre otra
 * acción. El indicador se superpone; el texto se queda donde estaba (ver
 * `Boton.module.css`).
 */
export function atributosBoton(estado: {
  cargando?: boolean
  disabled?: boolean
}): AtributosBoton {
  const cargando = estado.cargando === true
  return {
    disabled: cargando || estado.disabled === true,
    'aria-busy': cargando ? true : undefined,
    'aria-live': cargando ? 'polite' : undefined,
  }
}

// ── MedidorKarma ────────────────────────────────────────────────────────────

export interface ModeloMedidor {
  readonly nivel: Nivel
  readonly etiqueta: string
  /** Reputación a mostrar. Nunca negativa: en la base hay un CHECK que lo
   *  impide, pero esta función también se usa para previsualizar el efecto de
   *  una penalización, y «−12 de karma» no es un mensaje que deba ver nadie. */
  readonly karmaVisible: number
  /** Entero [0,100] del tramo ACTUAL recorrido. */
  readonly porcentaje: number
  /** Karma que falta para el siguiente nivel. 0 en Mentor. */
  readonly restante: number
  readonly etiquetaSiguiente: string | null
  /** Texto del `aria-valuetext`: un número suelto no significa nada leído. */
  readonly textoAccesible: string
}

/**
 * Modelo del medidor a partir de la reputación.
 *
 * El progreso lo calcula `progressToNextLevel()` de `lib/karma.ts` — importado,
 * NUNCA recalculado aquí. La barra mide el tramo actual, no el total: con 2 400
 * de karma muestra 400/3000 = 13 %, no 2400/5000 = 48 %. La segunda miente
 * sobre lo que queda.
 *
 * `Math.floor` y no `Math.round`: con 1 999 de karma el ratio es 0,9993 y
 * redondear mostraría «100 %» junto a «te falta 1». Una barra llena que no ha
 * subido de nivel es exactamente el tipo de detalle que hace que la gente deje
 * de creerse el contador.
 *
 * Sobre el COPY (Trampa #5 de la ficha): aquí no aparece «crédito», ni
 * «puntos», ni «racha», ni «nivel desbloqueado». Se habla de personas
 * acompañadas y de nombres de nivel. Convertir el acompañamiento en moneda
 * arruina el producto, y una celebración a destiempo delante de alguien que
 * está mal es peor que no decir nada.
 */
export function modeloMedidor(karmaReputacion: number): ModeloMedidor {
  const p = progressToNextLevel(karmaReputacion)
  const porcentaje = Math.max(0, Math.min(100, Math.floor(p.ratio * 100)))
  const etiquetaSiguiente = p.nextLevel ? levelLabel(p.nextLevel) : null

  return {
    nivel: p.level,
    etiqueta: p.label,
    karmaVisible: Math.max(0, Math.trunc(karmaReputacion)),
    porcentaje,
    restante: p.remaining,
    etiquetaSiguiente,
    textoAccesible: etiquetaSiguiente
      ? `Nivel ${p.label}. ${porcentaje} % del camino hacia ${etiquetaSiguiente}.`
      : `Nivel ${p.label}. Es el último nivel.`,
  }
}

// ── Dialogo ─────────────────────────────────────────────────────────────────

/**
 * ¿Debe cerrarse el diálogo por esta interacción?
 *
 * `cierreAccidental: false` existe para los diálogos de crisis: la tarjeta de
 * recursos de ayuda no puede desaparecer porque el dedo rozó un píxel fuera del
 * panel. Ahí solo cierra el botón explícito de cierre.
 *
 * El `Esc` cuenta como accidental a propósito: en un teclado, `Esc` es tan fácil
 * de pulsar por reflejo como pinchar fuera con el ratón, y `<dialog>` lo dispara
 * solo. Quien quiera cerrar tiene el botón, que además está siempre enfocable.
 */
export function permitirCierre(
  origen: 'backdrop' | 'esc' | 'boton',
  cierreAccidental: boolean,
): boolean {
  if (origen === 'boton') return true
  return cierreAccidental
}

// ── Cargando ────────────────────────────────────────────────────────────────

/** Filas del esqueleto, acotadas: 40 barras grises no informan de nada. */
export function filasEsqueleto(filas: number | undefined): number {
  if (!Number.isFinite(filas)) return 3
  return Math.max(1, Math.min(8, Math.trunc(filas as number)))
}

// ── Insignia ────────────────────────────────────────────────────────────────

export interface SimboloNivel {
  /** Path de 24×24, de un solo trazo. */
  readonly d: string
  /** Etiqueta con tilde, de `lib/karma.ts`. */
  readonly etiqueta: string
}

/**
 * Símbolo de cada nivel.
 *
 * La forma es distinta en cada uno, no solo el color: entre el 8 % de los
 * hombres hay daltonismo, y el nivel decide qué puede hacer alguien en la app
 * (hostear círculos, por ejemplo). El color nunca es el único portador de
 * información (§Seguridad 5 de B16.md).
 */
export function simboloNivel(nivel: Nivel): SimboloNivel {
  const etiqueta = levelLabel(nivel)
  switch (nivel) {
    // Semilla: una gota/semilla cerrada.
    case 'semilla':
      return { d: 'M12 3c4 4 6 7 6 10a6 6 0 1 1-12 0c0-3 2-6 6-10z', etiqueta }
    // Brote: dos hojas saliendo de un tallo.
    case 'brote':
      return { d: 'M12 21v-8m0 0C12 9 9 6 5 6c0 4 3 7 7 7zm0 0c0-4 3-7 7-7 0 4-3 7-7 7z', etiqueta }
    // Guía: un rombo dentro de otro — orientación, no jerarquía.
    case 'guia':
      return { d: 'M12 2l10 10-10 10L2 12 12 2zm0 5l-5 5 5 5 5-5-5-5z', etiqueta }
    // Mentor: estrella de cinco puntas.
    case 'mentor':
      return { d: 'M12 2l3 6.5 7 .9-5 4.9 1.2 7L12 18l-6.2 3.3L7 14.3l-5-4.9 7-.9L12 2z', etiqueta }
  }
}

// ── EstadoVacio ─────────────────────────────────────────────────────────────

/**
 * ¿Se pinta la ilustración?
 *
 * En tono `'cuidado'` no. Son las pantallas donde el vacío duele —nadie ha
 * respondido a tu post, todavía no tienes almas afines— y un dibujo alegre ahí
 * lee como burla. El vacío se acompaña con palabras sobrias, no se decora.
 */
export function mostrarIlustracion(tono: 'neutro' | 'cuidado' | undefined): boolean {
  return tono !== 'cuidado'
}
