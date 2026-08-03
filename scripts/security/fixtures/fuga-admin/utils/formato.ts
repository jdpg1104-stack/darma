// FIXTURE de prueba. Salto intermedio 1 de 2.
import { cargarPerfil } from '../helpers/perfil.ts'

export function formatear(valor: string): string {
  return cargarPerfil(valor).trim()
}
