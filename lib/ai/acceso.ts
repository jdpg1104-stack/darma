// ============================================================================
// B11 · Quién es moderador
//
// El panel `/moderacion` y cuatro de las cinco rutas exigen rol de moderador
// comprobado EN EL SERVIDOR. Un flag en el cliente no es un permiso: la anon
// key de Supabase es pública y cualquiera puede hablar con PostgREST
// directamente (ARCHITECTURE §0).
//
// Mientras B19 no defina el rol en la base de datos, la fuente de verdad es
// una allowlist de uuids en `MODERATION_ADMIN_IDS`. Es deliberadamente
// primitiva y deliberadamente temporal — anotado en HANDOFF/PEDIDOS.md.
//
// Falla CERRADO: sin variable configurada, NADIE es moderador. Un panel que se
// abriera solo porque falta una env sería exactamente la clase de fallo que
// este archivo existe para evitar.
// ============================================================================

/** Parsea la allowlist. PURA — aquí viven las pruebas. */
export function parsearAllowlist(valor: string | undefined): ReadonlySet<string> {
  if (!valor) return new Set<string>()
  return new Set(
    valor
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 0),
  )
}

/** ¿Está este uuid en la allowlist? PURA. */
export function esModeradorSegun(userId: string, allowlist: ReadonlySet<string>): boolean {
  if (typeof userId !== 'string' || userId.trim() === '') return false
  return allowlist.has(userId.trim().toLowerCase())
}

/** Comprobación real, contra la variable de entorno del servidor. */
export function esModerador(userId: string): boolean {
  return esModeradorSegun(userId, parsearAllowlist(process.env.MODERATION_ADMIN_IDS))
}
