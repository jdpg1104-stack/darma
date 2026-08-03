// ============================================================================
// B10 · Dónde vive la clave: IndexedDB con `CryptoKey` NO EXTRAÍBLE
//
// ── POR QUÉ NO localStorage ────────────────────────────────────────────────
// `localStorage` guarda TEXTO. Meter ahí una clave —aunque sea «mientras
// tanto»— significa que cualquier XSS, cualquier extensión con permiso sobre la
// página y cualquier script de terceros que entrara algún día se la lleva
// entera y para siempre. Y «migrar después» no arregla nada: las claves ya
// filtradas siguen filtradas.
//
// IndexedDB guarda OBJETOS, y eso permite guardar una `CryptoKey` con
// `extractable: false`. La diferencia práctica es enorme: un atacante con
// ejecución de JavaScript en la pestaña puede *usar* la clave mientras la
// pestaña esté abierta —no hay forma de evitar eso en una web app— pero no
// puede exportarla, ni copiarla a su servidor, ni volver mañana con ella.
//
// ── ALCANCE ────────────────────────────────────────────────────────────────
// La base se llama con el uuid del usuario dentro de la clave del registro: en
// un navegador compartido, cerrar sesión y entrar con otra cuenta no debe
// heredar la identidad de la anterior.
// ============================================================================

const BASE = 'darma-refugios'
const VERSION = 1
const ALMACEN = 'claves'

/** Falla RUIDOSAMENTE fuera del navegador en vez de degradar en silencio: un
 *  almacén que "no guarda nada" en el servidor produciría un dispositivo que
 *  parece funcionar y pierde la identidad en cada recarga. */
function exigirNavegador(): void {
  if (typeof indexedDB === 'undefined') {
    throw new Error('[darma] el almacén de claves solo existe en el navegador')
  }
}

function abrir(): Promise<IDBDatabase> {
  exigirNavegador()
  return new Promise((resolver, rechazar) => {
    const peticion = indexedDB.open(BASE, VERSION)
    peticion.onupgradeneeded = () => {
      const db = peticion.result
      if (!db.objectStoreNames.contains(ALMACEN)) db.createObjectStore(ALMACEN)
    }
    peticion.onsuccess = () => resolver(peticion.result)
    peticion.onerror = () => rechazar(peticion.error ?? new Error('IndexedDB no disponible'))
  })
}

async function leer<T>(clave: string): Promise<T | null> {
  const db = await abrir()
  try {
    return await new Promise<T | null>((resolver, rechazar) => {
      const peticion = db.transaction(ALMACEN, 'readonly').objectStore(ALMACEN).get(clave)
      peticion.onsuccess = () => resolver((peticion.result as T | undefined) ?? null)
      peticion.onerror = () => rechazar(peticion.error)
    })
  } finally {
    db.close()
  }
}

async function escribir(clave: string, valor: unknown): Promise<void> {
  const db = await abrir()
  try {
    await new Promise<void>((resolver, rechazar) => {
      const transaccion = db.transaction(ALMACEN, 'readwrite')
      transaccion.objectStore(ALMACEN).put(valor, clave)
      transaccion.oncomplete = () => resolver()
      transaccion.onerror = () => rechazar(transaccion.error)
    })
  } finally {
    db.close()
  }
}

async function borrarPorPrefijo(prefijo: string): Promise<void> {
  const db = await abrir()
  try {
    await new Promise<void>((resolver, rechazar) => {
      const transaccion = db.transaction(ALMACEN, 'readwrite')
      const almacen = transaccion.objectStore(ALMACEN)
      const cursor = almacen.openCursor()
      cursor.onsuccess = () => {
        const c = cursor.result
        if (!c) return
        if (String(c.key).startsWith(prefijo)) almacen.delete(c.key)
        c.continue()
      }
      transaccion.oncomplete = () => resolver()
      transaccion.onerror = () => rechazar(transaccion.error)
    })
  } finally {
    db.close()
  }
}

// ── Identidad ───────────────────────────────────────────────────────────────

interface IdentidadGuardada {
  privada: CryptoKey
  publicJwk: JsonWebKey
  fingerprint: string
  keyVersion: number
}

const claveIdentidad = (userId: string) => `identidad:${userId}`

export async function guardarIdentidad(userId: string, identidad: IdentidadGuardada): Promise<void> {
  await escribir(claveIdentidad(userId), identidad)
}

export async function obtenerIdentidad(userId: string): Promise<IdentidadGuardada | null> {
  return leer<IdentidadGuardada>(claveIdentidad(userId))
}

// ── Claves de refugio ───────────────────────────────────────────────────────

const claveRefugio = (userId: string, refugeId: string) => `refugio:${userId}:${refugeId}`

export async function guardarClaveRefugio(userId: string, refugeId: string, clave: CryptoKey): Promise<void> {
  await escribir(claveRefugio(userId, refugeId), clave)
}

export async function obtenerClaveRefugio(userId: string, refugeId: string): Promise<CryptoKey | null> {
  return leer<CryptoKey>(claveRefugio(userId, refugeId))
}

/**
 * Borra TODO lo de esta persona en este dispositivo.
 *
 * Es lo que se ejecuta al cerrar sesión. Sin esto, dejar la cuenta en un
 * ordenador prestado dejaría también la capacidad de descifrar todo el
 * historial, aunque la cookie de sesión ya no valga: la clave, no la sesión, es
 * lo que abre las conversaciones.
 */
export async function olvidarDispositivo(userId: string): Promise<void> {
  await borrarPorPrefijo(`identidad:${userId}`)
  await borrarPorPrefijo(`refugio:${userId}:`)
}

/** ¿Hay identidad guardada aquí? Es lo que distingue «dispositivo conocido» de
 *  «dispositivo nuevo», que son dos pantallas muy distintas. */
export async function hayIdentidad(userId: string): Promise<boolean> {
  return (await obtenerIdentidad(userId)) !== null
}
