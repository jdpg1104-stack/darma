// ============================================================================
// Esqueleto de /feed.
//
// Cinco filas y no una barra de carga: un esqueleto con la FORMA del contenido
// que va a llegar evita el salto de layout cuando llega de verdad (que es lo que
// mide el CLS y lo que hace que la gente pulse donde no era).
//
// `Cargando` con variante `'esqueleto'` va `aria-hidden` por dentro: leído en
// voz alta no aporta nada («grupo, grupo, grupo») y además pisa el anuncio del
// contenido real cuando aparece.
// ============================================================================

import { Cargando } from '@/components/ui'

export default function CargandoFeed() {
  return <Cargando variante="esqueleto" filas={5} />
}
