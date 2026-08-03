// FIXTURE de prueba. Imita a lib/supabase/admin.ts: es el destino prohibido.
export function createAdminClient(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
}
