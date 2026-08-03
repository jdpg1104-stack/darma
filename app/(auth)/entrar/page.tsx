// ============================================================================
// /entrar — la puerta.
//
// Server Component: no tiene estado propio. Lo único interactivo es
// `PanelEntrada`, que es la hoja más pequeña posible del árbol (CONTRATOS §1).
//
// Es ruta PÚBLICA en el proxy, y tiene que serlo: si exigiera sesión, entrar
// sería imposible. El propio proxy redirige a `/feed` a quien ya tiene sesión,
// así que aquí no hace falta comprobarlo otra vez.
// ============================================================================

import type { Metadata } from 'next'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { PanelEntrada } from '@/components/auth/PanelEntrada'

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('auth.entrar'),
    // Esta pantalla no aporta nada a un buscador y sí revela la estructura de
    // la app. Fuera del índice.
    robots: { index: false, follow: false },
  }
}

export default async function PaginaEntrar({
  searchParams,
}: {
  // En Next 16 los searchParams de una página son asíncronos.
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  // Solo se propaga un identificador de motivo OPACO, nunca un mensaje que
  // venga de la URL: pintar texto arbitrario de un parámetro es cómo se
  // construye una pantalla de phishing dentro de tu propio dominio.
  const motivo = error === 'enlace' ? 'enlace' : undefined

  return <PanelEntrada errorInicial={motivo} />
}
