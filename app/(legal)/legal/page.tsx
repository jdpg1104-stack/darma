// ============================================================================
// /legal — índice de los documentos.
//
// La lista se genera desde `ORDEN_DOCUMENTOS` y `DOCUMENTOS_LEGALES`: añadir un
// documento a `textos.ts` lo hace aparecer aquí solo. Una lista escrita a mano
// se queda corta el primer día que alguien añade un texto y se olvida de esta
// página, y en un índice legal faltar un documento no es un detalle estético.
//
// El orden NO es alfabético ni cronológico: privacidad primero, porque es el
// que la gente viene a leer y el que contiene la decisión que menos se espera
// (qué sobrevive al borrado). Cookies al final, porque es el más corto y el
// menos consecuente.
// ============================================================================

import type { Metadata } from 'next'
import Link from 'next/link'

import { AVISO_NO_TERAPIA, EDAD_MINIMA } from '@/lib/privacy/avisos'
import { DOCUMENTOS_LEGALES, ORDEN_DOCUMENTOS, rutaDocumento } from '@/lib/privacy/textos'

export const dynamic = 'force-static'

export const metadata: Metadata = {
  title: 'Documentos legales',
  description: 'Condiciones, privacidad, cookies, edad mínima y retención de datos de Darma.',
}

/** Una frase por documento. No es el resumen legal: es la razón para abrirlo. */
const RECLAMOS: Readonly<Record<string, string>> = {
  privacidad:
    'Qué guardamos, qué no, y qué pasa exactamente cuando borras tu cuenta. Léelo antes de pulsar ese botón.',
  terminos: 'Qué es Darma, cómo se gana el derecho a publicar y qué no se puede hacer aquí.',
  no_es_terapia: 'Dónde ayuda esto y dónde hace falta otra cosa.',
  menores: `Por qué la edad mínima son ${EDAD_MINIMA} años y por qué no pedimos el DNI a nadie.`,
  retencion: 'Cuánto tiempo vive cada dato, tabla por tabla, con su base legal.',
  cookies: 'Las imprescindibles y ninguna más. Por eso no hay banner.',
}

export default function PaginaLegal() {
  return (
    <div>
      <h1 style={{ fontSize: 28, lineHeight: 1.25, margin: '0 0 12px' }}>Lo que hay que saber</h1>

      <p style={{ color: 'var(--muted)', lineHeight: 1.7, margin: '0 0 8px' }}>
        Estos documentos se pueden leer sin tener cuenta y sin iniciar sesión, que es como debe
        ser: nadie debería tener que registrarse para saber qué se hace con lo que escribe.
      </p>

      <p
        style={{
          margin: '0 0 32px',
          padding: 16,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          lineHeight: 1.6,
        }}
      >
        {AVISO_NO_TERAPIA}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        {ORDEN_DOCUMENTOS.map((tipo) => {
          const documento = DOCUMENTOS_LEGALES[tipo]
          return (
            <li key={tipo}>
              <Link
                href={rutaDocumento(tipo)}
                style={{
                  display: 'block',
                  padding: 16,
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--line)',
                  background: 'var(--panel)',
                  color: 'var(--ink)',
                  textDecoration: 'none',
                }}
              >
                <strong style={{ display: 'block', fontSize: 17 }}>{documento.titulo}</strong>
                <span
                  style={{
                    display: 'block',
                    color: 'var(--muted)',
                    fontSize: 14,
                    lineHeight: 1.6,
                    marginTop: 4,
                  }}
                >
                  {RECLAMOS[tipo]}
                </span>
                <span style={{ display: 'block', color: 'var(--muted)', fontSize: 12, marginTop: 8 }}>
                  {documento.version} · {documento.actualizadoEn}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
