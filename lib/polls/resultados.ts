// ============================================================================
// De la fila de Postgres al contrato público. PURO: sin red, sin reloj, sin DB.
//
// ── DÓNDE SE DECIDE EL UMBRAL, Y DÓNDE NO ──────────────────────────────────
// Aquí NO. `encuesta_resultados()` ya devuelve `vote_count: null` en todas las
// opciones cuando `total_votes < min_reveal`, y lo hace dentro del motor porque
// una regla que solo viva en una ruta de Next se salta con un curl a PostgREST
// (ARCHITECTURE §0). Este módulo comprueba lo mismo por segunda vez y se queda
// con el resultado más restrictivo de los dos. No es paranoia decorativa: si
// alguien reescribe la función SQL y se le olvida el `case`, el fallo tiene que
// notarse en un test de TypeScript y no en producción.
//
// ── POR QUÉ EL REPARTO DE RESTO Y NO Math.round ────────────────────────────
// Con 3 opciones y 7 votos (3/2/2), redondear cada porcentaje por su cuenta da
// 43 / 29 / 29 = 101 %. Un total que no suma 100 en una tarjeta que dice "así
// respondió la gente" es una tarjeta que miente, y en una encuesta de bienestar
// lo que la gente saca de ahí es si lo suyo es raro.
//
// Se usa el método del RESTO MAYOR (Hamilton): parte entera para todos y el
// sobrante a quien tenga la mayor parte fraccionaria. Empate → gana el `ordinal`
// más bajo, que es una regla estable: el orden de las opciones no cambia nunca
// (por eso `poll_options` tiene `unique (poll_id, ordinal)`), así que el mismo
// recuento produce siempre exactamente los mismos porcentajes.
// ============================================================================

import type { EncuestaFeed, FilaEncuesta, OpcionEncuesta } from './tipos.ts'

/**
 * Reparte 100 puntos entre los recuentos por el método del resto mayor.
 *
 * @param votos recuentos por opción, en orden de `ordinal`.
 * @returns porcentajes enteros que suman exactamente 100 (o todo ceros si no
 *          hay ni un voto: 0 % no es una mentira, 100/n sí lo sería).
 */
export function repartirPorcentajes(votos: readonly number[]): number[] {
  const total = votos.reduce((a, b) => a + b, 0)
  if (total <= 0) return votos.map(() => 0)

  const exactos = votos.map((v) => (v * 100) / total)
  const enteros = exactos.map(Math.floor)
  let sobrante = 100 - enteros.reduce((a, b) => a + b, 0)

  // Índices ordenados por resto descendente; el empate lo rompe el ordinal
  // (que es la posición en el array), no el azar ni el orden de llegada.
  const porResto = exactos
    .map((exacto, indice) => ({ indice, resto: exacto - Math.floor(exacto) }))
    .sort((a, b) => (b.resto - a.resto) || (a.indice - b.indice))

  for (const { indice } of porResto) {
    if (sobrante <= 0) break
    enteros[indice] += 1
    sobrante -= 1
  }

  return enteros
}

/**
 * Proyecta la fila de Postgres al contrato público, campo a campo.
 *
 * Nunca con spread: un `{ ...fila }` publicaría cualquier columna que alguien
 * añada mañana al `jsonb` de la función.
 */
export function aEncuestaFeed(fila: FilaEncuesta): EncuestaFeed {
  const opciones = [...(fila.options ?? [])].sort((a, b) => a.ordinal - b.ordinal)

  // Doble llave: el umbral que ya aplicó Postgres, y el mismo cálculo aquí.
  // Con que una de las dos diga "todavía no", no se publica nada.
  const porUmbral = fila.total_votes >= fila.min_reveal
  const hayRecuentos = opciones.length > 0 && opciones.every((o) => typeof o.vote_count === 'number')
  const revelado = porUmbral && hayRecuentos

  const porcentajes = revelado
    ? repartirPorcentajes(opciones.map((o) => o.vote_count ?? 0))
    : []

  const opcionesPublicas: OpcionEncuesta[] = opciones.map((o, i) => ({
    id: o.id,
    ordinal: o.ordinal,
    label: o.label,
    votos: revelado ? (o.vote_count ?? 0) : null,
    porcentaje: revelado ? porcentajes[i] : null,
  }))

  return {
    id: fila.id,
    pregunta: fila.question,
    opciones: opcionesPublicas,
    totalVotos: fila.total_votes,
    revelado,
    miVoto: fila.mi_voto,
    cierraEn: fila.closes_at,
    origen: fila.origin,
  }
}

/**
 * ¿El `jsonb` que devolvió Postgres tiene la forma que esperamos?
 *
 * Las funciones devuelven `null` cuando no hay sesión o la encuesta no existe,
 * y `supabase-js` tipa `data` como `unknown`. Sin esta comprobación, un cambio
 * en la función SQL se manifestaría como un `undefined` paseándose por la UI en
 * vez de como un 404 honesto.
 */
export function esFilaEncuesta(valor: unknown): valor is FilaEncuesta {
  if (typeof valor !== 'object' || valor === null) return false
  const v = valor as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.question === 'string' &&
    typeof v.total_votes === 'number' &&
    typeof v.min_reveal === 'number' &&
    (v.origin === 'usuario' || v.origin === 'banco') &&
    Array.isArray(v.options)
  )
}
