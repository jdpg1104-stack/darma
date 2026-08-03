// ============================================================================
// B06 · Autenticación de POST /api/ranking/snapshot — RE-EXPORTA `lib/cronAuth.ts`
//
// La ruta del constructor se autentica SOLO con `Authorization: Bearer
// <CRON_SECRET>`: sin sesión y sin cookie, porque el disparo llega de una
// máquina de Vercel Cron y no de un navegador. Fail-closed (sin `CRON_SECRET`
// en el entorno, 401 SIEMPRE) y comparación en tiempo constante.
//
// ── QUÉ CAMBIÓ Y POR QUÉ ───────────────────────────────────────────────────
// Este fichero tenía su propia copia de la comparación, con esta nota: «B08
// tiene un helper idéntico y es tentador reutilizarlo; no se hace porque
// `lib/ingest/**` es propiedad exclusiva de B08». El razonamiento era correcto
// —el cron del ranking no debe depender de la ingesta de contenido— pero la
// conclusión no: la salida no era duplicar, era subir la función a `lib/`, que
// no es de nadie. Es lo que hay ahora. Las dos copias ya habían empezado a
// divergir en el relleno del búfer, que es cómo empieza siempre el fallo de
// «se arregló en una y no en la otra».
//
// Los nombres locales (`esCronRankingAutorizado`, `secretoCronRanking`) se
// mantienen como alias para no tocar `app/api/ranking/snapshot/route.ts`, que
// es de otro bloque. Son la MISMA función, no una variante.
// ============================================================================

export {
  esCronAutorizado as esCronRankingAutorizado,
  secretoCron as secretoCronRanking,
} from '../cronAuth.ts'
