// ============================================================================
// Datos de la petición que B01 necesita: origen y país
//
// Los dos son datos personales y ninguno de los dos sale nunca en una respuesta
// (CONTRATOS §2 prohíbe explícitamente `ip` y `country` a nivel de usuario).
// Aquí solo se usan para:
//   · la IP → una CLAVE DE CONTADOR, siempre hasheada (lib/auth/identidad.ts).
//     La clave se persiste en `rate_limits`, y ahí no puede haber una IP.
//   · el país → `identity_vault.country_code`, la tabla sin políticas RLS. Está
//     ahí porque las líneas de ayuda de crisis son nacionales y hay que poder
//     demostrar que se mostró la correcta (ver crisis_events en 0002).
// ============================================================================

/**
 * IP de origen, tal y como la reporta el borde.
 *
 * `x-forwarded-for` puede traer una cadena de proxies; el primer elemento es el
 * cliente. Es falsificable por quien controle la cadena, así que sirve para
 * repartir contadores, NO para autorizar nada.
 */
export function ipDePeticion(request: Request): string | null {
  const reenviada = request.headers.get('x-forwarded-for')
  if (reenviada) {
    const primera = reenviada.split(',')[0]?.trim()
    if (primera) return primera
  }
  return request.headers.get('x-real-ip')
}

/**
 * Código de país ISO-3166-1 alfa-2 que inyecta el borde de Vercel.
 *
 * Se normaliza y se valida el formato porque va directo a una columna y porque
 * una cabecera es entrada del exterior aunque la ponga la plataforma.
 */
export function paisDePeticion(request: Request): string | null {
  const crudo = request.headers.get('x-vercel-ip-country')?.trim().toUpperCase()
  if (!crudo || !/^[A-Z]{2}$/.test(crudo)) return null
  return crudo
}

/** Origen canónico del despliegue, para construir el `emailRedirectTo`. */
export function urlDelSitio(request: Request): string {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (configurada) return configurada
  // Fallback al origen de la petición: en un preview sin variable configurada,
  // el enlace debe volver al despliegue desde el que se pidió, no a producción.
  return new URL(request.url).origin
}
