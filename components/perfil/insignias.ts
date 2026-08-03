// ============================================================================
// Insignias — DERIVADAS, no almacenadas
//
// No hay tabla `badges` y no la va a haber. Las diez insignias se calculan con
// una función pura sobre contadores que ya están cargados para pintar la
// pantalla: cero consultas extra y, sobre todo, cero estado que se pueda
// desincronizar. Una tabla de insignias es un caché de una verdad que ya existe
// en otro sitio; el día que un trigger falle o que alguien recalcule el karma,
// habría gente con la insignia de "cien escuchas" y 40 escuchas en su perfil.
//
// ── LO QUE HACE DISTINTO A ESTE MÓDULO: LA EVIDENCIA PUEDE FALTAR ──────────
// Los contadores de escuchas y publicaciones son PRIVADOS en Postgres desde el
// endurecimiento: `authenticated` no tiene privilegio de SELECT sobre
// `listens_given` ni `posts_published`, así que en el perfil de OTRA persona
// simplemente no existen. La racha, igual.
//
// La reacción tentadora es pintar esas insignias como "no conseguida" en el
// perfil ajeno. Es peor que no pintarlas: dice algo falso sobre esa persona
// —«no ha escuchado a nadie»— basándose en que nosotros no podemos verlo. Aquí
// una insignia sin evidencia se OMITE de la lista, no se marca en gris. Por eso
// los campos de `DatosInsignias` son opcionales y `undefined` significa "no lo
// sé", que es distinto de 0.
//
// Cada insignia lleva `comoSeConsigue`. No es adorno: una insignia que no
// explica cómo se consigue es una mecánica oscura, y la economía de Darma es
// auditable por principio (ARCHITECTURE §1, «karma_weights es pública a
// propósito»).
// ============================================================================

import { KARMA_LEVELS, type KarmaLevel } from '../../lib/karma.ts'
import type { ClaveInsignia, Insignia } from './tipos.ts'

/**
 * Contadores desde los que se derivan las insignias.
 *
 * Todos opcionales A PROPÓSITO: `undefined` = "este dato no está disponible en
 * este contexto" (perfil ajeno), y entonces la insignia que depende de él no
 * aparece. `0` = "lo sé y es cero", y entonces sí aparece como no conseguida.
 */
export interface DatosInsignias {
  /** Público: `profiles.karma_reputation`. Siempre disponible. */
  karmaReputacion: number
  /** Privado: `posts_published` (solo vía `mi_perfil_privado()`). */
  publicaciones?: number
  /** Privado: `listens_given` (solo vía `mi_perfil_privado()`). */
  escuchasDadas?: number
  /** Privado: `streak_days` (solo vía `mi_resumen_karma()`). */
  rachaDias?: number
  /** Privado: sale del desglose de 30 días, clave `marked_helpful`. NO se
   *  consulta aparte — es el mismo agregado que ya pinta el resumen. */
  vecesMeAyudo?: number
}

/** Umbral de un nivel, leído de `lib/karma.ts`. Nunca escrito a mano: los
 *  500/2000/5000 viven en `KARMA_LEVELS` y en la columna generada
 *  `profiles.level`, y un tercer sitio es lo que CONTRATOS §8 prohíbe. */
function umbralDeNivel(nivel: KarmaLevel): number {
  const definicion = KARMA_LEVELS.find((d) => d.level === nivel)
  // Imposible con los niveles actuales; la guarda existe para que un cambio
  // futuro en KARMA_LEVELS rompa la insignia de forma visible (nunca se
  // consigue) en vez de concederla a todo el mundo con un umbral 0.
  return definicion ? definicion.min : Number.POSITIVE_INFINITY
}

interface DefinicionInsignia {
  clave: ClaveInsignia
  nombre: string
  descripcion: string
  comoSeConsigue: string
  /** Qué contador la respalda. Si llega `undefined`, la insignia se omite. */
  campo: keyof DatosInsignias
  umbral: number
}

/**
 * Catálogo CERRADO y explicable. Nada de "insignia misteriosa": si no se puede
 * escribir en una línea cómo se consigue, no entra.
 *
 * Copy sin celebración (misma regla que `MedidorKarma` de B16): esto aparece en
 * la pantalla de alguien que puede estar mal. Se cuenta lo que ha hecho; no se
 * le felicita por ello.
 */
export const CATALOGO_INSIGNIAS: readonly DefinicionInsignia[] = [
  {
    clave: 'primera_voz',
    nombre: 'Primera voz',
    descripcion: 'Contaste algo por primera vez.',
    comoSeConsigue: 'Publica tu primer desahogo, pregunta o gratitud.',
    campo: 'publicaciones',
    umbral: 1,
  },
  {
    clave: 'primera_escucha',
    nombre: 'Primera escucha',
    descripcion: 'Acompañaste a alguien por primera vez.',
    comoSeConsigue: 'Escribe un comentario de apoyo que pase la validación de calidad.',
    campo: 'escuchasDadas',
    umbral: 1,
  },
  {
    clave: 'diez_escuchas',
    nombre: 'Diez escuchas',
    descripcion: 'Has acompañado a diez personas.',
    comoSeConsigue: 'Acumula 10 comentarios de apoyo validados.',
    campo: 'escuchasDadas',
    umbral: 10,
  },
  {
    clave: 'cien_escuchas',
    nombre: 'Cien escuchas',
    descripcion: 'Has acompañado a cien personas.',
    comoSeConsigue: 'Acumula 100 comentarios de apoyo validados.',
    campo: 'escuchasDadas',
    umbral: 100,
  },
  {
    clave: 'brote',
    nombre: 'Brote',
    descripcion: 'Alcanzaste el nivel Brote.',
    comoSeConsigue: `Reúne ${umbralDeNivel('brote')} de karma de reputación.`,
    campo: 'karmaReputacion',
    umbral: umbralDeNivel('brote'),
  },
  {
    clave: 'guia',
    nombre: 'Guía',
    descripcion: 'Alcanzaste el nivel Guía.',
    comoSeConsigue: `Reúne ${umbralDeNivel('guia')} de karma de reputación.`,
    campo: 'karmaReputacion',
    umbral: umbralDeNivel('guia'),
  },
  {
    clave: 'mentor',
    nombre: 'Mentor',
    descripcion: 'Alcanzaste el nivel Mentor.',
    comoSeConsigue: `Reúne ${umbralDeNivel('mentor')} de karma de reputación.`,
    campo: 'karmaReputacion',
    umbral: umbralDeNivel('mentor'),
  },
  {
    clave: 'racha_7',
    nombre: 'Siete días',
    descripcion: 'Siete días seguidos acompañando.',
    comoSeConsigue: 'Gana karma positivo siete días naturales consecutivos.',
    campo: 'rachaDias',
    umbral: 7,
  },
  {
    clave: 'racha_30',
    nombre: 'Treinta días',
    descripcion: 'Treinta días seguidos acompañando.',
    comoSeConsigue: 'Gana karma positivo treinta días naturales consecutivos.',
    campo: 'rachaDias',
    umbral: 30,
  },
  {
    clave: 'corazon_util',
    nombre: 'Sirvió de algo',
    descripcion: 'Diez personas marcaron que tu comentario les ayudó.',
    comoSeConsigue: 'Recibe 10 «me ayudó» de quienes escribieron el desahogo.',
    campo: 'vecesMeAyudo',
    umbral: 10,
  },
] as const

export interface OpcionesInsignias {
  /** Devuelve solo las conseguidas. Es lo que se usa en el perfil ajeno: ahí no
   *  se enseña a otra persona la lista de lo que le falta. */
  soloConseguidas?: boolean
}

/**
 * Insignias derivadas de contadores YA cargados. Función pura, cero consultas.
 *
 * Umbral inclusivo (`>=`): con exactamente 10 escuchas la insignia de diez está
 * conseguida. Es el borde que más se equivoca y por eso hay un test para 0, 10
 * y 100 exactos.
 */
export function calcularInsignias(
  datos: DatosInsignias,
  opciones: OpcionesInsignias = {},
): Insignia[] {
  const salida: Insignia[] = []

  for (const def of CATALOGO_INSIGNIAS) {
    const valor = datos[def.campo]
    // Sin evidencia no se afirma nada, ni a favor ni en contra. Ver cabecera.
    if (valor === undefined) continue

    const conseguida = valor >= def.umbral
    if (opciones.soloConseguidas && !conseguida) continue

    salida.push({
      clave: def.clave,
      nombre: def.nombre,
      descripcion: def.descripcion,
      comoSeConsigue: def.comoSeConsigue,
      conseguida,
      // Los contadores desnormalizados no guardan cuándo se cruzó el umbral.
      // Antes que inventar una fecha en una pantalla de transparencia, null.
      conseguidaEn: null,
    })
  }

  return salida
}

/**
 * Insignias visibles en el perfil de OTRA persona.
 *
 * Solo recibe la reputación —lo único público de esa persona— así que solo
 * puede devolver las tres de nivel, y solo las conseguidas. No es una decisión
 * de producto que se pueda ampliar desde aquí: los demás contadores no se
 * pueden leer, y el intento devuelve `42501 permission denied`.
 */
export function insigniasPublicas(karmaReputacion: number): Insignia[] {
  return calcularInsignias({ karmaReputacion }, { soloConseguidas: true })
}
