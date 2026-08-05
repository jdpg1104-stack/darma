// ============================================================================
// Generador de los assets de marca en PNG · og.png + iconos del manifest
//
// POR QUÉ EXISTE: los iconos de la PWA eran SVG provisionales (pedido de
// B13 → B16 en HANDOFF/PEDIDOS.md: en muchos lanzadores Android el SVG sale
// con marco blanco), y el OG viajaba sin imagen — app/layout.tsx lo anotaba
// a propósito («anunciar una imagen rota es peor que no anunciar ninguna»).
// Este script produce los cinco PNG reales y muere de asco en el repo: solo
// se ejecuta a mano cuando cambie la marca, nunca en build.
//
// DE DÓNDE SALE CADA COSA — nada inventado, todo leído del repo:
//   · Colores y tipografía: los tokens de `app/globals.css` (--bg, --ink,
//     --muted, --accent, --accent2, --font-sans). Si un token desaparece o
//     cambia de formato, esto FALLA en vez de congelar un hex viejo.
//   · Dibujo del icono: `public/icono-darma.svg` y su variante maskable, que
//     ya son la fuente de verdad del manifest. La maskable existente mete el
//     dibujo en el 68 % central: el contenido queda a más del 20 % de cada
//     borde, que es el margen de seguridad que exige el recorte de Android
//     (zona segura = 80 % central).
//   · Lema del OG: el texto EXACTO de `comun.og.titulo` en messages/es.json
//     («Darma — donde escuchar es lo que da derecho a hablar», el lema del
//     README). Se extrae del catálogo en vez de copiarlo aquí para que si el
//     copy cambia, la imagen no se quede mintiendo en silencio: falla el
//     script (y su test) y se regenera.
//
// CON QUÉ RASTERIZA: `sharp`, que YA vive en node_modules como dependencia de
// Next (node_modules/next/node_modules/sharp — por eso el createRequire
// anclado al package.json de next, no un import normal: `sharp` no es
// dependencia declarada de este proyecto y no se instala nada nuevo).
// Su librsvg+pango renderiza el SVG con la pila tipográfica del sistema.
//
// DETERMINISMO: mismo repo → mismos bytes, en lo posible. No se incrusta
// fecha ni metadato alguno, y el PNG se codifica siempre con las mismas
// opciones. La única variable ajena es la versión de libvips que traiga
// sharp y las fuentes del sistema donde se ejecute (el texto del OG se
// dibuja con la fuente real de la máquina).
//
// USO:  node --experimental-strip-types scripts/design/generarAssets.ts
// ============================================================================

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const RAIZ = join(AQUI, '..', '..')

// ── Contratos ───────────────────────────────────────────────────────────────

/** Tokens de marca leídos de `app/globals.css`. Solo los que se pintan aquí. */
export interface TokensMarca {
  bg: string
  ink: string
  muted: string
  accent: string
  accent2: string
  /** Valor de --font-sans normalizado para un atributo font-family de SVG. */
  fontSans: string
}

/** Lo mínimo de sharp que se usa, tipado a mano: `sharp` no está en las
 *  dependencias del proyecto y no hay `@types` que importar. */
interface InstanciaSharp {
  resize(ancho: number, alto: number): InstanciaSharp
  png(opciones?: { compressionLevel?: number }): InstanciaSharp
  composite(capas: ReadonlyArray<{ input: Buffer; left: number; top: number }>): InstanciaSharp
  toBuffer(): Promise<Buffer>
  toFile(ruta: string): Promise<{ width: number; height: number }>
}
type ModuloSharp = (entrada: Buffer, opciones?: { density?: number }) => InstanciaSharp

/** Los cinco archivos que este script escribe en `public/`, con sus
 *  dimensiones. El test y el manifest se cuelgan de esta misma constante. */
export const ASSETS_GENERADOS = {
  'og.png': { ancho: 1200, alto: 630 },
  'icon-192.png': { ancho: 192, alto: 192 },
  'icon-512.png': { ancho: 512, alto: 512 },
  'icon-maskable-192.png': { ancho: 192, alto: 192 },
  'icon-maskable-512.png': { ancho: 512, alto: 512 },
} as const

export type NombreAsset = keyof typeof ASSETS_GENERADOS

// ── Extracción de tokens ────────────────────────────────────────────────────

/**
 * Lee un token `--nombre: valor;` del CSS. Regex y no un parser: los tokens
 * de globals.css son declaraciones planas dentro de `:root`, y la primera
 * aparición ES la del tema oscuro de referencia (los bloques de tema claro
 * vienen después). Si el día de mañana eso cambia de forma, esto lanza y el
 * test lo cuenta.
 */
function leerToken(css: string, nombre: string): string {
  const re = new RegExp(`--${nombre}\\s*:\\s*([^;]+);`)
  const resultado = re.exec(css)
  if (!resultado?.[1]) {
    throw new Error(`[generarAssets] app/globals.css no define --${nombre}; sin token no hay asset.`)
  }
  return resultado[1].trim()
}

/**
 * Normaliza el valor multilínea de `--font-sans` para un atributo XML: colapsa
 * espacios y cambia las comillas dobles por simples (el atributo va entre
 * dobles). librsvg resuelve la pila con fontconfig igual que un navegador:
 * ignora las familias que no existan en la máquina y usa la primera real.
 */
export function familiaParaSvg(fontSans: string): string {
  return fontSans.replace(/\s+/g, ' ').replace(/"/g, "'").trim()
}

/** Extrae los tokens de marca del contenido de `app/globals.css`. */
export function extraerTokens(css: string): TokensMarca {
  const tokens: TokensMarca = {
    bg: leerToken(css, 'bg'),
    ink: leerToken(css, 'ink'),
    muted: leerToken(css, 'muted'),
    accent: leerToken(css, 'accent'),
    accent2: leerToken(css, 'accent2'),
    fontSans: familiaParaSvg(leerToken(css, 'font-sans')),
  }

  // Los cinco colores tienen que ser hex planos: van directos a atributos
  // `fill` de SVG, donde un `light-dark(...)` o un `var()` no significan nada.
  for (const [nombre, valor] of Object.entries(tokens)) {
    if (nombre !== 'fontSans' && !/^#[0-9a-fA-F]{6}$/.test(valor)) {
      throw new Error(
        `[generarAssets] --${nombre} vale «${valor}», que no es un hex plano; ` +
          'este script no sabe resolver funciones CSS.',
      )
    }
  }

  return tokens
}

// ── Lema del OG ─────────────────────────────────────────────────────────────

/**
 * El lema, EXACTO, desde `comun.og.titulo` del catálogo español — la clave que
 * el layout ya usa como título de la tarjeta. El título es
 * «Darma — donde escuchar es lo que da derecho a hablar»; en la imagen la
 * marca va aparte y en grande, así que aquí se recorta el prefijo. Si el
 * título cambia de forma, esto FALLA en vez de renderizar media frase.
 */
export function extraerLema(jsonCatalogo: string): string {
  const catalogo: unknown = JSON.parse(jsonCatalogo)

  let titulo: unknown
  if (typeof catalogo === 'object' && catalogo !== null) {
    const comun: unknown = (catalogo as Record<string, unknown>)['comun']
    if (typeof comun === 'object' && comun !== null) {
      const og: unknown = (comun as Record<string, unknown>)['og']
      if (typeof og === 'object' && og !== null) {
        titulo = (og as Record<string, unknown>)['titulo']
      }
    }
  }

  if (typeof titulo !== 'string') {
    throw new Error('[generarAssets] messages/es.json no tiene comun.og.titulo; el OG sale del catálogo, no de aquí.')
  }

  const resultado = /^Darma\s+—\s+donde\s+(.+)$/.exec(titulo)
  if (!resultado?.[1]) {
    throw new Error(
      `[generarAssets] comun.og.titulo es «${titulo}» y ya no encaja con «Darma — donde <lema>»; ` +
        'ajusta la composición del OG a la vez que el copy.',
    )
  }
  return resultado[1]
}

// ── Composición del OG ──────────────────────────────────────────────────────

/** Escape mínimo para texto dentro de un nodo SVG. */
function escaparXml(texto: string): string {
  return texto.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * El fondo del OG: 1200×630, todo tokens. El icono NO va aquí — se rasteriza
 * aparte desde su propio SVG y se compone encima con sharp, que renderiza el
 * dibujo real en lugar de una copia pegada que se desincronizaría.
 *
 * La composición es la landing en miniatura: fondo --bg, dos halos tenues con
 * los dos acentos (el violeta de la acción, el verde de lo conseguido), la
 * marca en --ink con la pila del sistema y el lema en --muted. Nada más: una
 * tarjeta de compartir se ve a 500 px de ancho y todo lo que no sea el lema
 * es ruido.
 */
export function componerOgSvg(tokens: TokensMarca, lema: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${tokens.bg}"/>
  <circle cx="1060" cy="70" r="430" fill="${tokens.accent}" opacity="0.10"/>
  <circle cx="130" cy="640" r="330" fill="${tokens.accent2}" opacity="0.08"/>
  <text x="96" y="388" font-family="${tokens.fontSans}" font-size="112" font-weight="800" letter-spacing="-2" fill="${tokens.ink}">Darma</text>
  <rect x="100" y="424" width="140" height="6" rx="3" fill="${tokens.accent}"/>
  <text x="100" y="516" font-family="${tokens.fontSans}" font-size="46" fill="${tokens.muted}">${escaparXml(lema)}</text>
</svg>
`
}

// ── Verificación de PNG (compartida con el test) ────────────────────────────

/**
 * Dimensiones del IHDR de un PNG, sin dependencias: firma de 8 bytes y ancho y
 * alto big-endian en los offsets 16 y 20. Suficiente para afirmar «este
 * archivo es un PNG de N×M», que es lo único que el test necesita.
 */
export function dimensionesPng(bytes: Buffer): { ancho: number; alto: number } {
  const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(FIRMA_PNG)) {
    throw new Error('[generarAssets] el archivo no es un PNG (firma incorrecta).')
  }
  return { ancho: bytes.readUInt32BE(16), alto: bytes.readUInt32BE(20) }
}

// ── Guard de coherencia de los SVG fuente ───────────────────────────────────

/**
 * Quita los comentarios XML del SVG. No es cosmética: los comentarios de los
 * iconos citan tokens CSS («--bg», «--accent») y un doble guion dentro de un
 * comentario es XML inválido — el navegador lo tolera, el parser estricto de
 * librsvg lo rechaza con «Double hyphen within comment». También deja el guard
 * de hexes mirando solo lo que se PINTA, no lo que se comenta.
 */
export function sinComentariosXml(svg: string): string {
  return svg.replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * Los SVG del icono prometen en su propio comentario que no llevan «un solo
 * hex inventado». Este guard lo convierte en condición de ejecución: cada hex
 * que pinten tiene que ser un token de globals.css. Si F4 cambia --accent y
 * nadie toca los SVG, esto para la generación en vez de producir iconos con
 * la marca vieja.
 */
export function verificarHexesDelIcono(svg: string, tokens: TokensMarca): void {
  const permitidos = new Set(
    [tokens.bg, tokens.ink, tokens.muted, tokens.accent, tokens.accent2].map((h) => h.toLowerCase()),
  )
  for (const hex of svg.match(/#[0-9a-fA-F]{6}\b/g) ?? []) {
    if (!permitidos.has(hex.toLowerCase())) {
      throw new Error(
        `[generarAssets] el SVG del icono usa ${hex}, que no es ningún token de app/globals.css; ` +
          'o el icono se desincronizó de la marca o cambió un token sin regenerar.',
      )
    }
  }
}

// ── Generación ──────────────────────────────────────────────────────────────

/** Carga sharp desde el árbol de next. Falla con instrucción, no con ruido. */
function cargarSharp(): ModuloSharp {
  try {
    const requerirComoNext = createRequire(join(RAIZ, 'node_modules', 'next', 'package.json'))
    return requerirComoNext('sharp') as ModuloSharp
  } catch (causa) {
    throw new Error(
      '[generarAssets] no se pudo cargar sharp desde node_modules/next/node_modules. ' +
        'Es dependencia de next: ¿está node_modules instalado? No instales nada nuevo para esto.',
      { cause: causa },
    )
  }
}

/**
 * Rasteriza un SVG a PNG cuadrado de `lado` px. La `density` escala el render
 * vectorial al tamaño de destino ANTES de rasterizar (72 dpi es el intrínseco
 * de un SVG para libvips): así el borde sale del vector, no de un reescalado
 * de bitmap. El resize posterior solo garantiza el píxel exacto.
 */
function rasterizarIcono(sharp: ModuloSharp, svg: string, lado: number): InstanciaSharp {
  const INTRINSECO = 512 // viewBox de los dos SVG del icono
  return sharp(Buffer.from(svg), { density: (72 * lado) / INTRINSECO })
    .resize(lado, lado)
    .png({ compressionLevel: 9 })
}

/** Genera los cinco PNG en `public/`. Devuelve las rutas escritas. */
export async function generarAssets(raiz: string = RAIZ): Promise<string[]> {
  const css = readFileSync(join(raiz, 'app', 'globals.css'), 'utf8')
  const tokens = extraerTokens(css)
  const lema = extraerLema(readFileSync(join(raiz, 'messages', 'es.json'), 'utf8'))

  const svgIcono = sinComentariosXml(readFileSync(join(raiz, 'public', 'icono-darma.svg'), 'utf8'))
  const svgMaskable = sinComentariosXml(readFileSync(join(raiz, 'public', 'icono-darma-maskable.svg'), 'utf8'))
  verificarHexesDelIcono(svgIcono, tokens)
  verificarHexesDelIcono(svgMaskable, tokens)

  const sharp = cargarSharp()
  const escritas: string[] = []

  // Iconos del manifest: `any` desde el SVG normal, `maskable` desde la
  // variante que ya respeta la zona segura del recorte de Android.
  const iconos: ReadonlyArray<{ nombre: NombreAsset; svg: string }> = [
    { nombre: 'icon-192.png', svg: svgIcono },
    { nombre: 'icon-512.png', svg: svgIcono },
    { nombre: 'icon-maskable-192.png', svg: svgMaskable },
    { nombre: 'icon-maskable-512.png', svg: svgMaskable },
  ]
  for (const { nombre, svg } of iconos) {
    const destino = join(raiz, 'public', nombre)
    await rasterizarIcono(sharp, svg, ASSETS_GENERADOS[nombre].ancho).toFile(destino)
    escritas.push(destino)
  }

  // OG: fondo con texto renderizado del SVG + el icono compuesto encima. El
  // icono lleva el mismo fondo --bg que la tarjeta, así que su tile redondeado
  // se funde con ella y solo se ve el dibujo. Corrección óptica: el dibujo
  // empieza a 112/512 del borde de su tile, así que el tile se desplaza esa
  // misma proporción a la izquierda para que el DIBUJO (lo único visible)
  // quede alineado con la columna de texto en x=96.
  const LADO_ICONO_OG = 148
  const MARGEN_X = 96
  const sangriaDelDibujo = Math.round((LADO_ICONO_OG * 112) / 512)
  const iconoParaOg = await rasterizarIcono(sharp, svgIcono, LADO_ICONO_OG).toBuffer()
  const og = ASSETS_GENERADOS['og.png']
  const destinoOg = join(raiz, 'public', 'og.png')
  await sharp(Buffer.from(componerOgSvg(tokens, lema)))
    .resize(og.ancho, og.alto)
    .composite([{ input: iconoParaOg, left: MARGEN_X - sangriaDelDibujo, top: 84 }])
    .png({ compressionLevel: 9 })
    .toFile(destinoOg)
  escritas.push(destinoOg)

  return escritas
}

// ── CLI ─────────────────────────────────────────────────────────────────────

// Solo cuando se invoca como script; importado desde su prueba, argv[1] es el
// runner y esto no dispara. Mismo patrón que scripts/security/gateTelefonos.ts.
const invocado = (process.argv[1] ?? '').replace(/\\/g, '/')
if (invocado.endsWith('scripts/design/generarAssets.ts')) {
  generarAssets()
    .then((rutas) => {
      console.error(`[generarAssets] OK · ${rutas.length} archivos:\n  ${rutas.join('\n  ')}`)
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    })
}
