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
//
// ── DOS IDIOMAS, DOS DOCUMENTOS ────────────────────────────────────────────
// La versión inglesa NO es una traducción de la interfaz: es OTRO documento
// legal (`lib/privacy/textosEn.ts`), con su propia versión y su propio sha256.
// `DocumentoBilingue` elige cuál servir según el locale de la petición, con
// fallback a español — que bajo `force-static` es siempre lo que ocurre,
// porque `resolverLocale()` recibe cookies y cabeceras vacías y cae al idioma
// por defecto (la misma limitación, documentada, del layout del grupo). Las
// versiones inglesas tienen además ruta propia y estática (`/legal/en/…`), que
// es la que de verdad las hace alcanzables hoy; si algún día `/legal` deja de
// ser estático, la selección por locale empieza a funcionar sin tocar nada.
// ============================================================================

import type { Metadata } from 'next'
import Link from 'next/link'

import { obtenerTraductor, resolverLocale, type Locale } from '@/i18n'
import { rutaDocumento, type DocumentoLegal } from '@/lib/privacy/textos'
import { rutaDocumentoEn } from '@/lib/privacy/textosEn'

// SIN CATÁLOGO, Y A PROPÓSITO: cada etiqueta va en el idioma de quien la
// necesita. El enlace a la versión inglesa tiene que poder leerlo alguien que
// NO lee español aunque la página esté en español — meterlo en `messages/*.json`
// lo mostraría en el idioma de la interfaz, que es justo el que esa persona no
// entiende. Mismo razonamiento que dejar `documento.titulo` sin traducir.
export const ETIQUETA_VERSION_EN = 'Read this document in English →'
export const ETIQUETA_ORIGINAL_ES = 'Spanish original (the version that prevails) →'

export async function Documento({
  documento,
  locale,
  alterna,
}: {
  documento: DocumentoLegal
  /** Idioma de las etiquetas de alrededor (versión, huella…). Si no llega, se
   *  resuelve de la petición — que bajo `force-static` cae a español. Las
   *  páginas `/legal/en/**` lo fijan a `'en'`: un documento inglés con las
   *  etiquetas en español diría que nadie pensó en quien lo lee. */
  locale?: Locale
  /** Enlace a la otra versión del documento (ver nota de las etiquetas). */
  alterna?: { href: string; etiqueta: string }
}) {
  const t = obtenerTraductor(locale ?? (await resolverLocale()))

  return (
    <article>
      {/* SIN TRADUCIR, Y A PROPÓSITO. `documento.titulo` y `documento.cuerpo`
          salen de `lib/privacy/textos.ts` o de `lib/privacy/textosEn.ts`, donde
          cada cuerpo lleva un sha256 declarado y verificado por prueba: el texto
          que se muestra tiene que ser BYTE A BYTE el que se guarda en `consents`
          al aceptar. Una versión inglesa no es una traducción de la interfaz, es
          otro documento legal, con su propia versión y su propia huella. */}
      <h1 style={{ fontSize: 28, lineHeight: 1.25, margin: '0 0 8px' }}>{documento.titulo}</h1>

      <p style={{ color: 'var(--muted)', fontSize: 14, margin: alterna ? '0 0 8px' : '0 0 28px' }}>
        {t('legal.documento.versionEtiqueta')}{' '}
        <strong style={{ color: 'var(--ink)' }}>{documento.version}</strong> ·{' '}
        {t('legal.documento.actualizadoEn', { fecha: documento.actualizadoEn })}
      </p>

      {alterna ? (
        <p style={{ fontSize: 14, margin: '0 0 28px' }}>
          <Link href={alterna.href} style={{ color: 'var(--ink)' }}>
            {alterna.etiqueta}
          </Link>
        </p>
      ) : null}

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

/**
 * Sirve el documento del locale de la petición, con fallback a español, y el
 * enlace cruzado a la otra versión. Es lo que usan las seis páginas canónicas
 * `/legal/<doc>` (ver la nota de la cabecera sobre `force-static`).
 */
export async function DocumentoBilingue({ es, en }: { es: DocumentoLegal; en: DocumentoLegal }) {
  const locale = await resolverLocale()
  const documento = locale === 'en' ? en : es
  const alterna =
    locale === 'en'
      ? { href: rutaDocumento(es.tipo), etiqueta: ETIQUETA_ORIGINAL_ES }
      : { href: rutaDocumentoEn(es.tipo), etiqueta: ETIQUETA_VERSION_EN }

  return <Documento documento={documento} locale={locale} alterna={alterna} />
}

/** El `generateMetadata` correspondiente a `DocumentoBilingue`. */
export async function metadataDocumentoBilingue(
  es: DocumentoLegal,
  en: DocumentoLegal,
): Promise<Metadata> {
  const locale = await resolverLocale()
  const documento = locale === 'en' ? en : es
  const t = obtenerTraductor(locale)
  return {
    title: documento.titulo,
    description: t('legal.documento.descripcionMeta', { version: documento.version }),
  }
}
