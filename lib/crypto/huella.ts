// ============================================================================
// B10 · Huella de una clave pública y «número de seguridad»
//
// ── QUÉ PROBLEMA RESUELVE ──────────────────────────────────────────────────
// El cifrado extremo a extremo protege el contenido frente a quien mire el
// cable o el dump de la base de datos. NO protege frente a que el propio
// servidor te sirva una clave pública falsa y se ponga en medio. En una web app
// eso no se puede evitar del todo —el servidor sirve también el JavaScript—,
// así que se hace lo único que sí se puede: dar a las dos personas una forma de
// comparar por un canal que Darma no controla (en voz, por otra app, en persona)
// que están hablando con quien creen.
//
// Esa forma es el NÚMERO DE SEGURIDAD. Si a las dos les sale el mismo, nadie se
// ha interpuesto en el intercambio de claves. Si cambia de un día para otro sin
// que la otra persona haya estrenado dispositivo, hay algo que explicar.
//
// ── POR QUÉ RFC 7638 Y NO JSON.stringify ───────────────────────────────────
// `JSON.stringify` de una JWK depende del ORDEN en que el objeto tenga las
// propiedades, y ese orden cambia según quién construya el objeto (WebCrypto,
// `JSON.parse` de la respuesta de PostgREST, un spread…). Con stringify, la
// misma clave daría dos huellas distintas y la app avisaría de un cambio de
// dispositivo que no ha ocurrido — un aviso de seguridad que se dispara solo es
// un aviso que la gente aprende a ignorar. RFC 7638 (JWK Thumbprint) fija los
// campos, el orden y el formato, y es estándar.
// ============================================================================

/**
 * Serialización canónica de una JWK de EC P-256, según RFC 7638 §3.
 *
 * Solo `crv`, `kty`, `x` e `y`, en ese orden (lexicográfico), sin espacios.
 * Cualquier otra propiedad de la JWK (`ext`, `key_ops`, `alg`…) se ignora a
 * propósito: no forman parte de la identidad de la clave y sí cambian según
 * quién la exporte.
 */
export function canonicalizarJwk(jwk: JsonWebKey): string {
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !jwk.x || !jwk.y) {
    throw new Error('se esperaba una JWK pública de EC P-256')
  }
  // La componente privada nunca debe llegar hasta aquí. Si llega, es que algo
  // está a punto de subir una clave privada a algún sitio.
  if ('d' in jwk && jwk.d) {
    throw new Error('la JWK contiene la componente privada')
  }
  return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
}

/**
 * SHA-256 en hex de la JWK canonicalizada. 64 caracteres, estable ante
 * reordenación de las propiedades del objeto.
 */
export async function huella(jwk: JsonWebKey): Promise<string> {
  const datos = new TextEncoder().encode(canonicalizarJwk(jwk))
  const resumen = await crypto.subtle.digest('SHA-256', datos)
  return [...new Uint8Array(resumen)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Los primeros 60 bits de la huella, en tres grupos de cinco dígitos:
 * `"12345 67890 12345"`.
 *
 * Cada grupo son 20 bits reducidos módulo 100 000. El sesgo que introduce ese
 * módulo es irrelevante aquí: esto no es una clave, es una cadena para leer en
 * voz alta, y lo que importa es que sea fácil de dictar sin equivocarse. Los
 * 256 bits completos siguen estando en `fingerprint` para cualquier
 * comparación programática.
 *
 * @param fingerprint 64 caracteres hex, tal cual los devuelve `huella()`.
 */
export function numeroSeguridad(fingerprint: string): string {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) {
    throw new Error('huella inválida')
  }
  const grupos: string[] = []
  for (let i = 0; i < 3; i++) {
    // 5 caracteres hex = 20 bits.
    const trozo = Number.parseInt(fingerprint.slice(i * 5, i * 5 + 5), 16)
    grupos.push(String(trozo % 100000).padStart(5, '0'))
  }
  return grupos.join(' ')
}
