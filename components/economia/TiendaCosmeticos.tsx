// ============================================================================
// Tienda de cosméticos. Server Component con UN solo hijo `'use client'`.
//
// ── QUÉ PINTA ───────────────────────────────────────────────────────────────
// El catálogo de `lib/billing/cosmeticos.ts` con su ESTADO por persona:
//   · «En tu perfil»  → la columna de `profiles` ya lleva ese id. Comprarlo
//                        otra vez no cobra (idempotencia de 0217_1), pero el
//                        botón ni se ofrece: un botón de comprar lo comprado
//                        solo puede confundir.
//   · botón de compra → comprable y el saldo alcanza.
//   · «Te faltan…»    → comprable pero el saldo no llega. Sin botón: la tienda
//                        de cristales está al lado, no hace falta un embudo.
//   · «Próximamente»  → sin columna todavía (la categoría tema).
//
// Se paga con CRISTALES, no con la compra integrada: aquí no hay puente IAP ni
// `disponible` — el botón llama a `/api/billing/cosmetico` y el servidor cobra
// del saldo. Por eso esta tienda funciona también en web.
//
// ── LA FRASE VA ARRIBA ──────────────────────────────────────────────────────
// Es una superficie de pago: la frase de la línea roja se lee ANTES de los
// precios, como en la tienda de cristales. (Pedido anotado: añadir este archivo
// a SUPERFICIES_DE_PAGO en lineaRoja.test.ts, que no es de esta ola.)
// ============================================================================

import { Tarjeta } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { cosmeticosPublicables, esIdCosmeticoComprable } from '@/lib/billing/cosmeticos'

import { BotonCosmetico } from './BotonCosmetico'
import { FraseLineaRoja } from './FraseLineaRoja'
import estilos from './economia.module.css'

export interface TiendaCosmeticosProps {
  /** Saldo de cristales de quien mira, para atenuar lo que no puede pagar. */
  cristales: number
  /** `profiles.cosmetic_frame` de la persona. `null` = ninguno. */
  marcoActual: string | null
  /** `profiles.cosmetic_palette` de la persona. `null` = ninguna. */
  paletaActual: string | null
}

export async function TiendaCosmeticos({
  cristales,
  marcoActual,
  paletaActual,
}: TiendaCosmeticosProps) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <Tarjeta className={estilos.tienda}>
      <h2>{t('karma.economia.cosmeticos.titulo')}</h2>

      <FraseLineaRoja explicacion={t('karma.economia.cosmeticos.explicacion')} />

      <ul className={estilos.paquetes}>
        {cosmeticosPublicables().map((cosmetico) => {
          // El nombre es un DATO del catálogo y viaja como clave; se traduce
          // aquí, no en `cosmeticos.ts`, para que el módulo no tenga que saber
          // en qué idioma se va a pintar.
          const etiqueta = t(cosmetico.claveEtiqueta)
          // `const` aparte para que el type guard estreche el id de `string` a
          // `IdCosmeticoComprable`, que es lo único que acepta el botón.
          const id = cosmetico.id
          const actual = cosmetico.categoria === 'marco' ? marcoActual : paletaActual
          const alcanza = cristales >= cosmetico.costeCristales

          return (
            <li key={id} className={estilos.paquete}>
              <span className={estilos.etiqueta}>{etiqueta}</span>
              <span className={estilos.referencia}>{t(cosmetico.claveDescripcion)}</span>
              <span className={estilos.cantidad}>
                {t('karma.economia.cosmeticos.coste', { n: cosmetico.costeCristales })}
              </span>
              {!esIdCosmeticoComprable(id) ? (
                <span className={estilos.explicacion}>
                  {t('karma.economia.cosmeticos.proximamente')}
                </span>
              ) : actual === id ? (
                <span className={estilos.enPerfil}>{t('karma.economia.cosmeticos.enTuPerfil')}</span>
              ) : alcanza ? (
                <BotonCosmetico cosmeticoId={id} etiqueta={etiqueta} />
              ) : (
                <span className={estilos.explicacion}>
                  {t('karma.economia.cosmeticos.sinCristales')}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </Tarjeta>
  )
}
