// FIXTURE de prueba, no es código de producción.
// Componente cliente que NO importa el admin directamente: llega a él a través
// de dos saltos. Es la forma que tiene la fuga real, y la que un guard de
// imports directos no vería.
'use client'

import { formatear } from '../utils/formato.ts'

export function Tarjeta(valor: string): string {
  return formatear(valor)
}
