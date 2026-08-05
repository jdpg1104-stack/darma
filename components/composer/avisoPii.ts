// ============================================================================
// Aviso de PII EN EL CLIENTE — cortesía, no barrera
//
// Este módulo NO decide nada. La barrera es `assertNoPii()` en el servidor
// (`POST /api/posts`), que bloquea con `contenido_bloqueado`. Aquí solo se
// avisa con amabilidad ANTES de enviar, para que nadie reciba el rechazo del
// servidor en frío después de haber puesto en palabras algo difícil.
//
// Los patrones viven en `lib/pii.ts` —puro e isomorfo, sin `node:crypto`— y se
// usan vía `detectPii()`: cliente y servidor ven EXACTAMENTE lo mismo, así que
// este aviso no puede quedarse atrás respecto a la barrera real. (Hasta
// 2026-08 este archivo duplicaba las cuatro expresiones porque
// `lib/anonymity.ts` arrastraba `node:crypto` al bundle del navegador; el
// pedido «De B03 → F3» de HANDOFF/PEDIDOS.md se cerró partiendo ese módulo.)
// ============================================================================

import { detectPii, type PiiKind } from '@/lib/pii'
import type { Traductor } from '@/i18n'

export type TipoPii = PiiKind

/**
 * Claves del catálogo con el mensaje de cara a la persona: explican, no regañan
 * y no acusan. El texto vive en `messages/`, no aquí: esta pantalla se ve en los
 * dos idiomas y el aviso llega justo cuando alguien está a punto de publicar.
 */
const CLAVES: Readonly<Record<TipoPii, string>> = {
  email: 'publicar.pii.email',
  phone: 'publicar.pii.phone',
  handle: 'publicar.pii.handle',
  url: 'publicar.pii.url',
}

/**
 * Aviso, o `null` si no hay nada que avisar. No bloquea el envío: quien quiera
 * mandarlo igual se topará con el servidor, y quien tenga un falso positivo
 * («llevo 123456789 días así») no se queda sin publicar por culpa de una
 * expresión regular.
 *
 * Usa `detectPii()` —la misma función que el servidor— así que hereda su
 * deduplicación (un email no se avisa además como handle) y su orden por
 * posición en el texto, igual que el mensaje de `PiiDetectedError`.
 *
 * El traductor entra por parámetro y no se resuelve aquí dentro: este módulo es
 * una función pura sobre un texto, y `useTraductor()` es un hook que solo puede
 * llamarse desde el componente.
 */
export function avisoDePii(texto: string, t: Traductor): string | null {
  const tipos = [...new Set(detectPii(texto).map((hallazgo) => hallazgo.kind))]

  if (tipos.length === 0) return null

  return `${tipos.map((tipo) => t(CLAVES[tipo])).join(' ')} ${t('publicar.pii.cierre')}`
}
