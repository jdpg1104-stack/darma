// ============================================================================
// B13 · VAPID · la feature se apaga entera y EN SILENCIO si no hay llaves
//
// ── EL ESTADO «SIN LLAVES» ES UN ESTADO NORMAL, NO UN ERROR ────────────────
// Hoy, en este repositorio, es el estado real: no existen `VAPID_PUBLIC_KEY` ni
// `VAPID_PRIVATE_KEY`. La consecuencia tiene que ser exactamente esta:
//   · `pushConfigurado()` devuelve false,
//   · `/api/push/key` devuelve `{publicKey: null}` con **200**,
//   · la UI de opt-in no se pinta (no hay nada que ofrecer),
//   · `enviarA()` devuelve `'error'` y NO lanza,
//   · ninguna ruta devuelve 500 y ningún arranque falla.
//
// Es lo contrario de lo que suele hacerse (lanzar al arrancar «para que se note
// que falta la config»). Aquí un throw en el arranque tumbaría la app entera —
// incluido `/ayuda`, la pantalla de recursos de crisis — por una función
// secundaria que todavía no se ha provisionado. Producción segura hasta que
// existan las llaves.
//
// ── CÓMO SE GENERAN LAS LLAVES ─────────────────────────────────────────────
// Con la dependencia `web-push` (ver PEDIDOS.md, aún no instalada):
//
//     npx web-push generate-vapid-keys --json
//     # → { "publicKey": "BN...", "privateKey": "k9..." }
//
// Sin instalarla, con Node puro (P-256, base64url sin relleno, que es lo que
// exige RFC 8292):
//
//     node -e "const c=require('node:crypto');\
//     const {publicKey,privateKey}=c.generateKeyPairSync('ec',{namedCurve:'prime256v1'});\
//     const pub=publicKey.export({type:'spki',format:'der'}).subarray(-65);\
//     const prv=privateKey.export({type:'pkcs8',format:'der'}).subarray(36,68);\
//     console.log('VAPID_PUBLIC_KEY='+pub.toString('base64url'));\
//     console.log('VAPID_PRIVATE_KEY='+prv.toString('base64url'))"
//
// Dónde va cada una:
//   · `VAPID_PRIVATE_KEY`  → SOLO servidor. Es un secreto. Una privada VAPID
//     filtrada permite a un tercero enviar notificaciones que el navegador
//     acepta COMO NUESTRAS: en esta app, hacer sonar el teléfono de alguien con
//     un texto que parece venir de su Alma Afín. Jamás con prefijo
//     `NEXT_PUBLIC_`, jamás en el repositorio.
//   · `VAPID_PUBLIC_KEY`   → servidor.
//   · `NEXT_PUBLIC_VAPID_PUBLIC_KEY` → opcional. Solo la PÚBLICA puede llevar
//     ese prefijo. Si no está, el navegador la pide a `/api/push/key`, que es
//     el camino recomendado: una variable menos que sincronizar y un despliegue
//     menos que rehacer al rotar.
//   · `VAPID_SUBJECT`      → `mailto:` o `https://` de contacto (RFC 8292). Si
//     falta, se usa el fallback de abajo; los servicios de push lo exigen para
//     poder avisar si nuestras entregas se vuelven abusivas.
//
// Rotación: cambiar la pareja INVALIDA todas las suscripciones existentes (el
// navegador ató cada una a la `applicationServerKey` de entonces). Al rotar hay
// que vaciar `push_subscriptions` y volver a pedir permiso; si no, cada envío
// devolverá 403 y la limpieza de `'gone'` no lo arreglará porque 403 no es 410.
// ============================================================================

/** Contacto por defecto (RFC 8292 §2.1). Se sustituye con `VAPID_SUBJECT`. */
const SUBJECT_POR_DEFECTO = 'mailto:hola@darma.app'

export interface ConfiguracionVapid {
  subject: string
  publicKey: string
  privateKey: string
}

function limpio(valor: string | undefined): string | null {
  const v = valor?.trim()
  return v ? v : null
}

/**
 * ¿Está la feature encendida?
 *
 * Se comprueba en CADA llamada y no se memoiza: en Vercel una instancia puede
 * arrancar antes de que las variables estén disponibles, y memoizar un `false`
 * dejaría push apagado hasta el siguiente despliegue sin que nada lo explicara.
 */
export function pushConfigurado(): boolean {
  return limpio(process.env.VAPID_PUBLIC_KEY) !== null &&
    limpio(process.env.VAPID_PRIVATE_KEY) !== null
}

/**
 * Configuración completa, o `null`.
 *
 * ⚠️ SOLO SERVIDOR: devuelve la clave privada. La guarda de `window` es la
 * última red, igual que en `lib/supabase/admin.ts`; si esto se ejecuta en un
 * navegador, el secreto ya está en el bundle y lo único útil es romper de forma
 * ruidosa para que se detecte en el primer render.
 */
export function configuracionVapid(): ConfiguracionVapid | null {
  if (typeof window !== 'undefined') {
    throw new Error(
      '[darma][SEGURIDAD] lib/push/vapid.ts se ha cargado en el NAVEGADOR. ' +
        'VAPID_PRIVATE_KEY es un secreto de servidor: alguien lo ha importado desde ' +
        'un componente cliente. Usa /api/push/key para obtener la pública. NO ' +
        'silencies este error.',
    )
  }

  const publicKey = limpio(process.env.VAPID_PUBLIC_KEY)
  const privateKey = limpio(process.env.VAPID_PRIVATE_KEY)
  if (!publicKey || !privateKey) return null

  return {
    subject: limpio(process.env.VAPID_SUBJECT) ?? SUBJECT_POR_DEFECTO,
    publicKey,
    privateKey,
  }
}

/**
 * Clave PÚBLICA para el navegador, o `null` si push está apagado.
 *
 * Es lo único de este módulo que puede cruzar hacia el cliente, y aun así lo
 * hace por `/api/push/key` en vez de por el bundle: así rotar la pareja no
 * exige reconstruir la app.
 */
export function clavePublicaVapid(): string | null {
  return (
    limpio(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) ??
    limpio(process.env.VAPID_PUBLIC_KEY)
  )
}
