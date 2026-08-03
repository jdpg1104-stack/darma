// ============================================================================
// RachaDias — lectura de una columna. Nunca un cálculo.
//
// El número viene de `profiles.streak_days`, mantenido por el trigger
// `trg_karma_events_racha` (migración 0105). La alternativa —contar días
// distintos en el ledger en cada carga del perfil— funciona con 30 eventos y
// muere con 30 000 (Trampa #4 de la ficha).
//
// ── COPY: LA RACHA NO SE CELEBRA NI SE AMENAZA ─────────────────────────────
// Aquí no hay «¡No pierdas tu racha!» ni fuego ni contador regresivo. Ese
// patrón funciona en una app de idiomas y es dañino en una de salud emocional:
// convierte acompañar a alguien en una obligación con castigo, y el día que la
// persona está demasiado mal para entrar, la app la culpa por ello. Se cuenta
// lo que ha hecho, en pasado, y se calla.
//
// Server Component.
// ============================================================================

import { obtenerTraductor, resolverLocale } from '@/i18n'
import type { ResumenKarma } from './tipos.ts'
import estilos from './perfil.module.css'

export interface RachaDiasProps {
  racha: ResumenKarma['racha']
}

export async function RachaDias({ racha }: RachaDiasProps) {
  if (racha.dias <= 0) return null

  const t = obtenerTraductor(await resolverLocale())

  return (
    <p className={estilos.racha}>
      <span className={estilos.rachaNumero}>{racha.dias}</span>
      <span>
        {t('perfil.rachaDias', { n: racha.dias })}
        {racha.activaHoy ? '' : t('perfil.rachaHastaAyer')}
      </span>
    </p>
  )
}
