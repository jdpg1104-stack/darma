'use client'

// ============================================================================
// Esqueleto del hilo. Cuatro filas: la forma aproximada de un post y un par de
// respuestas, para que el contenido no dé un salto al llegar.
//
// `'use client'` por el idioma: un `loading.tsx` es el fallback de un Suspense y
// tiene que poder pintarse sin suspender, así que no puede ser un Server
// Component asíncrono esperando a `resolverLocale()`. Con el contexto del
// proveedor el texto sale del catálogo sin ninguna espera.
// ============================================================================

import { Cargando } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'

export default function CargandoHilo() {
  const t = useTraductor()

  return (
    <main>
      <Cargando variante="esqueleto" filas={4} etiqueta={t('hilo.abriendo')} />
    </main>
  )
}
