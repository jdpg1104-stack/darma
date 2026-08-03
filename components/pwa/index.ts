// ============================================================================
// components/pwa — barril de la capa PWA de B13.
//
//     import { RegistroServiceWorker, AvisoSinConexion } from '@/components/pwa'
//
// ── DÓNDE VA CADA COSA ─────────────────────────────────────────────────────
//  · `RegistroServiceWorker` → una sola vez, en el layout de `app/(app)`.
//    Registra `/sw.js`, que es lo que hace que `/ayuda` funcione sin red.
//  · `AvisoSinConexion`      → junto al layout, es un banner fijo.
//  · `BotonInstalar`         → donde tenga sentido ofrecer la instalación
//    (ajustes, perfil). Se pinta solo si el navegador ofrece instalar.
//  · `OptInPush`             → EN EL MOMENTO, y solo ahí: justo después de que
//    el primer comentario de alguien se valide o de que guarde su primera Alma
//    Afín. NUNCA en un layout. Ver la cabecera de `OptInPush.tsx`: pedir el
//    permiso al cargar quema el origen de forma permanente.
//
// ── SOBRE EL MANIFIESTO ────────────────────────────────────────────────────
// `public/manifest.json` NO declara `share_target`, y es una decisión, no un
// olvido: aceptar contenido compartido desde otras apps abre una vía de entrada
// de texto e imágenes que no pasa por el composer ni, por tanto, por la
// detección de PII ni por la evaluación de crisis (CONTRATOS §9). Es JSON y no
// admite comentarios, así que la razón vive aquí.
//
// ── COSTE EN CLIENTE ───────────────────────────────────────────────────────
// Los cuatro son hojas `'use client'` diminutas: dos listeners, un booleano y
// un `fetch`. `RegistroServiceWorker` renderiza `null`. Ninguno importa
// `lib/push/despacho.ts` ni `lib/push/enviar.ts` — esos hablan con el cliente
// admin y jamás deben acabar en un bundle de navegador; la comunicación es por
// `fetch` a `/api/push/*`.
// ============================================================================

export { AvisoSinConexion, puedePublicar } from './AvisoSinConexion.tsx'
export type { AvisoSinConexionProps } from './AvisoSinConexion.tsx'

export { BotonInstalar } from './BotonInstalar.tsx'
export type { BotonInstalarProps } from './BotonInstalar.tsx'

export { OptInPush } from './OptInPush.tsx'
export type { OptInPushProps } from './OptInPush.tsx'

export { RegistroServiceWorker, avisarCierreDeSesion } from './RegistroServiceWorker.tsx'
