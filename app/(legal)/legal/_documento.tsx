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

import { obtenerTraductor, resolverLocale } from '@/i18n'
import type { DocumentoLegal } from '@/lib/privacy/textos'

export async function Documento({ documento }: { documento: DocumentoLegal }) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <article>
      {/* SIN TRADUCIR, Y A PROPÓSITO. `documento.titulo` y `documento.cuerpo`
          salen de `lib/privacy/textos.ts`, que no es de este bloque y donde cada
          cuerpo lleva un sha256 declarado y verificado por prueba: el texto que
          se muestra tiene que ser BYTE A BYTE el que se guardó en `consents` al
          aceptar. Una versión inglesa no es una traducción de la interfaz, es
          otro documento legal, con su propia versión y su propia huella. Ver el
          resumen de la migración. */}
      <h1 style={{ fontSize: 28, lineHeight: 1.25, margin: '0 0 8px' }}>{documento.titulo}</h1>

      <p style={{ color: 'var(--muted)', fontSize: 14, margin: '0 0 28px' }}>
        {t('legal.documento.versionEtiqueta')}{' '}
        <strong style={{ color: 'var(--ink)' }}>{documento.version}</strong> ·{' '}
        {t('legal.documento.actualizadoEn', { fecha: documento.actualizadoEn })}
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
        {t('legal.documento.huella')}{' '}
        <code style={{ fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
          {documento.sha256}
        </code>
        <br />
        {t('legal.documento.huellaExplicacion')}
      </p>
    </article>
  )
}
