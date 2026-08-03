// ============================================================================
// La frase del producto, en TEXTO, en toda superficie de pago.
//
// Es un componente y no una cadena copiada cinco veces por la misma razón por
// la que la frase vive en `lib/billing/textos.ts`: cinco copias son cinco
// frases distintas dentro de seis meses, y la última en cambiar acaba
// prometiendo algo que no queríamos prometer.
//
// Server Component puro: cero bytes de JS. Y no es un `aria-label` ni un
// `title` — se LEE, con contraste normal, antes del botón de pagar.
// ============================================================================

import { FRASE_LINEA_ROJA } from '@/lib/billing/textos'

import estilos from './economia.module.css'

export interface FraseLineaRojaProps {
  /** Texto adicional debajo (explicación larga de la superficie concreta). */
  explicacion?: string
}

export function FraseLineaRoja({ explicacion }: FraseLineaRojaProps) {
  return (
    <div className={estilos.lineaRoja}>
      <p>{FRASE_LINEA_ROJA}</p>
      {explicacion ? <p className={estilos.explicacion}>{explicacion}</p> : null}
    </div>
  )
}
