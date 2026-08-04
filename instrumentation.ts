// ============================================================================
// Arranque del servidor — el informe de configuración
//
// `register()` lo llama Next.js UNA vez, antes de servir la primera petición.
// Es el único sitio desde el que se puede avisar antes de que alguien se coma
// el primer `error_interno` sin explicación.
//
// ── POR QUÉ ESTO NO LANZA NUNCA ────────────────────────────────────────────
// Es tentador abortar el arranque ante un problema bloqueante. No se hace, por
// dos razones, y la segunda es la que manda:
//
//   1. Parte del diagnóstico sale de PREGUNTARLE a Supabase. Tumbar el arranque
//      porque una sonda de red falló convierte un corte pasajero de
//      conectividad en una caída, que es peor que el fallo que se avisaba.
//
//   2. `/ayuda` funciona sin sesión, sin JS y sin base de datos: es HTML con los
//      teléfonos de crisis. Es exactamente la pantalla que tiene que seguir en
//      pie cuando todo lo demás está roto. Un proceso que se niega a arrancar
//      porque falta la clave del clasificador se lleva por delante la única
//      página que de verdad no puede faltar.
//
// La app ya falla de forma ruidosa donde toca: `createAdminClient()` lanza si no
// hay clave. Lo que faltaba no era el fallo, era el DIAGNÓSTICO.
//
// El cuerpo vive en `lib/config/arranque.ts` y se carga con un import dinámico
// DESPUÉS de comprobar el runtime: ese archivo usa `node:fs` y, si se alcanzara
// estáticamente desde aquí, Turbopack lo avisaría en cada petición al compilar
// la variante edge de este mismo archivo.
// ============================================================================

export async function register(): Promise<void> {
  // El proxy (edge) no toca ninguna de estas variables, así que comprobar dos
  // veces solo duplicaría el informe.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return

  const { informarDeConfiguracion } = await import('./lib/config/arranque.ts')
  await informarDeConfiguracion()
}
