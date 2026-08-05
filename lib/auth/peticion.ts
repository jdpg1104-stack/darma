// ============================================================================
// Datos de la petición que B01 necesita: origen y país
//
// Los dos son datos personales y ninguno de los dos sale nunca en una respuesta
// (CONTRATOS §2 prohíbe explícitamente `ip` y `country` a nivel de usuario).
// Aquí solo se usan para:
//   · la IP → una CLAVE DE CONTADOR, siempre hasheada (lib/auth/identidad.ts).
//     La clave se persiste en `rate_limits`, y ahí no puede haber una IP.
//   · el país → `identity_vault.country_code`, la tabla sin políticas RLS. Está
//     ahí porque las líneas de ayuda de crisis son nacionales y hay que poder
//     demostrar que se mostró la correcta (ver crisis_events en 0002).
//
// ─────────────────────────────────────────────────────────────────────────────
// POR QUÉ SE REESCRIBIÓ ESTE MÓDULO
//
// La versión anterior tomaba el PRIMER elemento de `x-forwarded-for` y avisaba
// en un comentario de que ese valor «sirve para repartir contadores, NO para
// autorizar nada». El comentario era correcto y el código no lo respetaba: el
// único consumidor real era el límite de altas anónimas (5/hora por IP), que es
// la defensa antimulticuenta de primera línea de una red que promete «una
// persona, una cuenta». Es decir: se estaba autorizando la creación de cuentas
// con el dato más fácil de falsificar de toda la petición.
//
// El primer elemento de `x-forwarded-for` es, por definición de la cabecera, el
// que declara el cliente: cada salto de confianza APENDA el suyo por la derecha.
// Quien envía `x-forwarded-for: <aleatoria>` en cada petición se fabrica un
// cubo de contador nuevo cada vez, y un límite de 5/hora se convierte en
// ninguno.
//
// ── QUÉ CABECERA PONE DE VERDAD EL BORDE (Vercel), Y CUÁL NO SE PUEDE FALSEAR ─
// Documentación de Vercel, https://vercel.com/docs/headers/request-headers
// (consultada el 2026-08-05):
//
//   · `x-forwarded-for`   → «The public IP address of the client that made the
//     request. If you are trying to use Vercel behind a proxy, we currently
//     overwrite the X-Forwarded-For header and do not forward external IPs.
//     This restriction is in place to prevent IP spoofing.»
//     O sea: EN VERCEL el borde la SOBREESCRIBE. Lo que mande el cliente se
//     tira. La excepción es el «trusted proxy» de los planes Enterprise, que
//     hay que comprar y activar a propósito.
//
//   · `x-real-ip`         → «This header is identical to the x-forwarded-for
//     header.» Ni más ni menos fiable: la pone el mismo borde y con el mismo
//     valor. (La hipótesis de que `x-real-ip` fuera «la buena» de este
//     despliegue NO se sostiene; se comprobó antes de escribir esto.)
//
//   · `x-vercel-forwarded-for` → «This header is identical to the
//     x-forwarded-for header. However, x-forwarded-for could be overwritten if
//     you're using a proxy on top of Vercel.»
//     ESTA es la que se prefiere. No porque el cliente no pueda escribirla —el
//     borde también la sobreescribe— sino porque vive en el espacio de nombres
//     `x-vercel-*`, que es propiedad del borde: es la ÚNICA de las tres que
//     sigue siendo la IP real si algún día se pone un proxy o un WAF delante de
//     Vercel, que es justo el escenario en el que `x-forwarded-for` deja de
//     valer sin que nadie se entere. Es además la misma base de confianza que
//     este módulo ya le da a `x-vercel-ip-country` unas líneas más abajo.
//
// Orden final: `x-vercel-forwarded-for` → `x-real-ip` → `x-forwarded-for`.
//
// ── Y DENTRO DE `x-forwarded-for`, EL ÚLTIMO ELEMENTO, NO EL PRIMERO ────────
// Cuando se llega a `x-forwarded-for` (fuera de Vercel: `next dev`, un docker
// local, un despliegue en otro sitio), el elemento que APENDÓ el salto más
// cercano —el único en el que se puede confiar algo— es el ÚLTIMO. El primero
// es el que el cliente escribió. Tomar el último no lo vuelve inforjable, pero
// sí quita el bypass trivial: un atacante que rota la cadena por delante
// termina siempre en el mismo cubo.
//
// ── ALTERNATIVAS DESCARTADAS ────────────────────────────────────────────────
//  1. `ipAddress()` de `@vercel/functions`. Es azúcar sobre `x-forwarded-for`
//     y añade una dependencia de plataforma a un módulo que hoy se prueba con
//     `node --test` y un `Request` de pie. No aporta ninguna garantía extra.
//  2. Confiar en `x-forwarded-for` a secas «porque Vercel la sobreescribe».
//     Es cierto HOY y en ESTE proveedor. Un módulo que solo es seguro mientras
//     nadie ponga nada delante y nadie contrate el trusted proxy es un módulo
//     que se rompe en silencio el día que eso pase; y lo que se rompe es la
//     puerta de creación de cuentas.
//  3. Normalizar la cabecera en `proxy.ts` y que aquí se lea un único
//     `x-darma-ip`. Es MEJOR diseño (un solo sitio decide) y está propuesto en
//     el informe de este cambio, pero `proxy.ts` es de otra sesión: se anota,
//     no se toca. Este módulo queda escrito para seguir siendo correcto tanto
//     si esa normalización llega como si no.
//  4. Rechazar la petición cuando no hay cabecera del borde. Dejaría `next dev`
//     y cualquier entorno de pruebas sin poder registrar a nadie; y en una app
//     a la que se llega en mitad de una crisis, una puerta cerrada por un
//     detalle de despliegue es un coste que no se paga aquí. Se degrada a la
//     mejor cabecera disponible y se DECLARA la fiabilidad en el tipo, para
//     que quien tome una decisión de seguridad no tenga que adivinarla.
//
// ── AGREGACIÓN IPv6 A /64 ───────────────────────────────────────────────────
// Un contador «por IP» sobre IPv6 completo no limita nada: a cualquier abonado
// doméstico se le entrega un /64 como mínimo, o sea 2^64 direcciones que puede
// rotar a voluntad. Contar por /64 —lo que hace todo el mundo, y lo que
// corresponde a «una red de área local»— es lo que convierte el 5/hora en un
// límite real también en IPv6. En IPv4 se cuenta la dirección entera.
// ============================================================================

/**
 * De dónde salió la IP y, por tanto, cuánto se puede apoyar uno en ella.
 *
 *  · `borde`     — cabecera del espacio `x-vercel-*`. La pone la plataforma y
 *                  la sobreescribe siempre. Es lo más fuerte que hay aquí.
 *  · `reenviada` — `x-real-ip` / `x-forwarded-for`. En Vercel las pone el borde,
 *                  pero son cabeceras estándar: fuera de Vercel, o con un proxy
 *                  delante, las puede poner cualquiera.
 *  · `ninguna`   — no llegó nada aprovechable (típico de `next dev`).
 */
export type FiabilidadIp = 'borde' | 'reenviada' | 'ninguna'

export interface OrigenDePeticion {
  /**
   * IP normalizada y lista para hashear: IPv4 canónica, o el prefijo /64 en
   * IPv6. `null` si no llegó ninguna cabecera creíble.
   */
  ip: string | null
  /** Cabecera de la que salió. `null` si no salió de ninguna. */
  cabecera: string | null
  fiabilidad: FiabilidadIp
}

/**
 * Cabeceras candidatas, DE MÁS A MENOS FIABLE. El orden es la decisión de
 * seguridad de este módulo; ver la cabecera del archivo para el porqué.
 */
const CABECERAS_DE_ORIGEN: readonly { nombre: string; fiabilidad: FiabilidadIp }[] = [
  { nombre: 'x-vercel-forwarded-for', fiabilidad: 'borde' },
  { nombre: 'x-real-ip', fiabilidad: 'reenviada' },
  { nombre: 'x-forwarded-for', fiabilidad: 'reenviada' },
]

/** Largo máximo aceptado. La IPv6 más larga expandida son 45 caracteres; el
 *  resto es una cabecera inventada que no merece un cubo propio. */
const MAX_LARGO_IP = 64

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const GRUPO_IPV6 = /^[0-9a-f]{1,4}$/

/**
 * IPv4 canónica, o `null`. Se reconstruye desde los números a propósito:
 * `01.2.3.4` y `1.2.3.4` son la misma máquina, y si dieran cubos distintos el
 * límite se saltaría escribiendo ceros de más.
 */
function canonicaIpv4(valor: string): string | null {
  const trozos = IPV4.exec(valor)
  if (!trozos) return null
  const numeros = trozos.slice(1).map((g) => Number(g))
  if (numeros.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
  return numeros.join('.')
}

/**
 * Prefijo /64 de una IPv6, en forma canónica (`2001:db8:0:1::`), o `null` si
 * el texto no es una IPv6.
 */
function prefijo64Ipv6(valor: string): string | null {
  // La zona (`fe80::1%eth0`) no identifica a nadie fuera de la máquina.
  const sinZona = valor.split('%')[0] ?? ''
  const mitades = sinZona.split('::')
  if (mitades.length > 2) return null

  const trocear = (parte: string): string[] => (parte === '' ? [] : parte.split(':'))
  const izquierda = trocear(mitades[0] ?? '')
  const derecha = mitades.length === 2 ? trocear(mitades[1] ?? '') : []

  let grupos: string[]
  if (mitades.length === 2) {
    const relleno = 8 - izquierda.length - derecha.length
    if (relleno < 1) return null
    grupos = [...izquierda, ...Array<string>(relleno).fill('0'), ...derecha]
  } else {
    grupos = izquierda
  }

  if (grupos.length !== 8) return null
  if (!grupos.every((g) => GRUPO_IPV6.test(g))) return null

  // Se ceran los 64 bits bajos: el interfaz identifier lo elige la máquina y
  // rotarlo es gratis. Lo que identifica a una red es el prefijo.
  const prefijo = grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, ''))
  return `${prefijo.join(':')}::`
}

/**
 * Normaliza un valor crudo de cabecera a la forma que se usará como clave de
 * contador, o `null` si no es una IP.
 *
 * Se valida aunque la ponga la plataforma, por el mismo motivo por el que se
 * valida `x-vercel-ip-country`: una cabecera es entrada del exterior. Y aquí
 * hay una razón extra: si se aceptara cualquier texto, quien pudiera escribir
 * la cabecera se fabricaría un cubo nuevo por petición con solo cambiar la
 * basura que manda.
 */
function normalizarIp(crudo: string): string | null {
  let valor = crudo.trim().toLowerCase()
  if (!valor || valor.length > MAX_LARGO_IP) return null

  // `[2001:db8::1]:443` → `2001:db8::1`
  const conCorchetes = /^\[([^\]]+)\](?::\d+)?$/.exec(valor)
  if (conCorchetes?.[1]) valor = conCorchetes[1]

  // `203.0.113.7:54321` → `203.0.113.7`. Solo si lo de delante ya es IPv4:
  // así no se destroza una IPv6, que está llena de dos puntos.
  if (valor.includes('.') && valor.includes(':')) {
    const posibleV4 = valor.split(':')[0] ?? ''
    if (canonicaIpv4(posibleV4)) valor = posibleV4
  }

  // `::ffff:203.0.113.7` es una IPv4 disfrazada; si no se desenmascara, la
  // misma máquina ocuparía dos cubos según por dónde entre.
  const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(valor)
  if (mapeada?.[1]) valor = mapeada[1]

  const v4 = canonicaIpv4(valor)
  if (v4) return v4
  if (valor.includes(':')) return prefijo64Ipv6(valor)
  return null
}

/**
 * Último elemento aprovechable de una cabecera que puede traer una lista.
 *
 * EL ÚLTIMO, no el primero: en `cliente, proxy1, proxy2` los saltos apendan por
 * la derecha, así que lo de la izquierda es lo que declaró el cliente y lo de
 * la derecha lo que observó el salto más cercano. Se recorre de derecha a
 * izquierda y se devuelve el primer valor que sea una IP de verdad.
 */
function ultimaIpDeLaLista(valorCrudo: string): string | null {
  const trozos = valorCrudo.split(',')
  for (let i = trozos.length - 1; i >= 0; i--) {
    const normalizada = normalizarIp(trozos[i] ?? '')
    if (normalizada) return normalizada
  }
  return null
}

/**
 * Origen de la petición: la IP MÁS FIABLE que se puede obtener, junto con la
 * cabecera de la que salió y cuánto vale esa procedencia.
 *
 * Devolver la fiabilidad y no solo la IP es el punto entero de este módulo:
 * quien decide algo (crear una cuenta) tiene que poder distinguir «esto lo dijo
 * el borde» de «esto lo dijo alguien». Antes esa distinción vivía en un
 * comentario.
 */
export function origenDePeticion(request: Request): OrigenDePeticion {
  for (const candidata of CABECERAS_DE_ORIGEN) {
    const crudo = request.headers.get(candidata.nombre)
    if (!crudo) continue
    const ip = ultimaIpDeLaLista(crudo)
    if (ip) return { ip, cabecera: candidata.nombre, fiabilidad: candidata.fiabilidad }
  }
  return { ip: null, cabecera: null, fiabilidad: 'ninguna' }
}

/**
 * ¿Este origen sirve para tomar una decisión que abre o cierra una cuenta?
 *
 * Solo `borde`. Es la función que hace explícita la frontera que da nombre a
 * todo esto: TODA IP sirve para repartir contadores —incluso una declarada, que
 * al menos separa el tráfico honesto— pero solo la que atestigua la plataforma
 * sirve para AUTORIZAR. Quien la llame y obtenga `false` sabe que su límite por
 * IP es orientativo y debe apoyarse en otra barrera (el `contact_hash` de
 * `identity_vault`) o endurecerse por otro lado.
 */
export function sirveParaAutorizar(origen: OrigenDePeticion): boolean {
  return origen.fiabilidad === 'borde'
}

/**
 * IP de origen para usar como clave de contador.
 *
 * Atajo de `origenDePeticion(request).ip`. Devuelve la MÁS FIABLE disponible,
 * no la primera que aparezca: una cadena `x-forwarded-for` falsificada no
 * cambia el resultado mientras el borde ponga su cabecera.
 *
 * ⚠️ El valor por sí solo NO dice de dónde salió. Si vas a decidir algo con él
 * —y no solo a contar— usa `origenDePeticion()` y `sirveParaAutorizar()`.
 */
export function ipDePeticion(request: Request): string | null {
  return origenDePeticion(request).ip
}

/**
 * Código de país ISO-3166-1 alfa-2 que inyecta el borde de Vercel.
 *
 * Se normaliza y se valida el formato porque va directo a una columna y porque
 * una cabecera es entrada del exterior aunque la ponga la plataforma.
 */
export function paisDePeticion(request: Request): string | null {
  const crudo = request.headers.get('x-vercel-ip-country')?.trim().toUpperCase()
  if (!crudo || !/^[A-Z]{2}$/.test(crudo)) return null
  return crudo
}

/** Origen canónico del despliegue, para construir el `emailRedirectTo`. */
export function urlDelSitio(request: Request): string {
  const configurada = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  if (configurada) return configurada
  // Fallback al origen de la petición: en un preview sin variable configurada,
  // el enlace debe volver al despliegue desde el que se pidió, no a producción.
  return new URL(request.url).origin
}
