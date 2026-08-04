// ============================================================================
// Comprobación del entorno — decir QUÉ falta, en vez de «error interno»
//
// POR QUÉ EXISTE ESTE ARCHIVO:
// Levantar Darma por primera vez costó horas de diagnóstico por una razón
// tonta: cuando la configuración está mal, la app responde `error_interno` —
// que es lo correcto de cara a quien la usa (CONTRATOS §4: el cliente nunca ve
// detalle interno) y es inútil para quien la está montando. El proveedor
// anónimo desactivado, una clave de OTRO proyecto y una base caída dan los tres
// exactamente la misma pantalla.
//
// Peor todavía: una clave puede estar PRESENTE y ser inválida. Comprobar que la
// variable existe no comprueba nada. La que nos costó la tarde estaba puesta,
// tenía la longitud correcta y el prefijo correcto — y pertenecía a otro
// proyecto de la misma cuenta.
//
// ── LAS TRES COSAS QUE COMPRUEBA, Y POR QUÉ CADA UNA ───────────────────────
//
//  1. PRESENCIA Y FORMA. Sin red. Además de «está o no está», caza dos errores
//     de bulto que el tipo de la variable no impide: una clave SECRETA puesta
//     en `NEXT_PUBLIC_SUPABASE_ANON_KEY` (que la mete en el bundle del
//     navegador y regala la base entera) y una clave PUBLICABLE puesta en
//     `SUPABASE_SERVICE_ROLE_KEY` (que deja la app medio rota sin decir por
//     qué). Las dos son un copiar-y-pegar del panel en la línea de al lado.
//
//  2. SOMBRA DEL ENTORNO. Es la comprobación que más tiempo ahorra y la menos
//     evidente: si el shell exporta una variable, `.env.local` NO la
//     sobrescribe. Next.js respeta lo que ya existe en `process.env`. Así que
//     puedes editar el archivo, guardarlo, reiniciar y seguir usando un valor
//     viejo que no aparece por ninguna parte. No hay ningún síntoma que apunte
//     ahí. Lo detectamos comparando el archivo con lo que de verdad llegó.
//
//  3. VALIDEZ REAL. Con red, y por eso es la única que puede tardar. Se
//     pregunta a Supabase si la clave sirve PARA ESTE PROYECTO.
//
// ── LA SONDA, Y POR QUÉ ESTE ENDPOINT ──────────────────────────────────────
// `GET /auth/v1/settings` con la cabecera `apikey`. Calibrado contra un
// proyecto real: 200 con la clave anónima, 200 con la secreta, 401 con una
// inventada. Se eligió después de descartar `/rest/v1/` (la raíz de PostgREST
// devuelve 401 a una clave anónima PERFECTAMENTE VÁLIDA, porque el documento
// OpenAPI pide privilegios; usarla daba un falso positivo escandaloso) y de
// descartar sondear una tabla concreta, que ata la comprobación al esquema y
// falla distinto según qué migraciones se hayan aplicado. Este endpoint no
// depende del esquema y encima devuelve si el alta anónima está activada, que
// es justo el otro fallo que nos costó la tarde.
//
// REGLA INNEGOCIABLE: aquí NO se imprime NUNCA el valor de una variable, ni
// truncado, ni en un mensaje de error, ni al depurar. Este archivo nació de una
// fuga causada por un diagnóstico demasiado hablador.
// ============================================================================

/** `bloqueante` impide que la app funcione; `aviso` la deja coja pero en pie. */
export type Gravedad = 'bloqueante' | 'aviso'

export interface Hallazgo {
  readonly variable: string
  readonly gravedad: Gravedad
  /** Qué pasa. Sin el valor de la variable, jamás. */
  readonly problema: string
  /** Qué hacer, concreto y accionable. */
  readonly arreglo: string
}

/** Lo mínimo para que la app no se caiga en la primera petición con sesión. */
const OBLIGATORIAS = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'IDENTITY_PEPPER',
  'TOTP_ENC_KEY',
] as const

/**
 * Funciones que se apagan solas y en silencio si falta su variable. NO son
 * bloqueantes: el diseño de Darma es fallar cerrado y seguir en pie (ver
 * ARCHITECTURE §«modo degradado»). Pero «en silencio» es justo el problema —
 * alguien monta el entorno, todo parece ir, y nadie gana karma nunca.
 */
const DEGRADAN: ReadonlyArray<{ variable: string; consecuencia: string; arreglo: string }> = [
  {
    // OJO con lo que dice este mensaje: varios documentos del repo afirman que
    // sin esta clave «NINGÚN comentario se valida solo». Es FALSO, y verificado
    // contra Postgres: `validadorPorDefecto` es la heurística determinista de
    // lib/moderation.ts, que no necesita clave ni red y sigue validando, pagando
    // karma y acreditando escuchas. Está puesta como SUELO a propósito (ver la
    // cabecera de app/api/comments/validador.ts). Lo que falta sin la clave es
    // el juicio del modelo, no la validación entera.
    variable: 'MODERATION_API_KEY',
    consecuencia:
      'el clasificador del modelo no se llama. La heurística determinista sigue validando comentarios y pagando karma, pero sin el modelo se cuela relleno que él habría rechazado y la detección de crisis pierde el matiz que solo da leer el texto',
    arreglo: 'Ponla en .env.local para que el modelo entre por encima de la heurística.',
  },
  {
    variable: 'YOUTUBE_API_KEY',
    consecuencia:
      'el descubrimiento por Data API no corre: la ingesta se queda con los ~15 últimos ítems que da el feed Atom de cada fuente, sin guarda de idioma de audio y sin verificación de identidad de canal',
    arreglo: 'Ponla en .env.local. Cuota: 10.000 unidades/día — search.list cuesta 100, playlistItems.list solo 1.',
  },
  {
    variable: 'VAPID_PRIVATE_KEY',
    consecuencia: 'las notificaciones push están apagadas enteras y sin avisar',
    arreglo: 'Genera el par VAPID y pon VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY y NEXT_PUBLIC_VAPID_PUBLIC_KEY.',
  },
  {
    variable: 'PUSH_UA_SALT',
    consecuencia: 'el hash del user-agent de las suscripciones push pierde su sal',
    arreglo: 'Genera 32 bytes aleatorios y ponla en .env.local.',
  },
  {
    variable: 'CRON_SECRET',
    consecuencia: 'las rutas de cron rechazan todo disparo, así que no hay ingesta, ni ranking, ni purga de retención',
    arreglo: 'Genera un secreto largo y ponlo también en el scheduler.',
  },
]

/** 32 bytes en hexadecimal. Es lo que esperan `identidad.ts` y `almacenTotp.ts`. */
const HEX_32_BYTES = /^[0-9a-f]{64}$/i
const URL_PROYECTO = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/

/** Referencia del proyecto que hay dentro de la URL, o `null` si no encaja. */
export function refDeProyecto(url: string | undefined): string | null {
  const encaje = URL_PROYECTO.exec((url ?? '').trim())
  return encaje ? encaje[1]! : null
}

// ── 1 · Presencia y forma ───────────────────────────────────────────────────

/**
 * Revisa lo que se puede revisar sin salir a la red.
 *
 * Recibe el entorno en vez de leer `process.env` para que las pruebas puedan
 * construir escenarios completos sin ensuciar el proceso.
 */
export function revisarEntorno(env: Readonly<Record<string, string | undefined>>): Hallazgo[] {
  const hallazgos: Hallazgo[] = []
  const valor = (n: string): string => (env[n] ?? '').trim()

  for (const nombre of OBLIGATORIAS) {
    if (valor(nombre) === '') {
      hallazgos.push({
        variable: nombre,
        gravedad: 'bloqueante',
        problema: 'no está definida, o está definida vacía',
        arreglo: `Añádela a .env.local. Mira .env.example para saber de dónde sale.`,
      })
    }
  }

  const url = valor('NEXT_PUBLIC_SUPABASE_URL')
  if (url !== '' && refDeProyecto(url) === null) {
    hallazgos.push({
      variable: 'NEXT_PUBLIC_SUPABASE_URL',
      gravedad: 'bloqueante',
      problema: 'no tiene la forma https://<ref>.supabase.co',
      arreglo: 'Cópiala de Project Settings → API. No le pongas barra final ni ruta.',
    })
  }

  // El error caro: una clave SECRETA bajo un nombre NEXT_PUBLIC_. Next inlinea
  // todo lo que lleva ese prefijo en el bundle del navegador, así que esto no
  // es «una variable mal puesta»: es la base de datos entera, incluida
  // identity_vault, publicada en el HTML.
  const anon = valor('NEXT_PUBLIC_SUPABASE_ANON_KEY')
  if (anon.startsWith('sb_secret_')) {
    hallazgos.push({
      variable: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
      gravedad: 'bloqueante',
      problema:
        'contiene una clave SECRETA (sb_secret_…). Todo lo que empieza por NEXT_PUBLIC_ acaba en el bundle del navegador: esa clave salta RLS y expone identity_vault',
      arreglo:
        'Ponla en SUPABASE_SERVICE_ROLE_KEY, sustituye esta por la publicable (sb_publishable_… o la anon), y ROTA la secreta: ya ha estado expuesta.',
    })
  }

  // El error simétrico y mucho más inocente: la publicable donde va la secreta.
  // No es peligroso, solo deja media app rota sin explicar por qué.
  const secreta = valor('SUPABASE_SERVICE_ROLE_KEY')
  if (secreta.startsWith('sb_publishable_')) {
    hallazgos.push({
      variable: 'SUPABASE_SERVICE_ROLE_KEY',
      gravedad: 'bloqueante',
      problema: 'contiene la clave PUBLICABLE, no la secreta. Sin privilegios de service_role no se puede escribir nada',
      arreglo: 'Cópiala de Project Settings → API Keys → Secret keys (empieza por sb_secret_).',
    })
  }

  for (const nombre of ['IDENTITY_PEPPER', 'TOTP_ENC_KEY'] as const) {
    const v = valor(nombre)
    if (v !== '' && !HEX_32_BYTES.test(v)) {
      hallazgos.push({
        variable: nombre,
        gravedad: 'bloqueante',
        problema: 'no son 32 bytes en hexadecimal (64 caracteres 0-9a-f)',
        arreglo: 'Genera uno con: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      })
    }
  }

  for (const { variable, consecuencia, arreglo } of DEGRADAN) {
    if (valor(variable) === '') {
      hallazgos.push({ variable, gravedad: 'aviso', problema: `falta, así que ${consecuencia}`, arreglo })
    }
  }

  return hallazgos
}

// ── 2 · Sombra del entorno ──────────────────────────────────────────────────

/** Pares `CLAVE=valor` de un .env, ignorando comentarios y líneas sueltas. */
export function parsearEnv(contenido: string): Map<string, string> {
  const pares = new Map<string, string>()
  for (const linea of contenido.split(/\r?\n/)) {
    const limpia = linea.trim()
    if (limpia === '' || limpia.startsWith('#')) continue
    const igual = limpia.indexOf('=')
    if (igual <= 0) continue
    pares.set(limpia.slice(0, igual).trim(), limpia.slice(igual + 1).trim())
  }
  return pares
}

/**
 * Variables donde `.env.local` dice una cosa y el proceso recibió otra.
 *
 * Es SIEMPRE bloqueante aunque el valor efectivo pudiera ser correcto, porque
 * el problema no es el valor: es que el archivo miente. Quien depure va a leer
 * `.env.local`, va a ver lo que espera y no va a encontrar la causa nunca.
 *
 * Compara solo los nombres que el archivo declara: que el entorno tenga
 * variables de más es normal y no es asunto nuestro.
 */
export function detectarSombra(
  env: Readonly<Record<string, string | undefined>>,
  contenidoEnvLocal: string,
): Hallazgo[] {
  const hallazgos: Hallazgo[] = []

  for (const [nombre, enArchivo] of parsearEnv(contenidoEnvLocal)) {
    const enProceso = (env[nombre] ?? '').trim()
    if (enArchivo.trim() === enProceso) continue

    hallazgos.push({
      variable: nombre,
      gravedad: 'bloqueante',
      problema:
        'el valor que ha llegado al proceso NO es el de .env.local. Algo la exporta antes (el shell, una variable de usuario de Windows, el propio arranque) y Next.js no sobrescribe lo que ya existe en process.env',
      arreglo:
        'Bórrala del entorno y arranca de nuevo. En Windows: [Environment]::SetEnvironmentVariable(\'' +
        nombre +
        "', $null, 'User') — y reinicia la terminal, porque los procesos ya vivos conservan su copia.",
    })
  }

  return hallazgos
}

// ── 3 · Validez real ────────────────────────────────────────────────────────

export interface ResultadoSonda {
  /** `true` solo si Supabase aceptó la clave para ESTE proyecto. */
  readonly valida: boolean
  /** `null` cuando no se pudo preguntar (red, timeout). No es un veredicto. */
  readonly altaAnonimaActiva: boolean | null
  /** Motivo legible cuando no se pudo comprobar. Nunca lleva la clave. */
  readonly incierto?: string
}

interface Ajustes {
  readonly external?: { readonly anonymous_users?: boolean }
}

/**
 * Pregunta a Supabase si una clave vale para este proyecto.
 *
 * NUNCA lanza. Un fallo de red al arrancar no puede tumbar la app: devuelve
 * `valida: true` con `incierto` puesto, porque «no lo sé» debe leerse distinto
 * de «está mal». Al revés —dar por inválida una clave buena porque el wifi iba
 * lento— produce exactamente los falsos positivos que hacen que la gente deje
 * de leer los avisos de arranque.
 */
export async function sondearClave(
  urlProyecto: string,
  clave: string,
  opciones: { readonly timeoutMs?: number; readonly fetchImpl?: typeof fetch } = {},
): Promise<ResultadoSonda> {
  const { timeoutMs = 4000, fetchImpl = fetch } = opciones
  const corte = AbortSignal.timeout(timeoutMs)

  try {
    const respuesta = await fetchImpl(`${urlProyecto}/auth/v1/settings`, {
      headers: { apikey: clave },
      signal: corte,
      cache: 'no-store',
    })

    if (respuesta.status === 401) return { valida: false, altaAnonimaActiva: null }

    if (!respuesta.ok) {
      return { valida: true, altaAnonimaActiva: null, incierto: `respuesta ${respuesta.status}` }
    }

    const ajustes = (await respuesta.json()) as Ajustes
    return { valida: true, altaAnonimaActiva: ajustes.external?.anonymous_users ?? null }
  } catch (causa) {
    // El nombre del error, nunca el mensaje: un error de fetch puede llevar la
    // URL completa, y la URL lleva la ref del proyecto.
    const nombre = causa instanceof Error ? causa.name : 'desconocido'
    return { valida: true, altaAnonimaActiva: null, incierto: `no se pudo preguntar (${nombre})` }
  }
}

/** Sondea las dos claves y traduce los resultados a hallazgos. */
export async function verificarClaves(
  env: Readonly<Record<string, string | undefined>>,
  opciones: { readonly timeoutMs?: number; readonly fetchImpl?: typeof fetch } = {},
): Promise<Hallazgo[]> {
  const url = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const ref = refDeProyecto(url)
  if (ref === null) return [] // ya lo dijo revisarEntorno; no repetimos el aviso

  const hallazgos: Hallazgo[] = []
  const pares: ReadonlyArray<readonly [string, string]> = [
    ['NEXT_PUBLIC_SUPABASE_ANON_KEY', (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()],
    ['SUPABASE_SERVICE_ROLE_KEY', (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()],
  ]

  let altaAnonima: boolean | null = null

  for (const [nombre, clave] of pares) {
    if (clave === '') continue // la ausencia ya está reportada

    const resultado = await sondearClave(url, clave, opciones)
    if (resultado.altaAnonimaActiva !== null) altaAnonima = resultado.altaAnonimaActiva

    if (!resultado.valida) {
      hallazgos.push({
        variable: nombre,
        gravedad: 'bloqueante',
        problema: `el proyecto ${ref} RECHAZA esta clave (401). Existe y tiene buena pinta, pero no es de este proyecto — o se ha rotado y esta es la vieja`,
        arreglo: `Cópiala otra vez de Project Settings → API Keys del proyecto ${ref}, y comprueba en la barra superior del panel que estás en el proyecto correcto.`,
      })
    }
  }

  if (altaAnonima === false) {
    hallazgos.push({
      variable: '(Supabase Auth)',
      gravedad: 'bloqueante',
      problema:
        'el alta anónima está DESACTIVADA en el proyecto, así que «Entrar sin dar mis datos» —la puerta principal de Darma— falla siempre con error_interno',
      arreglo: `Actívala en Authentication → Sign In / Providers → Allow anonymous sign-ins del proyecto ${ref}.`,
    })
  }

  return hallazgos
}

// ── Informe ─────────────────────────────────────────────────────────────────

/** Texto para la consola. Devuelve cadena vacía si no hay nada que decir. */
export function formatearInforme(hallazgos: readonly Hallazgo[]): string {
  if (hallazgos.length === 0) return ''

  const bloqueantes = hallazgos.filter((h) => h.gravedad === 'bloqueante')
  const avisos = hallazgos.filter((h) => h.gravedad === 'aviso')
  const lineas: string[] = ['', '═'.repeat(78), '  CONFIGURACIÓN DE DARMA']

  const bloque = (titulo: string, cuales: readonly Hallazgo[]): void => {
    if (cuales.length === 0) return
    lineas.push('', `  ${titulo}`, '')
    for (const h of cuales) {
      lineas.push(`  · ${h.variable}: ${h.problema}.`, `    → ${h.arreglo}`)
    }
  }

  bloque(`${bloqueantes.length} problema(s) que impiden que la app funcione:`, bloqueantes)
  bloque(`${avisos.length} función(es) apagada(s) — la app arranca igual:`, avisos)

  lineas.push('', '═'.repeat(78), '')
  return lineas.join('\n')
}
