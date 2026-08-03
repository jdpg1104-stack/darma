// ============================================================================
// Selector de regalo. Server Component; el botón es la hoja de cliente.
//
// El reparto se enseña ANTES de regalar: coste, cuánto se queda Darma y cuánto
// llega. Un regalo con comisión oculta es un regalo que la persona descubre
// que era otra cosa, y en una red construida sobre confianza eso cuesta más de
// lo que ingresa.
//
// 🔴 El texto dice explícitamente que el regalo NO da karma. Es la parte que la
// gente asumiría al revés si no se dijera.
// ============================================================================

import { Tarjeta } from '@/components/ui'
import { obtenerTraductor, resolverLocale } from '@/i18n'
import { REGALOS, repartir } from '@/lib/billing/regalos'

import { BotonRegalar } from './BotonRegalar'
import { FraseLineaRoja } from './FraseLineaRoja'
import estilos from './economia.module.css'

export interface SelectorRegaloProps {
  recipientId: string
  refType?: 'post' | 'comment' | 'refuge'
  refId?: string
  /** Saldo de quien regala, para atenuar lo que no puede pagar. */
  cristales: number
}

export async function SelectorRegalo({
  recipientId,
  refType,
  refId,
  cristales,
}: SelectorRegaloProps) {
  const t = obtenerTraductor(await resolverLocale())

  return (
    <Tarjeta className={estilos.tienda}>
      <h2>{t('karma.economia.regalo.titulo')}</h2>
      <p className={estilos.explicacion}>{t('karma.economia.explicacionRegalo')}</p>

      <ul className={estilos.regalos}>
        {REGALOS.map((regalo) => {
          const reparto = repartir(regalo.costeCristales)
          const alcanza = cristales >= reparto.coste

          return (
            <li key={regalo.kind} className={estilos.paquete}>
              <span className={estilos.simbolo} aria-hidden="true">
                {regalo.simbolo}
              </span>
              <span className={estilos.etiqueta}>{regalo.etiqueta}</span>
              <span className={estilos.cantidad}>{reparto.coste}</span>
              {/* Los tres números a la vista. `neto` es lo que recibe la otra
                  persona, y es el que importa: se nombra primero. */}
              <span className={estilos.referencia}>
                {t('karma.economia.regalo.reparto', {
                  neto: reparto.neto,
                  comision: reparto.comision,
                })}
              </span>
              {alcanza ? (
                <BotonRegalar
                  recipientId={recipientId}
                  giftKind={regalo.kind}
                  etiqueta={regalo.etiqueta}
                  {...(refType ? { refType } : {})}
                  {...(refId ? { refId } : {})}
                />
              ) : (
                <span className={estilos.explicacion}>{t('karma.economia.regalo.sinCristales')}</span>
              )}
            </li>
          )
        })}
      </ul>

      <FraseLineaRoja />
    </Tarjeta>
  )
}
