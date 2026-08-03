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

import { obtenerTraductor, resolverLocale } from '@/i18n'
import { AVISO_NO_TERAPIA, EDAD_MINIMA } from '@/lib/privacy/avisos'
import { DOCUMENTOS_LEGALES, ORDEN_DOCUMENTOS, rutaDocumento } from '@/lib/privacy/textos'

export const dynamic = 'force-static'

export async function generateMetadata(): Promise<Metadata> {
  const t = obtenerTraductor(await resolverLocale())
  return {
    title: t('legal.indice.metaTitulo'),
    description: t('legal.indice.metaDescripcion'),
  }
}

/**
 * Una frase por documento. No es el resumen legal: es la razón para abrirlo.
 * Tipo de documento → CLAVE del catálogo, nunca el texto.
 */
const CLAVE_RECLAMO: Readonly<Record<string, string>> = {
  privacidad: 'legal.indice.reclamos.privacidad',
  terminos: 'legal.indice.reclamos.terminos',
  no_es_terapia: 'legal.indice.reclamos.no_es_terapia',
  menores: 'legal.indice.reclamos.menores',
  retencion: 'legal.indice.reclamos.retencion',
  cookies: 'legal.indice.reclamos.cookies',
}

export default async function PaginaLegal() {
  const t = obtenerTraductor(await resolverLocale())

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
        {/* SIN TRADUCIR. `AVISO_NO_TERAPIA` vive en `lib/privacy/avisos.ts`, que
            no es de este bloque, y su redacción está razonada palabra a palabra
            allí («sin letra pequeña, sin jerga jurídica, y sin desalentar»).
            Traducirlo desde aquí duplicaría el aviso en un segundo sitio, que es
            exactamente lo que ese archivo existe para impedir. Anotado en el
            resumen de la migración. */}
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
