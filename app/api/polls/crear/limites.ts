// ============================================================================
// Los números de la creación de encuestas, en un archivo SIN una sola
// importación de valor.
//
// ── POR QUÉ ESTÁ SEPARADO DE `dominio.ts` ─────────────────────────────────
// El formulario de `app/(admin)/encuestas` es un componente `'use client'` y
// necesita estos límites para avisar antes de enviar. Si los importara de
// `dominio.ts`, arrastraría al bundle del navegador la cadena
// `dominio.ts → (admin)/_lib/acceso.ts → lib/supabase/admin.ts`, que es el
// cliente `service_role`: la llave maestra del anonimato de toda la red metida
// en un bundle público. La guarda de runtime de `admin.ts` lo detectaría al
// primer render, pero para entonces el secreto ya estaría en el JavaScript
// servido, y eso no se arregla con un throw.
//
// De ahí la regla de este archivo: aquí solo pueden entrar constantes y tipos.
// La única importación permitida es `import type`, que TypeScript borra al
// compilar y por tanto no crea ninguna arista en el grafo del bundler.
// ============================================================================

import type { RolAdmin } from '../../../(admin)/_lib/acceso.ts'

/**
 * Rol mínimo para publicar una encuesta.
 *
 * `moderador` y no `soporte`: una encuesta se sirve a TODA la red desde el
 * feed, así que crearla es publicar, no consultar. Y no `superadmin` porque
 * entonces la cola de preguntas dependería de la única persona que además
 * reparte permisos.
 */
export const ROL_MINIMO: RolAdmin = 'moderador'

/**
 * Límite de creación: 10 por hora y por persona.
 *
 * Bajo a propósito y con ventana larga. Publicar una encuesta es un acto
 * editorial, no una interacción: diez al día ya sería mucho producto, y el
 * límite existe para que un bucle en la consola de un admin comprometido no
 * llene el feed de toda la red antes de que nadie mire.
 *
 * Va aquí y no en `lib/polls/limites.ts` porque ese archivo es de B09 y sus
 * `LIMITES_PETICION` son los de las cinco rutas de su contrato. Cuando B09
 * adopte esta ruta, se mueve allí y se borra esta constante.
 */
export const LIMITE_CREAR = { limite: 10, ventanaSegundos: 3600 } as const

/**
 * Espejo del `check (min_reveal between 3 and 10000)` de `0109_1`.
 *
 * El suelo de 3 no es estético: con menos votos que eso un porcentaje
 * identifica a quien votó (razonado en la propia migración). Se valida en el
 * servidor ADEMÁS de en la base para que quien se equivoque reciba un 422
 * entendible en vez de un error del motor, no para sustituir al CHECK.
 */
export const MIN_REVELACION_SUELO = 3
export const MIN_REVELACION_TECHO = 10_000

/**
 * Los dos idiomas con banco real.
 *
 * `polls.language` acepta cualquier `^[a-z]{2}$`, pero aceptar 'fr' aquí
 * crearía un carril del feed que no ve nadie: la encuesta se guardaría y
 * `encuesta_siguiente('fr')` sería la única forma de encontrarla.
 */
export const IDIOMAS = ['es', 'en'] as const
export type IdiomaEncuesta = (typeof IDIOMAS)[number]

/**
 * Casillas de opción que ofrece el formulario del panel.
 *
 * Entre 2 y 4. La base admite hasta 5 (`OPCIONES_MAX` de `lib/polls/limites.ts`
 * y el CHECK de `poll_bank.options`); ofrecer cuatro es una decisión de
 * producto, no un límite distinto: por encima de cuatro, la tarjeta del feed
 * obliga a elegir en una lista larga a alguien que la está leyendo de paso, y
 * las respuestas se reparten tanto que la encuesta no revela nunca.
 */
export const CASILLAS_FORMULARIO = 4
