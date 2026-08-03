// ============================================================================
// B19 · Sparkline. SVG inline, SERVER COMPONENT, cero JS y cero dependencias.
//
// Una librería de gráficos para dibujar una polilínea de 90 puntos son ~40 KB
// comprimidos por ruta, el 33 % del presupuesto de 120 KB de CONTRATOS §11,
// para algo que son doce líneas de trigonometría de instituto.
//
// Accesibilidad: el SVG lleva `role="img"` y un `<title>` con el resumen en
// texto, porque una tendencia que solo existe como forma es una tendencia que
// no existe para quien usa lector de pantalla. La tabla de la página de detalle
// lleva además los mismos datos en texto.
//
// Colores por `var()` de `app/globals.css` (CONTRATOS §10). Ni un hex aquí.
// ============================================================================

export interface SparklineProps {
  valores: readonly number[]
  /** Línea horizontal de referencia (p. ej. el umbral 3,0 del KPI). */
  umbral?: number
  /** Descripción para lector de pantalla. */
  titulo: string
  ancho?: number
  alto?: number
}

export function Sparkline({ valores, umbral, titulo, ancho = 240, alto = 48 }: SparklineProps) {
  const limpios = valores.filter((v) => Number.isFinite(v))
  if (limpios.length < 2) {
    // Con menos de dos puntos no hay tendencia que dibujar, y una línea plana
    // inventada es peor que nada: parece un dato.
    return <p>Sin serie suficiente todavía.</p>
  }

  const candidatos = umbral !== undefined ? [...limpios, umbral] : limpios
  const min = Math.min(...candidatos)
  const max = Math.max(...candidatos)
  // Rango cero (todos los valores iguales) haría dividir por 0.
  const rango = max - min || 1
  const paso = ancho / (limpios.length - 1)

  const y = (v: number) => alto - ((v - min) / rango) * alto

  const puntos = limpios.map((v, i) => `${(i * paso).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${ancho} ${alto}`}
      width="100%"
      height={alto}
      role="img"
      aria-label={titulo}
      preserveAspectRatio="none"
      focusable="false"
    >
      <title>{titulo}</title>
      {umbral !== undefined ? (
        <line
          x1="0"
          x2={ancho}
          y1={y(umbral).toFixed(1)}
          y2={y(umbral).toFixed(1)}
          stroke="var(--danger)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      ) : null}
      <polyline
        points={puntos}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}
