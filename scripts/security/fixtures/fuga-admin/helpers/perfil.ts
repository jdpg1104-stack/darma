// FIXTURE de prueba. Salto intermedio 2 de 2: aquí es donde alguien añadió
// "una funcioncita de conveniencia" a un módulo que ya se importaba desde
// cliente, y con ella arrastró el cliente admin al bundle del navegador.
import { createAdminClient } from '../lib/supabase/admin.ts'

export function cargarPerfil(valor: string): string {
  return createAdminClient() + valor
}
