// ============================================================================
// Diálogo de impulso. Server Component: la lista de opciones es texto.
//
// ── 🔴 EL ORDEN DE ESTA LISTA ES LA LÍNEA ROJA HECHA PANTALLA ───────────────
// Primero el cupo GRATUITO, después el KARMA, y solo al final los cristales.
// El orden no lo decide este componente: llega ya ordenado de
// `opcionesDePago()` (`lib/billing/boosts.ts`), que es una función pura con un
// test detrás. Así el orden es una prueba y no una costumbre de maquetación que
// alguien invierta un día "porque convierte mejor".
//
// La opción de dinero se pinta ATENUADA cuando hay una gratuita o de karma
// disponible. No está escondida —eso sería otro tipo de manipulación—, pero no
// compite por la mirada con la opción que no cuesta nada.
//
// El texto explica de dónde sale el cupo gratis: lo paga el karma que la
// persona ya ganó escuchando. Sin esa frase, «gratis» parece una promoción; con
// ella, es lo que es — la parte del producto que garantiza que el dinero nunca
// sea la barrera para ser escuchado.
// ============================================================================

import { clsx } from 'clsx'

import { Tarjeta } from '@/components/ui'
import type { EstadoBoost, MedioPagoBoost } from '@/lib/billing/boosts'
import { BOOST_HORAS, opcionesDePago } from '@/lib/billing/boosts'
import { EXPLICACION_CUPO_GRATIS } from '@/lib/billing/textos'

import { BotonImpulsar } from './BotonImpulsar'
import { FraseLineaRoja } from './FraseLineaRoja'
import estilos from './economia.module.css'

export interface DialogoBoostProps {
  postId: string
  estado: EstadoBoost
}

const TEXTO_AGOTADO: Readonly<Record<MedioPagoBoost, string>> = {
  gratis: 'Ya lo has usado hoy',
  karma: 'Te falta karma',
  cristales: 'Te faltan cristales',
}

export function DialogoBoost({ postId, estado }: DialogoBoostProps) {
  const opciones = opcionesDePago(estado)

  return (
    <Tarjeta className={estilos.tienda}>
      <h2>Impulsar este post</h2>
      <p className={estilos.explicacion}>
        Durante {BOOST_HORAS} horas rinde como si tuviera diez veces los apoyos que tiene. No salta la
        moderación, no adelanta a nadie en crisis y no cambia según con qué lo pagues.
      </p>

      <ul className={estilos.opciones}>
        {opciones.map((opcion, indice) => (
          <li
            key={opcion.medio}
            className={clsx(
              estilos.opcion,
              // La primera DISPONIBLE se destaca, que con el orden de
              // `opcionesDePago` es siempre la más barata para la persona.
              indice === opciones.findIndex((o) => o.disponible) && estilos.opcionPreferente,
              !opcion.disponible && estilos.opcionAgotada,
            )}
          >
            <span>{opcion.etiqueta}</span>
            {opcion.disponible ? (
              <BotonImpulsar postId={postId} medio={opcion.medio} etiqueta={opcion.etiqueta} />
            ) : (
              <span className={estilos.explicacion}>{TEXTO_AGOTADO[opcion.medio]}</span>
            )}
          </li>
        ))}
      </ul>

      <p className={estilos.explicacion}>{EXPLICACION_CUPO_GRATIS}</p>
      <FraseLineaRoja />
    </Tarjeta>
  )
}
