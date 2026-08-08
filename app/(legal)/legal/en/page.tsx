// ============================================================================
// /legal/en — índice de las versiones INGLESAS de los documentos legales.
//
// Mismo trato que /legal: Server Component puro y `force-static`, servido desde
// el CDN sin sesión (cuelga de /legal, que proxy.ts deja pasar). La lista se
// genera desde `ORDEN_DOCUMENTOS` y `DOCUMENTOS_LEGALES_EN`: un documento nuevo
// en `textosEn.ts` aparece aquí solo.
//
// El aviso de cabecera dice en inglés lo único que un lector inglés no puede
// permitirse ignorar: que estas son traducciones de trabajo y que el original
// español prevalece. Va HARDCODEADO y no en el catálogo por la misma razón que
// las etiquetas de `_documento.tsx`: tiene que leerse en inglés SIEMPRE, no en
// el idioma que la interfaz crea vigente.
// ============================================================================

import type { Metadata } from 'next'
import Link from 'next/link'

import { obtenerTraductor } from '@/i18n'
import { EDAD_MINIMA } from '@/lib/privacy/avisos'
import { ORDEN_DOCUMENTOS } from '@/lib/privacy/textos'
import { DOCUMENTOS_LEGALES_EN, rutaDocumentoEn } from '@/lib/privacy/textosEn'

export const dynamic = 'force-static'

export function generateMetadata(): Metadata {
  const t = obtenerTraductor('en')
  return {
    title: t('legal.indice.metaTitulo'),
    description: t('legal.indice.metaDescripcion'),
  }
}

/** Tipo de documento → CLAVE del catálogo (existe en es y en en por el guard
 *  de paridad), nunca el texto. */
const CLAVE_RECLAMO: Readonly<Record<string, string>> = {
  privacidad: 'legal.indice.reclamos.privacidad',
  terminos: 'legal.indice.reclamos.terminos',
  no_es_terapia: 'legal.indice.reclamos.no_es_terapia',
  menores: 'legal.indice.reclamos.menores',
  retencion: 'legal.indice.reclamos.retencion',
  cookies: 'legal.indice.reclamos.cookies',
}

export default function PaginaLegalEn() {
  const t = obtenerTraductor('en')

  return (
    <div>
      <h1 style={{ fontSize: 28, lineHeight: 1.25, margin: '0 0 12px' }}>
        {t('legal.indice.titulo')}
      </h1>

      <p style={{ color: 'var(--muted)', lineHeight: 1.7, margin: '0 0 8px' }}>
        {t('legal.indice.intro')}
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
        {/* Hardcodeado a propósito: ver cabecera. */}
        These documents are working translations, pending external legal review. The{' '}
        <Link href="/legal" style={{ color: 'var(--ink)' }}>
          Spanish originals
        </Link>{' '}
        prevail if the two texts ever disagree. {t('legal.noSomosEmergencias')}
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
        {ORDEN_DOCUMENTOS.map((tipo) => {
          const documento = DOCUMENTOS_LEGALES_EN[tipo]
          return (
            <li key={tipo}>
              <Link
                href={rutaDocumentoEn(tipo)}
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
                  {t(CLAVE_RECLAMO[tipo], { edad: EDAD_MINIMA })}
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
