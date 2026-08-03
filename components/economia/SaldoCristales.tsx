// ============================================================================
// Saldo de cristales. Server Component puro.
//
// ── DE DÓNDE SALE EL NÚMERO ─────────────────────────────────────────────────
// De `profiles.crystals` (vía `mi_cupo_boost()` o `mi_perfil_privado()`),
// **nunca de un `sum()` sobre `crystal_ledger`**. El `sum()` es la herramienta
// de reconciliación de un cron nocturno; usarlo para pintar una pantalla haría
// que el coste de mostrar el saldo creciera con el historial de la persona.
//
// El saldo es PRIVADO (CONTRATOS §2): solo aparece en respuestas dirigidas a
// uno mismo. Este componente nunca recibe el saldo de otra persona porque no
// hay forma de pedirlo — `authenticated` no tiene privilegio de columna sobre
// `profiles.crystals`.
// ============================================================================

import estilos from './economia.module.css'

export interface SaldoCristalesProps {
  cristales: number
  /** Karma gastable, para poder enseñar las dos monedas juntas. */
  karmaSpendable?: number
}

export function SaldoCristales({ cristales, karmaSpendable }: SaldoCristalesProps) {
  return (
    <p className={estilos.saldo}>
      <span className={estilos.saldoCifra}>{cristales}</span>
      <span>{cristales === 1 ? 'cristal' : 'cristales'}</span>
      {typeof karmaSpendable === 'number' ? (
        <>
          <span aria-hidden="true">·</span>
          <span className={estilos.saldoCifra}>{karmaSpendable}</span>
          <span>de karma</span>
        </>
      ) : null}
    </p>
  )
}
