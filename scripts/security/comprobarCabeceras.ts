// ============================================================================
// Comprobación de cabeceras y CSP contra un despliegue real
//
// `next.config.ts` declara las cabeceras, pero lo que protege a la gente no es
// lo que declara el archivo: es lo que sale por el cable. Entre los dos hay un
// proxy, una configuración de Vercel, un `vercel.json` y la posibilidad de que
// alguien haya dejado la CSP en modo Report-Only «temporalmente» hace tres
// meses. Esta comprobación se ejecuta CONTRA LA URL desplegada (preview en CI,
// localhost en local) y falla el despliegue si algo no está.
//
// La trampa concreta que vigila: `Content-Security-Policy-Report-Only` NO
// bloquea nada, solo informa. Es el escape documentado de `next.config.ts` para
// depurar, y es exactamente el tipo de cambio de una línea que se queda puesto.
// Report-Only cuenta como AUSENTE, no como presente.
// ============================================================================

import { fileURLToPath } from 'node:url'

export interface ResultadoCabeceras {
  ok: boolean
  faltantes: string[]
  /** Problemas de contenido: p.ej. "csp: img-src contiene comodín https:". */
  problemas: string[]
}

/** Cabeceras obligatorias y el valor que deben traer (o `null` si basta con estar). */
const OBLIGATORIAS: ReadonlyArray<{ nombre: string; esperado?: RegExp; descripcion: string }> = [
  { nombre: 'content-security-policy', descripcion: 'CSP en modo enforce' },
  {
    nombre: 'strict-transport-security',
    esperado: /max-age=31536000/,
    descripcion: 'HSTS de un año',
  },
  { nombre: 'x-content-type-options', esperado: /^nosniff$/i, descripcion: 'nosniff' },
  { nombre: 'x-frame-options', esperado: /^DENY$/i, descripcion: 'X-Frame-Options: DENY' },
  {
    nombre: 'referrer-policy',
    esperado: /^strict-origin-when-cross-origin$/i,
    descripcion: 'Referrer-Policy',
  },
  {
    nombre: 'cross-origin-opener-policy',
    esperado: /^same-origin$/i,
    descripcion: 'Cross-Origin-Opener-Policy',
  },
  { nombre: 'permissions-policy', descripcion: 'Permissions-Policy' },
]

/** El único origen de terceros que la CSP puede embeber (ver next.config.ts). */
export const FRAME_SRC_PERMITIDO = 'https://www.youtube-nocookie.com'

/** Trocea una CSP en directiva → lista de valores. */
export function parsearCsp(csp: string): Map<string, string[]> {
  const mapa = new Map<string, string[]>()
  for (const trozo of csp.split(';')) {
    const partes = trozo.trim().split(/\s+/).filter(Boolean)
    if (partes.length === 0) continue
    mapa.set(partes[0]!.toLowerCase(), partes.slice(1))
  }
  return mapa
}

/**
 * Analiza el contenido de la CSP. Separada de la petición HTTP para poder
 * testearla con cadenas, sin levantar un servidor.
 */
export function analizarCsp(csp: string): string[] {
  const problemas: string[] = []
  const d = parsearCsp(csp)

  const defaultSrc = d.get('default-src')
  if (!defaultSrc || defaultSrc.length !== 1 || defaultSrc[0] !== "'self'") {
    problemas.push(`csp: default-src debe ser exactamente 'self' (es: ${defaultSrc?.join(' ') ?? 'ausente'})`)
  }

  const frameAncestors = d.get('frame-ancestors')
  if (!frameAncestors || frameAncestors.length !== 1 || frameAncestors[0] !== "'none'") {
    problemas.push(
      `csp: frame-ancestors debe ser 'none' — sin eso, Darma se puede meter en un iframe (clickjacking) ` +
        `(es: ${frameAncestors?.join(' ') ?? 'ausente'})`,
    )
  }

  // Comodines totales. `https:` a secas permite CUALQUIER host https, que es
  // casi lo mismo que no tener directiva: en una app de apoyo emocional, un
  // img-src abierto es una vía de exfiltración por URL de imagen.
  for (const directiva of ['connect-src', 'img-src'] as const) {
    const valores = d.get(directiva)
    if (!valores) continue
    for (const v of valores) {
      if (v === 'https:' || v === '*' || v === 'http:') {
        problemas.push(`csp: ${directiva} contiene comodín total \`${v}\``)
      }
    }
  }

  // frame-src: solo el reproductor sin cookies. TikTok e Instagram están
  // descartados a propósito (sus embeds cargan el script propietario de la
  // plataforma en nuestra página = telemetría de quién lee qué).
  const frameSrc = d.get('frame-src')
  if (frameSrc) {
    for (const v of frameSrc) {
      if (v === "'self'" || v === "'none'") continue
      if (v !== FRAME_SRC_PERMITIDO) {
        problemas.push(`csp: frame-src incluye un origen no permitido \`${v}\` (solo ${FRAME_SRC_PERMITIDO})`)
      }
    }
  }

  return problemas
}

/**
 * Comprueba cabeceras y CSP de un despliegue.
 *
 * @param baseUrl origen del despliegue (`https://…vercel.app`, `http://localhost:3000`).
 */
export async function comprobarCabeceras(baseUrl: string): Promise<ResultadoCabeceras> {
  const faltantes: string[] = []
  const problemas: string[] = []

  const base = baseUrl.replace(/\/+$/, '')

  let res: Response
  try {
    res = await fetch(`${base}/`, { redirect: 'manual' })
  } catch (e) {
    return {
      ok: false,
      faltantes: [],
      problemas: [`no se pudo conectar con ${base}: ${(e as Error).message}`],
    }
  }

  const h = res.headers

  // Report-Only no protege: se trata como ausencia de CSP, no como CSP.
  if (!h.get('content-security-policy') && h.get('content-security-policy-report-only')) {
    problemas.push(
      'csp: la política está en modo Report-Only. Report-Only NO bloquea nada, solo informa. ' +
        'Es el escape temporal de next.config.ts y no puede llegar a producción.',
    )
  }

  for (const c of OBLIGATORIAS) {
    const valor = h.get(c.nombre)
    if (!valor) {
      // Se reporta con la capitalización canónica para que el mensaje sea
      // buscable en next.config.ts.
      faltantes.push(nombreCanonico(c.nombre))
      continue
    }
    if (c.esperado && !c.esperado.test(valor.trim())) {
      problemas.push(`${nombreCanonico(c.nombre)}: valor inesperado (${c.descripcion})`)
    }
  }

  // X-Powered-By es fingerprinting de versión gratis para quien escanea.
  if (h.get('x-powered-by')) {
    problemas.push('x-powered-by presente: ponlo a false en next.config.ts (poweredByHeader)')
  }

  const permissions = h.get('permissions-policy')
  if (permissions) {
    // Cámara y micrófono cerrados NO son una preferencia de producto: voz y cara
    // son identificadores biométricos y Darma es anónima por diseño (§2 de
    // CONTRATOS y §2 de ARCHITECTURE).
    for (const feature of ['camera', 'microphone']) {
      if (!new RegExp(`${feature}\\s*=\\s*\\(\\s*\\)`).test(permissions)) {
        problemas.push(`permissions-policy: falta \`${feature}=()\` (anonimato: nunca cara ni voz)`)
      }
    }
  }

  const csp = h.get('content-security-policy')
  if (csp) problemas.push(...analizarCsp(csp))

  // /ayuda es pública por razones que no son técnicas: un muro de login delante
  // de alguien en crisis es un fallo de producto grave, no una regresión menor.
  try {
    const ayuda = await fetch(`${base}/ayuda`, { redirect: 'manual' })
    if (ayuda.status !== 200) {
      problemas.push(
        `/ayuda responde ${ayuda.status} sin sesión y debe responder 200. ` +
          'Es ruta pública a propósito: quien llega ahí puede estar en crisis.',
      )
    }
  } catch (e) {
    problemas.push(`/ayuda: no se pudo comprobar (${(e as Error).message})`)
  }

  return { ok: faltantes.length === 0 && problemas.length === 0, faltantes, problemas }
}

const CANONICOS: Readonly<Record<string, string>> = {
  'content-security-policy': 'Content-Security-Policy',
  'strict-transport-security': 'Strict-Transport-Security',
  'x-content-type-options': 'X-Content-Type-Options',
  'x-frame-options': 'X-Frame-Options',
  'referrer-policy': 'Referrer-Policy',
  'cross-origin-opener-policy': 'Cross-Origin-Opener-Policy',
  'permissions-policy': 'Permissions-Policy',
}

function nombreCanonico(nombre: string): string {
  return CANONICOS[nombre] ?? nombre
}

export function formatearInforme(r: ResultadoCabeceras, baseUrl: string): string {
  if (r.ok) return `[comprobarCabeceras] OK · ${baseUrl} sirve todas las cabeceras esperadas.`

  const lineas = [`[comprobarCabeceras] ${baseUrl} NO cumple:`, '']
  for (const f of r.faltantes) lineas.push(`  ✗ falta la cabecera ${f}`)
  for (const p of r.problemas) lineas.push(`  ✗ ${p}`)
  lineas.push('', 'Las cabeceras se declaran en next.config.ts (dueño: F4).')
  return lineas.join('\n')
}

// ── CLI ─────────────────────────────────────────────────────────────────────
// Uso: node --experimental-strip-types scripts/security/comprobarCabeceras.ts [url]

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const url = process.argv[2] ?? process.env.DEPLOY_URL ?? 'http://localhost:3000'
  const resultado = await comprobarCabeceras(url)
  console.error(formatearInforme(resultado, url))
  process.exit(resultado.ok ? 0 : 1)
}
