// ============================================================================
// /legal/menores — Server Component puro, cero JavaScript de cliente.
//
// `force-static`: el texto no depende de la sesión ni de la base de datos, así
// que se sirve desde el CDN sin tocar el servidor. Es además la única forma de
// que esta página siga en pie cuando la app no lo está — y una política de
// privacidad tiene que poder leerse justo entonces.
//
// El contenido sale de `lib/privacy/textos.ts`, que es la fuente única: la
// versión que se muestra aquí es la MISMA que se guarda en `consents` al
// aceptar. Duplicar el texto en el JSX rompería esa igualdad en silencio.
// ============================================================================

import type { Metadata } from 'next'

import { DOCUMENTOS_LEGALES } from '@/lib/privacy/textos'

import { Documento } from '../_documento'

export const dynamic = 'force-static'

const documento = DOCUMENTOS_LEGALES['menores']

export const metadata: Metadata = {
  title: documento.titulo,
  description: `Documento legal de Darma, versión ${documento.version}.`,
}

export default function PaginaMenores() {
  return <Documento documento={documento} />
}
