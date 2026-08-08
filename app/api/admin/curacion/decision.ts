// ============================================================================
// La decisión de curación, sin base de datos y sin red
//
// ── POR QUÉ VIVE APARTE DE LA RUTA ────────────────────────────────────────
// Lo que importa de esta ruta no es el `UPDATE`: es qué combinaciones se
// rechazan. Aprobar una charla de 87 minutos sin elegir el momento, recortar lo
// que se está descartando, mandar medio fragmento… son seis caminos de fallo, y
// probarlos contra la ruta exigiría una sesión de moderador, un cliente admin y
// una fila real cada vez. Aquí se prueban los seis en milisegundos.
//
// La ruta conserva lo que solo ella puede hacer: leer la duración de la BASE
// —nunca del cuerpo, o quien cura se saltaría la regla declarando una duración
// cómoda— y aplicar el cambio con la condición de estado que evita que dos
// moderadores se pisen.
//
// LA BARRERA FINAL SIGUE SIENDO EL ESQUEMA. Los CHECK de
// `0224_1_b07_clips.sql` rechazan lo mismo aunque esto se saltara entero. Esto
// existe para dar un mensaje que se pueda leer, no para ser la defensa.
// ============================================================================

// Relativo y con extensión, como el resto de módulos de `app/**` que tienen
// prueba propia: `node --test` los ejecuta sin el mapeo de rutas de tsconfig.
import { clipValido, exigeFragmento } from '../../../../lib/video/acreditacion.ts'

export type Decision = 'aprobar' | 'rechazar' | 'recortar'

export interface EntradaDecision {
  decision: Decision
  /** Lo que trae el cuerpo. `null` en ambos = sin fragmento. */
  inicioSegundos: number | null
  finSegundos: number | null
  /** Obligatorio al rechazar. */
  motivo?: string | undefined
  /** Lo que dice la BASE, no el cliente. `null` = no consta. */
  duracionSegundos: number | null
}

/**
 * `null` = adelante. Si no, la clave de catálogo del motivo del 422.
 *
 * Devuelve la clave y no un mensaje ya resuelto porque el cliente pinta en su
 * idioma (CONTRATOS §4): una frase en español viajando a una pantalla en inglés
 * es exactamente la divergencia que cerró B00b.
 */
export function motivoDeRechazo(entrada: EntradaDecision): string | null {
  const { decision, inicioSegundos, finSegundos, motivo, duracionSegundos } = entrada
  const conFragmento = inicioSegundos !== null || finSegundos !== null

  if (decision === 'rechazar') {
    if (!motivo || motivo.trim().length < 3) return 'admin.curacion.motivoObligatorio'
    // Recortar lo que se descarta no significa nada, y aceptarlo en silencio
    // haría creer que se guardó.
    if (conFragmento) return 'admin.curacion.fragmentoAlRechazar'
    return null
  }

  if (conFragmento && !clipValido(inicioSegundos, finSegundos, duracionSegundos)) {
    return 'admin.curacion.fragmentoInvalido'
  }

  // LA REGLA. Una charla de 87 minutos aprobada sin fragmento vuelve a poner en
  // el feed justo lo que este trabajo vino a arreglar, y además con un objetivo
  // de karma de 78 minutos que no alcanza nadie.
  if (!conFragmento && exigeFragmento(duracionSegundos)) {
    return 'admin.curacion.fragmentoObligatorio'
  }

  return null
}

/**
 * El estado en el que tiene que estar la fila para que la decisión valga.
 *
 * `recortar` actúa sobre lo YA aprobado —es la deuda de lo que se aprobó antes
 * de que el fragmento existiera—; aprobar y rechazar, sobre lo pendiente.
 */
export function estadoDePartida(decision: Decision): 'pending' | 'approved' {
  return decision === 'recortar' ? 'approved' : 'pending'
}

/** El estado en el que queda, o `null` si la decisión no cambia el estado. */
export function estadoResultante(decision: Decision): 'approved' | 'rejected' | null {
  if (decision === 'aprobar') return 'approved'
  if (decision === 'rechazar') return 'rejected'
  return null // recortar no reabre ni cierra nada: solo encuadra
}
