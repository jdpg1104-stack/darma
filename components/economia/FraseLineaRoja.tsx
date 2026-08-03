// ============================================================================
// La frase del producto, en TEXTO, en toda superficie de pago.
//
// Es un componente y no una cadena copiada cinco veces por la misma razón por
// la que la frase vive en `lib/billing/textos.ts`: cinco copias son cinco
// frases distintas dentro de seis meses, y la última en cambiar acaba
// prometiendo algo que no queríamos prometer.
//
// Server Component: cero bytes de JS. Y no es un `aria-label` ni un `title`
// — se LEE, con contraste normal, antes del botón de pagar.
//
// ── LA FRASE SALE DEL CATÁLOGO, NO DE `lib/billing/textos.ts` ──────────────
// Mismo argumento de una sola fuente, con un idioma más: si la frase viviera
// como constante en español, en inglés la línea roja del producto no se diría.
// Una promesa que solo existe en un idioma no es la promesa, es la mitad.
// La clave es `karma.economia.lineaRoja` y `lib/billing/lineaRoja.test.ts`
// sigue comprobando que este componente aparece en las cuatro superficies de
// pago.
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'

import estilos from './economia.module.css'

export interface FraseLineaRojaProps {
  /** Texto adicional debajo (explicación larga de la superficie concreta). */
  explicacion?: string
}

export async function FraseLineaRoja({ explicacion }: FraseLineaRojaProps) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <div className={estilos.lineaRoja}>
      <p>{t('karma.economia.lineaRoja')}</p>
      {explicacion ? <p className={estilos.explicacion}>{explicacion}</p> : null}
    </div>
  )
}
