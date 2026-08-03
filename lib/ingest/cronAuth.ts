// ============================================================================
// B08 · Autenticación de las rutas de cron — RE-EXPORTA `lib/cronAuth.ts`
//
// `/api/cron/` es público en `proxy.ts`: los disparos llegan de una máquina,
// sin navegador y sin cookie de sesión, así que el proxy no puede
// autenticarlos. La consecuencia es que CADA handler se autentica solo, y si
// uno se olvida, cualquiera con la URL dispara la ingesta y agota la cuota de
// moderación —o peor, la usa como amplificador contra YouTube desde nuestra IP—.
//
// AQUÍ YA NO HAY IMPLEMENTACIÓN. La comparación en tiempo constante y la regla
// de fail-closed viven en `lib/cronAuth.ts`, que es también de donde tira
// `lib/ranking/cronAuth.ts`. Había dos copias de la misma función de seguridad,
// y dos copias significa que un arreglo puede quedarse en una.
//
// Este fichero se conserva —en vez de borrarlo y reescribir los imports— porque
// los handlers que lo importan son de otros bloques: `app/api/cron/content/**`,
// `app/api/polls/reponer/route.ts` y `lib/cron/ruta.ts`. El alias no cuesta
// nada y el punto —una sola implementación— queda igual de cumplido.
// ============================================================================

export { esCronAutorizado, secretoCron } from '../cronAuth.ts'
