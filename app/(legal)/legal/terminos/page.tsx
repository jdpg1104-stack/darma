// ============================================================================
// /legal/terminos — Server Component puro, cero JavaScript de cliente.
//
// `force-static`: el texto no depende de la sesión ni de la base de datos, así
// que se sirve desde el CDN sin tocar el servidor. Es además la única forma de
// que esta página siga en pie cuando la app no lo está — y una política de
// privacidad tiene que poder leerse justo entonces.
//
// El contenido sale de `lib/privacy/textos.ts`, que es la fuente única: la
// versión que se muestra aquí es la MISMA que se guarda en `consents` al
// aceptar. Duplicar el texto en el JSX rompería esa igualdad en silencio.
//
// `DocumentoBilingue` sirve el documento del locale de la petición con
// fallback a español — que bajo `force-static` es siempre el español, porque
// cookies y cabeceras llegan vacías. La versión inglesa (otro documento, con
// su propia versión y huella) vive además en su ruta estática propia,
// `/legal/en/terminos`, enlazada bajo el título.
// ============================================================================

import type { Metadata } from 'next'

import { DOCUMENTOS_LEGALES } from '@/lib/privacy/textos'
import { DOCUMENTOS_LEGALES_EN } from '@/lib/privacy/textosEn'

import { DocumentoBilingue, metadataDocumentoBilingue } from '../_documento'

export const dynamic = 'force-static'

const documento = DOCUMENTOS_LEGALES['terminos']
const documentoEn = DOCUMENTOS_LEGALES_EN['terminos']

// `documento.titulo` NO se traduce: es el título del documento legal tal y como
// vive en `lib/privacy/textos*.ts`, cuyo cuerpo está fijado por sha256.
export function generateMetadata(): Promise<Metadata> {
  return metadataDocumentoBilingue(documento, documentoEn)
}

export default function PaginaTerminos() {
  return <DocumentoBilingue es={documento} en={documentoEn} />
}
