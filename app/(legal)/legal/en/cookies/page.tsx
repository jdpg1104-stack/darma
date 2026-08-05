// ============================================================================
// /legal/en/cookies — la versión INGLESA del documento. Server Component
// puro y `force-static`, como todo el grupo: se sirve desde el CDN sin sesión
// y aunque la app esté caída (cuelga de /legal, que proxy.ts deja pasar).
//
// No es una traducción de interfaz: es OTRO documento legal
// (`lib/privacy/textosEn.ts`), con su propia versión y su propio sha256, cuyo
// cuerpo declara que el original español prevalece hasta la revisión legal
// externa. El chrome (etiquetas de versión y huella) va fijado a 'en': un
// documento inglés con etiquetas en español diría que nadie pensó en quien lo
// lee.
// ============================================================================

import type { Metadata } from 'next'

import { obtenerTraductor } from '@/i18n'
import { rutaDocumento } from '@/lib/privacy/textos'
import { DOCUMENTOS_LEGALES_EN } from '@/lib/privacy/textosEn'

import { Documento, ETIQUETA_ORIGINAL_ES } from '../../_documento'

export const dynamic = 'force-static'

const documento = DOCUMENTOS_LEGALES_EN['cookies']

export function generateMetadata(): Metadata {
  const t = obtenerTraductor('en')
  return {
    title: documento.titulo,
    description: t('legal.documento.descripcionMeta', { version: documento.version }),
  }
}

export default function PaginaCookiesEn() {
  return (
    <Documento
      documento={documento}
      locale="en"
      alterna={{ href: rutaDocumento('cookies'), etiqueta: ETIQUETA_ORIGINAL_ES }}
    />
  )
}
