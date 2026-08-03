// FIXTURE de prueba: componente cliente que NO alcanza el cliente admin.
// Sirve para comprobar que el guard no da falsos positivos — un guard que
// marca todo es tan inútil como uno que no marca nada.
'use client'

import { clase } from '../lib/estilos.ts'

export function Boton(etiqueta: string): string {
  return `${clase()}:${etiqueta}`
}
