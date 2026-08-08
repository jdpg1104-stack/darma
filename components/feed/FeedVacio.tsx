// ============================================================================
// El feed vacío.
//
// Tono `'cuidado'` y no el neutro con ilustración simpática: quien llega a un
// feed vacío en Darma suele llegar recién registrado y con algo que contar. Un
// dibujo alegre junto a «no hay nada» se lee como burla.
//
// El copy no dice «crédito», ni «puntos», ni «racha»: dice acompañar. Es la
// trampa que la ficha de B16 marca explícitamente, y aquí importa más que en
// ninguna otra pantalla porque es lo primero que ve alguien nuevo.
// ============================================================================

import Link from 'next/link'

import { EstadoVacio } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'

import estilos from './Feed.module.css'

export interface FeedVacioProps {
  /** En el carril «Recientes» el vacío significa otra cosa: aún no hay nada nuevo. */
  carril?: 'para_ti' | 'nuevo'
}

export async function FeedVacio({ carril = 'para_ti' }: FeedVacioProps) {
  const t = obtenerTraductor(await resolverLocale())
  const titulo = carril === 'nuevo' ? t('feed.vacioNuevo') : t('feed.vacio')

  return (
    <EstadoVacio
      titulo={titulo}
      descripcion={t('feed.vacioDescripcion')}
      tono="cuidado"
      data-testid="feed-vacio"
      // Un `<Link>` estilado y NO `<Link><Boton>…</Boton></Link>`: un `<button>`
      // dentro de un `<a>` es HTML inválido (contenido interactivo anidado), y
      // los navegadores lo resuelven cada uno a su manera — en alguno el enlace
      // deja de funcionar con teclado.
      accion={
        <Link href="/publicar" className={estilos.accionVacio}>
          {t('feed.vacioAccion')}
        </Link>
      }
    />
  )
}
