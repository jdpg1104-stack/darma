// ============================================================================
// Renderizador de un documento legal.
//
// ── LA ÚNICA REGLA DE ESTE ARCHIVO ─────────────────────────────────────────
// NUNCA se inyecta HTML crudo. El cuerpo es texto plano y se pinta con
// `whiteSpace: 'pre-wrap'`, que respeta los saltos de línea del original sin
// interpretar ni una etiqueta. Un documento legal que inyecta HTML es XSS con
// traje: es el archivo que menos se revisa y el que más gente lee sin sesión.
// Hay una prueba en textos.test.ts que hace grep sobre estas páginas para que
// nadie lo reintroduzca «solo para poner una negrita».
//
// La versión se muestra a la vista, no en un comentario del código: si alguien
// necesita saber qué texto aceptó, tiene que poder compararlo mirando la
// página, no abriendo el repositorio.
// ============================================================================

import type { DocumentoLegal } from '@/lib/privacy/textos'

export function Documento({ documento }: { documento: DocumentoLegal }) {
  return (
    <article>
      <h1 style={{ fontSize: 28, lineHeight: 1.25, margin: '0 0 8px' }}>{documento.titulo}</h1>

      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 28px' }}>
        Versión <strong style={{ color: 'var(--ink)' }}>{documento.version}</strong> · Última
        actualización {documento.actualizadoEn}
      </p>

      <div
        style={{
          whiteSpace: 'pre-wrap',
          lineHeight: 1.7,
          fontSize: 16,
          color: 'var(--ink)',
        }}
      >
        {documento.cuerpo}
      </div>

      <p
        style={{
          marginTop: 32,
          padding: 16,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          color: 'var(--muted)',
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        Huella del texto (SHA-256):{' '}
        <code style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
          {documento.sha256}
        </code>
        <br />
        Cuando aceptas este documento se guarda esta huella junto a la versión. Sirve para que
        «aceptaste los términos» signifique algo comprobable: si el texto cambiara, la huella
        cambiaría y volveríamos a preguntarte.
      </p>
    </article>
  )
}
