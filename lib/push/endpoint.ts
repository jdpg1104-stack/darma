// ============================================================================
// B13 · Validación del endpoint de suscripción
//
// ── POR QUÉ NO BASTA CON «QUE SEA UNA URL» ─────────────────────────────────
// El endpoint es la dirección a la que NUESTRO SERVIDOR hace un POST. Aceptar
// uno arbitrario convierte la ruta `/api/push/subscribe` en un proxy de
// peticiones salientes: SSRF de manual. Con él se alcanzan los metadatos de la
// nube (`169.254.169.254`), servicios internos que solo escuchan en la red
// privada, y cualquier host que el atacante quiera hacer sonar desde nuestra IP.
//
// Dos barreras, y hacen falta las dos:
//   1. `https:` obligatorio. Los cuatro servicios reales lo usan; `http:` solo
//      lo pide quien apunta a algo interno.
//   2. Allowlist de hosts. Una DENYlist de rangos privados no sirve: el DNS de
//      un dominio ajeno puede resolver a 127.0.0.1 y la comprobación se hace
//      sobre el nombre, no sobre la IP a la que se conectará después.
//
// La allowlist se queda corta a propósito. Si mañana aparece un navegador con
// otro servicio de push, sus usuarios no podrán suscribirse hasta que alguien
// añada el host aquí — y ese «no funciona» es preferible al agujero.
// ============================================================================

/**
 * Hosts de los servicios de push de los navegadores reales.
 *
 * Se comparan por SUFIJO de dominio y con un punto delante (`.mozilla.com`),
 * nunca con `endsWith('mozilla.com')` a secas: sin el punto,
 * `evil-mozilla.com` pasaría el filtro.
 */
const HOSTS_EXACTOS: readonly string[] = [
  'fcm.googleapis.com', // Chrome / Chromium / Brave
  'web.push.apple.com', // Safari (macOS e iOS 16.4+)
]

const SUFIJOS_PERMITIDOS: readonly string[] = [
  '.push.services.mozilla.com', // Firefox (updates.push.services.mozilla.com)
  '.notify.windows.com', // Edge / WNS
  '.push.apple.com', // Safari, variantes regionales
  '.googleapis.com', // FCM v1 y variantes de Chrome
]

/** Longitud máxima. Los endpoints reales rondan los 200 caracteres; 1024 deja
 *  margen de sobra y evita que la tabla almacene basura de kilobytes. */
export const LONGITUD_MAXIMA_ENDPOINT = 1024

export function hostPermitido(host: string): boolean {
  const h = host.toLowerCase()
  if (HOSTS_EXACTOS.includes(h)) return true
  return SUFIJOS_PERMITIDOS.some((sufijo) => h.endsWith(sufijo))
}

/**
 * ¿Es un endpoint de push aceptable?
 *
 * Devuelve booleano y no lanza: quien llama lo traduce a `entrada_invalida`, y
 * el mensaje que ve la persona no dice qué falló exactamente. Explicar «ese
 * host no está en la lista» le enseña al atacante dónde está la frontera.
 */
export function endpointValido(valor: unknown): valor is string {
  if (typeof valor !== 'string') return false
  if (valor.length === 0 || valor.length > LONGITUD_MAXIMA_ENDPOINT) return false

  let url: URL
  try {
    url = new URL(valor)
  } catch {
    return false
  }

  if (url.protocol !== 'https:') return false
  // Credenciales embebidas (`https://user:pass@host/`) son una señal de
  // confusión de parseo y no aparecen en ningún endpoint legítimo.
  if (url.username !== '' || url.password !== '') return false

  return hostPermitido(url.hostname)
}
