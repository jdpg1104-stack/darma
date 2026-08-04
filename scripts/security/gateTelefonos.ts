// ============================================================================
// El freno de producción de los teléfonos de crisis
//
// `tablaListaParaProduccion()` existe desde B17 y devuelve `false` porque
// NINGUNO de los 24 números está confirmado por una persona. Hasta hoy no la
// llamaba nadie: el único freno para desplegar con teléfonos sin verificar era
// que alguien se acordara. Esto la cablea.
//
// Un número equivocado en una pantalla de crisis es PEOR que no mostrar número:
// quien marca y no le contesta nadie ya ha gastado el impulso de pedir ayuda.
//
// ── DÓNDE SE ENGANCHA, Y POR QUÉ NO EN EL CI ───────────────────────────────
// Va en `prebuild`, que npm ejecuta antes de `build`. Vercel construye con
// `npm run build` y `vercel.json` solo despliega `main`, así que esto es lo
// último que pasa antes de que la app llegue a producción — y lo detiene ahí.
//
// La alternativa evidente era un job de CI que fallara. Se descartó: la tabla va
// a estar sin verificar durante semanas, así que ese job dejaría `main` en ROJO
// PERMANENTE. Un CI que siempre está rojo no es un freno, es ruido: la gente
// aprende a fusionar por encima de él y el día que se rompa algo de verdad nadie
// lo mira. El CI INFORMA (paso «Teléfonos de crisis», siempre verde) y el build
// de producción es el que EXIGE.
//
// Efecto por entorno:
//   · `npm run build` en local  → informa y pasa
//   · build de CI               → informa y pasa (no hay VERCEL_ENV)
//   · preview de Vercel         → informa y pasa
//   · PRODUCCIÓN en Vercel      → FALLA y no se despliega
//
// ── QUÉ MIRA, ADEMÁS DE LO PENDIENTE ───────────────────────────────────────
// También los CADUCADOS. Un teléfono verificado hace dos años es tan peligroso
// como uno sin verificar: las líneas de ayuda cambian de número, de horario y de
// financiación. `tablaListaParaProduccion()` no los mira —solo cuenta los que
// nunca se verificaron— así que aquí se comprueban las dos cosas.
// ============================================================================

import {
  idDeRecurso,
  recursosCaducados,
  recursosPendientesDeVerificacion,
  tablaListaParaProduccion,
  VENTANA_VERIFICACION_DIAS,
} from '../../i18n/recursosCrisis.ts'

export interface EstadoGate {
  /** ¿Se puede desplegar a producción con esta tabla? */
  readonly listo: boolean
  /** ¿Este build va a producción? Si no, el gate informa pero no detiene. */
  readonly exigido: boolean
  /** `PAIS·nombre` de cada recurso que nunca verificó una persona. */
  readonly pendientes: readonly string[]
  /** `PAIS·nombre` de cada recurso cuya verificación ha caducado. */
  readonly caducados: readonly string[]
}

/**
 * ¿Este build acaba en producción?
 *
 * `VERCEL_ENV` vale `production`, `preview` o `development`, y solo lo pone
 * Vercel. `DARMA_EXIGIR_TELEFONOS=1` permite forzarlo a mano para probar el
 * freno sin desplegar.
 */
export function esBuildDeProduccion(
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  return env.VERCEL_ENV === 'production' || env.DARMA_EXIGIR_TELEFONOS === '1'
}

export function evaluarGate(
  env: Readonly<Record<string, string | undefined>> = process.env,
  hoy: Date = new Date(),
): EstadoGate {
  const pendientes = recursosPendientesDeVerificacion().map(idDeRecurso)
  const caducados = recursosCaducados(hoy).map(idDeRecurso)

  return {
    // `tablaListaParaProduccion()` es la fuente de verdad de lo pendiente; los
    // caducados se suman aquí porque ella no los mira.
    listo: tablaListaParaProduccion() && caducados.length === 0,
    exigido: esBuildDeProduccion(env),
    pendientes,
    caducados,
  }
}

/** Informe para la consola. Nunca vacío: el silencio no informa de nada. */
export function formatearGate(estado: EstadoGate): string {
  if (estado.listo) {
    return '[darma] Teléfonos de crisis: los 24 verificados y dentro de la ventana de frescura.'
  }

  const lineas: string[] = ['', '═'.repeat(78), '  TELÉFONOS DE CRISIS SIN VERIFICAR', '']

  if (estado.pendientes.length > 0) {
    lineas.push(`  ${estado.pendientes.length} sin confirmar por una persona:`, '')
    lineas.push(...estado.pendientes.map((id) => `    · ${id}`))
    lineas.push('')
  }

  if (estado.caducados.length > 0) {
    lineas.push(`  ${estado.caducados.length} con la verificación caducada (>${VENTANA_VERIFICACION_DIAS} días):`, '')
    lineas.push(...estado.caducados.map((id) => `    · ${id}`))
    lineas.push('')
  }

  lineas.push(
    '  Para registrar una verificación: confirma el número con la organización,',
    '  pon tu nombre en `verificadoPor`, la fecha de hoy en `verificadoEn` y quita',
    '  su línea de `PENDIENTES_DECLARADOS` (i18n/recursosCrisis.ts).',
    '',
    estado.exigido
      ? '  ⛔ ESTE BUILD VA A PRODUCCIÓN Y SE DETIENE AQUÍ. Un número muerto en una\n     pantalla de crisis es peor que no mostrar ninguno.'
      : '  Este build no va a producción, así que solo se informa. El despliegue a\n  producción SÍ se detendrá mientras quede algo en estas listas.',
    '',
    '═'.repeat(78),
    '',
  )

  return lineas.join('\n')
}

/** @returns el código de salida del proceso. */
export function ejecutar(
  env: Readonly<Record<string, string | undefined>> = process.env,
  hoy: Date = new Date(),
): number {
  const estado = evaluarGate(env, hoy)
  const informe = formatearGate(estado)

  if (estado.listo) {
    console.warn(informe)
    return 0
  }

  if (estado.exigido) {
    console.error(informe)
    return 1
  }

  console.warn(informe)
  return 0
}

// Solo cuando se invoca como script. Importado desde su prueba, `process.argv[1]`
// es el runner y esto no dispara.
const invocado = (process.argv[1] ?? '').replace(/\\/g, '/')
if (invocado.endsWith('scripts/security/gateTelefonos.ts')) {
  process.exitCode = ejecutar()
}
