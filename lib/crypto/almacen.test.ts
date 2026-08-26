// ============================================================================
// B10 · Pruebas del almacén de claves — la SEMÁNTICA de borrado.
//
// Node no trae IndexedDB, así que aquí se instala un doble mínimo en memoria
// que implementa exactamente la superficie que usa `almacen.ts`: `open` con
// `onupgradeneeded`/`onsuccess`, `get`, `put`, `delete` y `openCursor` con
// eventos en microtareas, como los reales. No es una prueba del motor de
// IndexedDB —eso sería probar el doble— sino de QUÉ borra cada función:
//
//  · `olvidarDispositivo(userId)` borra lo de UNA cuenta y respeta el resto.
//  · `olvidarEsteDispositivo()` borra las identidades y claves de refugio de
//    TODAS las cuentas: es lo que llama el botón de Salir, y quien pulsa Salir
//    está entregando el dispositivo (ver su cabecera en `almacen.ts`).
//
// Las claves son `CryptoKey` reales de la WebCrypto de Node, no objetos de
// pega: mismo criterio que `index.test.ts`.
// ============================================================================

import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  guardarClaveRefugio,
  guardarIdentidad,
  hayIdentidad,
  obtenerClaveRefugio,
  obtenerIdentidad,
  olvidarDispositivo,
  olvidarEsteDispositivo,
} from './almacen.ts'

// ── Doble mínimo de IndexedDB ───────────────────────────────────────────────

type Datos = Map<IDBValidKey, unknown>

class PeticionFalsa<T> {
  onsuccess: (() => void) | null = null
  onerror: (() => void) | null = null
  result!: T
  readonly error: null = null
}

class TransaccionFalsa {
  oncomplete: (() => void) | null = null
  onerror: (() => void) | null = null
  readonly error: null = null
  private pendientes = 0
  private terminada = false
  private readonly datos: Datos

  // Sin "parameter properties": el runner corre con `--experimental-strip-types`,
  // que solo BORRA tipos y no puede compilar azúcar que genera código.
  constructor(datos: Datos) {
    this.datos = datos
  }

  objectStore(_nombre: string): AlmacenObjetosFalso {
    return new AlmacenObjetosFalso(this.datos, this)
  }

  /** Cuenta una petición viva; el callback devuelto la da por terminada. La
   *  transacción completa cuando no queda ninguna, como la real. */
  registrar(): () => void {
    this.pendientes += 1
    return () => {
      this.pendientes -= 1
      queueMicrotask(() => {
        if (this.pendientes === 0 && !this.terminada) {
          this.terminada = true
          this.oncomplete?.()
        }
      })
    }
  }
}

class CursorFalso {
  readonly key: IDBValidKey
  private readonly avanzar: () => void

  constructor(key: IDBValidKey, avanzar: () => void) {
    this.key = key
    this.avanzar = avanzar
  }

  continue(): void {
    this.avanzar()
  }
}

class AlmacenObjetosFalso {
  private readonly datos: Datos
  private readonly transaccion: TransaccionFalsa

  constructor(datos: Datos, transaccion: TransaccionFalsa) {
    this.datos = datos
    this.transaccion = transaccion
  }

  get(clave: IDBValidKey): PeticionFalsa<unknown> {
    const peticion = new PeticionFalsa<unknown>()
    const hecho = this.transaccion.registrar()
    queueMicrotask(() => {
      peticion.result = this.datos.get(clave)
      peticion.onsuccess?.()
      hecho()
    })
    return peticion
  }

  put(valor: unknown, clave: IDBValidKey): PeticionFalsa<IDBValidKey> {
    const peticion = new PeticionFalsa<IDBValidKey>()
    const hecho = this.transaccion.registrar()
    queueMicrotask(() => {
      this.datos.set(clave, valor)
      peticion.result = clave
      peticion.onsuccess?.()
      hecho()
    })
    return peticion
  }

  delete(clave: IDBValidKey): PeticionFalsa<undefined> {
    const peticion = new PeticionFalsa<undefined>()
    const hecho = this.transaccion.registrar()
    queueMicrotask(() => {
      this.datos.delete(clave)
      peticion.onsuccess?.()
      hecho()
    })
    return peticion
  }

  openCursor(): PeticionFalsa<CursorFalso | null> {
    const peticion = new PeticionFalsa<CursorFalso | null>()
    // Instantánea de claves: borrar la entrada actual no descarrila el
    // recorrido, que es exactamente lo que hace `borrarPorPrefijo`.
    const claves = [...this.datos.keys()]
    let indice = 0
    const hecho = this.transaccion.registrar()
    const paso = (): void => {
      queueMicrotask(() => {
        if (indice < claves.length) {
          const clave = claves[indice]
          indice += 1
          peticion.result = new CursorFalso(clave, paso)
          peticion.onsuccess?.()
        } else {
          peticion.result = null
          peticion.onsuccess?.()
          hecho()
        }
      })
    }
    paso()
    return peticion
  }
}

class BaseFalsa {
  readonly objectStoreNames = {
    contains: (nombre: string): boolean => this.almacenes.has(nombre),
  }
  private readonly almacenes: Map<string, Datos>

  constructor(almacenes: Map<string, Datos>) {
    this.almacenes = almacenes
  }

  createObjectStore(nombre: string): void {
    if (!this.almacenes.has(nombre)) this.almacenes.set(nombre, new Map())
  }

  transaction(nombre: string, _modo?: IDBTransactionMode): TransaccionFalsa {
    const datos = this.almacenes.get(nombre)
    if (!datos) throw new Error(`el doble no tiene el almacén "${nombre}"`)
    return new TransaccionFalsa(datos)
  }

  close(): void {}
}

function crearFalsoIndexedDB(): IDBFactory {
  // Los datos viven en la FÁBRICA, no en cada `open`: abrir y cerrar la base
  // entre operaciones (que es lo que hace `almacen.ts`) conserva lo guardado.
  const almacenes = new Map<string, Datos>()
  const fabrica = {
    open(_nombre: string, _version?: number) {
      const peticion = new PeticionFalsa<BaseFalsa>() as PeticionFalsa<BaseFalsa> & {
        onupgradeneeded: (() => void) | null
      }
      peticion.onupgradeneeded = null
      queueMicrotask(() => {
        peticion.result = new BaseFalsa(almacenes)
        peticion.onupgradeneeded?.()
        peticion.onsuccess?.()
      })
      return peticion
    },
  }
  return fabrica as unknown as IDBFactory
}

const ambito = globalThis as { indexedDB?: IDBFactory }

beforeEach(() => {
  // Fábrica nueva por prueba: cada una arranca con el dispositivo vacío.
  ambito.indexedDB = crearFalsoIndexedDB()
})

// ── Material de prueba ──────────────────────────────────────────────────────

function claveDePrueba(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function sembrarCuenta(userId: string, refugeId: string): Promise<void> {
  await guardarIdentidad(userId, {
    privada: await claveDePrueba(),
    publicJwk: { kty: 'EC' },
    fingerprint: `huella-${userId}`,
    keyVersion: 1,
  })
  await guardarClaveRefugio(userId, refugeId, await claveDePrueba())
}

// ── Pruebas ─────────────────────────────────────────────────────────────────

test('guardar → obtener: la identidad y la clave de refugio vuelven del almacén', async () => {
  await sembrarCuenta('user-a', 'refugio-1')

  const identidad = await obtenerIdentidad('user-a')
  assert.equal(identidad?.fingerprint, 'huella-user-a')
  assert.equal(await hayIdentidad('user-a'), true)
  assert.notEqual(await obtenerClaveRefugio('user-a', 'refugio-1'), null)

  // Lo que no se sembró no aparece: ni identidad ajena ni refugio ajeno.
  assert.equal(await obtenerIdentidad('user-b'), null)
  assert.equal(await obtenerClaveRefugio('user-a', 'refugio-2'), null)
})

test('olvidarDispositivo(userId) borra lo de ESA cuenta y respeta las demás', async () => {
  await sembrarCuenta('user-a', 'refugio-1')
  await sembrarCuenta('user-b', 'refugio-2')

  await olvidarDispositivo('user-a')

  assert.equal(await obtenerIdentidad('user-a'), null)
  assert.equal(await obtenerClaveRefugio('user-a', 'refugio-1'), null)
  // La otra cuenta sigue intacta: este es el borrado "de una persona".
  assert.notEqual(await obtenerIdentidad('user-b'), null)
  assert.notEqual(await obtenerClaveRefugio('user-b', 'refugio-2'), null)
})

test('olvidarEsteDispositivo() borra las claves de TODAS las cuentas del aparato', async () => {
  // Dos cuentas distintas en el mismo dispositivo: el caso del móvil
  // compartido. Quien pulsa Salir entrega el aparato, y una clave de la OTRA
  // cuenta que quedara viva abriría sus refugios.
  await sembrarCuenta('user-a', 'refugio-1')
  await sembrarCuenta('user-b', 'refugio-2')

  await olvidarEsteDispositivo()

  assert.equal(await obtenerIdentidad('user-a'), null)
  assert.equal(await obtenerIdentidad('user-b'), null)
  assert.equal(await obtenerClaveRefugio('user-a', 'refugio-1'), null)
  assert.equal(await obtenerClaveRefugio('user-b', 'refugio-2'), null)
  assert.equal(await hayIdentidad('user-a'), false)
  assert.equal(await hayIdentidad('user-b'), false)
})

test('FALLO · fuera del navegador el almacén falla ruidosamente, no en silencio', async () => {
  // Sin `indexedDB` global no hay degradación muda (ver `exigirNavegador`):
  // un almacén que "no guarda nada" produciría un dispositivo que pierde la
  // identidad en cada recarga sin que nadie se entere.
  delete ambito.indexedDB
  await assert.rejects(() => olvidarEsteDispositivo(), /navegador/)
})
