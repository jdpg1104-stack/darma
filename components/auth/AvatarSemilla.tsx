'use client'

// ============================================================================
// Avatar generado a partir de la semilla. SVG puro, sin dependencias.
//
// ⚠️ Lleva `'use client'` DESDE LA MIGRACIÓN A i18n, y no por su lógica: sigue
// siendo una función pura de la semilla. El `aria-label` ahora sale del
// catálogo con `useTraductor()`, que es un hook, así que el archivo tiene que
// ser de cliente. Hoy su único consumidor es `AsistenteOnboarding`, que ya lo
// es. Si mañana hace falta desde un Server Component, la vía es el hermano
// `Avatar` de components/ui, no volver a fijar el texto aquí.
//
// ── POR QUÉ UN AVATAR GENERADO Y NUNCA UNA FOTO ────────────────────────────
// Una cara es un identificador biométrico. En una red donde la gente cuenta lo
// que no le ha contado a nadie, poder subir una foto no es una funcionalidad
// que falte: es el primer paso para que alguien reconozca a su compañero de
// trabajo. La `Permissions-Policy` de next.config.ts ya deniega cámara y
// micrófono; esto es la otra mitad de la misma decisión.
//
// ── LA SEMILLA NO DERIVA DE LA PERSONA ─────────────────────────────────────
// `avatar_seed` sale de `createIdentitySeed()` (lib/anonymity.ts): 16 bytes
// aleatorios, sin ninguna relación con el user id ni con el correo. Por eso
// este componente puede ser determinista sin filtrar nada: es determinista
// RESPECTO A LA SEMILLA, y la semilla no significa nada.
//
// Sin `useState` ni efectos: es una función pura de la semilla, así que sirve
// igual en un Server Component y dentro de la hoja cliente del onboarding.
// ============================================================================

import { useTraductor } from '@/i18n/Proveedor'

/** Paletas de dos colores. Ninguna se acerca a --danger: el avatar acompaña a
 *  alguien en un mal día y no debe leerse como una alarma. */
const PALETAS: readonly (readonly [string, string])[] = [
  ['#7c5cff', '#26d0a5'],
  ['#26d0a5', '#f2c14e'],
  ['#f2c14e', '#7c5cff'],
  ['#4aa8ff', '#7c5cff'],
  ['#26d0a5', '#4aa8ff'],
  ['#ff9f68', '#f2c14e'],
  ['#9b7cff', '#4aa8ff'],
  ['#5ed6b4', '#9b7cff'],
]

/** Entero estable a partir de un trozo de la semilla hexadecimal. */
function trozo(semilla: string, desde: number, largo: number): number {
  const fragmento = semilla.slice(desde, desde + largo)
  const valor = Number.parseInt(fragmento, 16)
  return Number.isFinite(valor) ? valor : 0
}

export interface PropiedadesAvatar {
  /** `profiles.avatar_seed`: 16 caracteres hexadecimales. */
  semilla: string
  tamano?: number
}

export function AvatarSemilla({ semilla, tamano = 96 }: PropiedadesAvatar) {
  const t = useTraductor()
  const limpia = (semilla || '').toLowerCase().replace(/[^0-9a-f]/g, '').padEnd(16, '0')

  const [colorA, colorB] = PALETAS[trozo(limpia, 0, 2) % PALETAS.length]!
  const rotacion = trozo(limpia, 2, 2) % 360
  const lados = 3 + (trozo(limpia, 4, 2) % 5) // 3 a 7 vértices
  const radioInterior = 0.34 + (trozo(limpia, 6, 2) % 40) / 200 // 0,34 a 0,53

  // Polígono determinista: mismo número de vértices y mismo giro para la misma
  // semilla, siempre.
  const puntos = Array.from({ length: lados }, (_, i) => {
    const angulo = (i / lados) * Math.PI * 2 - Math.PI / 2
    const radio = i % 2 === 0 ? 0.68 : radioInterior
    const x = 50 + Math.cos(angulo) * radio * 50
    const y = 50 + Math.sin(angulo) * radio * 50
    return `${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')

  // El id del degradado incluye la semilla: dos avatares en la misma página con
  // el mismo id compartirían degradado y el segundo se pintaría con el color
  // del primero.
  const idDegradado = `darma-avatar-${limpia}`

  return (
    <svg
      width={tamano}
      height={tamano}
      viewBox="0 0 100 100"
      role="img"
      // El texto alternativo NO nombra a nadie: describe la forma, no a la
      // persona. Un `alt` con el alias lo repetiría en cada tarjeta del feed.
      aria-label={t('comun.avatarGenerado')}
      // Ancla estable para el e2e (B18): el aria-label cambia con el idioma.
      // El test de «SVG inline, no <img> remota» sigue leyendo el tagName.
      data-testid="auth-avatar"
      style={{ borderRadius: '50%', display: 'block' }}
    >
      <defs>
        <linearGradient id={idDegradado} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={colorA} />
          <stop offset="100%" stopColor={colorB} />
        </linearGradient>
      </defs>
      <rect width="100" height="100" fill={`url(#${idDegradado})`} />
      <polygon
        points={puntos}
        fill="rgba(255,255,255,0.82)"
        transform={`rotate(${rotacion} 50 50)`}
      />
    </svg>
  )
}
