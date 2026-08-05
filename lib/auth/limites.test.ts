// ============================================================================
// Pruebas de lib/auth/limites.ts — las dos cosas que, si fallan, no se notan
//
//   1. Que una cadena `x-forwarded-for` FALSIFICADA no consiga saltarse el
//      límite de altas. Es la prueba de la pareja peticion.ts + limites.ts
//      entera, desde la cabecera hasta el 429, porque el fallo que se corrige
//      vivía justo en la junta entre los dos módulos.
//   2. Que el comportamiento elegido ante una caída del backend de límites esté
//      FIJADO: `altaAnonima` deniega, el resto deja pasar. El razonamiento está
//      en la cabecera de limites.ts; esto es lo que impide que se revierta sin
//      querer.
//
// Sin red. La capa 2 se simula con un objeto que hace lo que hace Postgres
// cuando no está: lanzar.
// ============================================================================

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'

import { __resetMemoryBuckets } from '../rateLimit.ts'
import { esErrorApi, type ErrorApi } from './errores.ts'
import { hashIp } from './identidad.ts'
import { LIMITES_AUTH, limitar } from './limites.ts'
import { ipDePeticion } from './peticion.ts'

beforeEach(() => {
  __resetMemoryBuckets()
  // hashIp exige pimienta. El valor no importa: lo que se comprueba es que dos
  // peticiones caigan en la misma clave, no cuál es la clave.
  process.env.IDENTITY_PEPPER = 'pimienta-de-prueba-que-no-sale-de-aqui'
})

function peticion(cabeceras: Record<string, string>): Request {
  return new Request('https://darma.app/api/auth/anonimo', {
    method: 'POST',
    headers: cabeceras,
  })
}

/** Sujeto tal y como lo calcula `app/api/auth/anonimo/route.ts`. */
function sujetoDe(cabeceras: Record<string, string>): string {
  return hashIp(ipDePeticion(peticion(cabeceras)))
}

/** Backend de límites caído: la RPC lanza, igual que un fetch sin Postgres. */
function backendCaido(): SupabaseClient {
  const doble = {
    rpc: async (): Promise<never> => {
      throw new Error('fetch failed')
    },
  }
  return doble as unknown as SupabaseClient
}

/** Backend sano que siempre permite: aísla el efecto de la capa de memoria. */
function backendSano(): SupabaseClient {
  const doble = {
    rpc: async (): Promise<{ data: boolean; error: null }> => ({ data: true, error: null }),
  }
  return doble as unknown as SupabaseClient
}

// ── 1 · La cadena falsificada no abre la puerta ─────────────────────────────

describe('altaAnonima · x-forwarded-for falsificada', () => {
  it('rotar la cadena en cada petición NO cambia el cubo mientras el borde ponga la suya', () => {
    const delBorde = '203.0.113.7'
    const sujetos = new Set<string>()

    for (let i = 0; i < 20; i++) {
      sujetos.add(
        sujetoDe({
          'x-vercel-forwarded-for': delBorde,
          // Lo que el atacante inventa en cada petición para estrenar contador.
          'x-forwarded-for': `10.0.0.${i}, 172.16.0.${i}`,
        }),
      )
    }

    assert.equal(sujetos.size, 1, 'veinte cadenas falsificadas deben dar UN solo sujeto')
  })

  it('la petición 6ª es 429 aunque las seis lleven cadenas distintas', async () => {
    const delBorde = '203.0.113.7'
    const cabeceras = (i: number): Record<string, string> => ({
      'x-vercel-forwarded-for': delBorde,
      'x-forwarded-for': `10.0.0.${i}`,
    })

    for (let i = 0; i < LIMITES_AUTH.altaAnonima.limite; i++) {
      await limitar('altaAnonima', sujetoDe(cabeceras(i)), { supabase: backendSano() })
    }

    await assert.rejects(
      () => limitar('altaAnonima', sujetoDe(cabeceras(99)), { supabase: backendSano() }),
      (error: unknown) => {
        assert.ok(esErrorApi(error))
        const fallo = error as ErrorApi
        assert.equal(fallo.code, 'demasiadas_peticiones')
        assert.equal(fallo.status, 429)
        return true
      },
    )
  })

  it('sin cabecera del borde, apilar por delante tampoco sirve: se cuenta el último salto', async () => {
    // `next dev` o un despliegue con proxy propio. El elemento que apenda el
    // salto más cercano es el de la derecha; lo de la izquierda lo escribe el
    // cliente y da igual cuánto lo cambie.
    const cabeceras = (i: number): Record<string, string> => ({
      'x-forwarded-for': `10.0.0.${i}, 198.51.100.22`,
    })

    for (let i = 0; i < LIMITES_AUTH.altaAnonima.limite; i++) {
      await limitar('altaAnonima', sujetoDe(cabeceras(i)), { supabase: backendSano() })
    }

    await assert.rejects(() =>
      limitar('altaAnonima', sujetoDe(cabeceras(99)), { supabase: backendSano() }),
    )
  })

  it('dos orígenes de verdad distintos siguen teniendo contadores independientes', async () => {
    for (let i = 0; i < LIMITES_AUTH.altaAnonima.limite; i++) {
      await limitar('altaAnonima', sujetoDe({ 'x-vercel-forwarded-for': '203.0.113.7' }), {
        supabase: backendSano(),
      })
    }
    // Otra casa, otro contador. Si esto fallara, un solo abusador dejaría sin
    // alta a media red.
    await limitar('altaAnonima', sujetoDe({ 'x-vercel-forwarded-for': '198.51.100.44' }), {
      supabase: backendSano(),
    })
  })
})

// ── 2 · Qué pasa cuando el backend de límites se cae ────────────────────────

describe('ante el fallo del backend de límites', () => {
  it('altaAnonima DENIEGA (fail-closed) — decisión razonada en la cabecera de limites.ts', async () => {
    // Primera petición de un origen limpio: la capa de memoria la deja pasar y
    // la de Postgres revienta. La política del preset decide, y es denegar.
    await assert.rejects(
      () =>
        limitar('altaAnonima', sujetoDe({ 'x-vercel-forwarded-for': '203.0.113.7' }), {
          supabase: backendCaido(),
        }),
      (error: unknown) => {
        assert.ok(esErrorApi(error))
        assert.equal((error as ErrorApi).code, 'demasiadas_peticiones')
        return true
      },
      'sin esto, tumbar Postgres abre la puerta a mil cuentas',
    )
  })

  it('el resto sigue dejando pasar: una incidencia no puede cerrar la app entera', async () => {
    // Contrapartida explícita del punto anterior. Comprobar un alias o editar
    // el perfil no crea nada irreversible; ahí el coste de cerrar es mayor que
    // el del abuso.
    await limitar('aliasLibre', 'persona-a', { supabase: backendCaido() })
    await limitar('actualizarPerfil', 'persona-a', { supabase: backendCaido() })
    await limitar('magicLinkIp', 'persona-a', { supabase: backendCaido() })
  })

  it('la llamada puede ENDURECER pero no relajar', async () => {
    // Endurecer sí: las rutas de 2FA ya lo hacían y siguen valiendo.
    await assert.rejects(() =>
      limitar('aliasLibre', 'persona-b', { supabase: backendCaido(), failClosed: true }),
    )

    // Relajar no: `failClosed: false` sobre un preset `denegar` no lo abre.
    await assert.rejects(
      () =>
        limitar('altaAnonima', sujetoDe({ 'x-vercel-forwarded-for': '203.0.113.9' }), {
          supabase: backendCaido(),
          failClosed: false,
        }),
      'la política ante una caída pertenece al límite, no a la ruta',
    )
  })

  it('la política de cada límite está declarada, no implícita', () => {
    // Si alguien añade un preset, esta prueba le obliga a decidir a propósito.
    for (const preset of Object.values(LIMITES_AUTH)) {
      assert.ok(
        preset.anteFalloDelBackend === 'denegar' || preset.anteFalloDelBackend === 'dejar-pasar',
      )
    }
    assert.equal(LIMITES_AUTH.altaAnonima.anteFalloDelBackend, 'denegar')
    assert.equal(LIMITES_AUTH.verificarSegundoFactor.anteFalloDelBackend, 'denegar')
  })
})
