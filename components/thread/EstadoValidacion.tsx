'use client'

// ============================================================================
// EstadoValidacion — qué ha pasado con tu escucha.
//
// `'use client'` por el idioma: lo pinta `CompositorRespuesta`, que es de
// cliente, así que el texto sale del contexto de locale (`useTraductor`). Sin
// estado ni efectos propios.
//
// Tres estados y ni uno más: «en revisión», «contó como escucha» y «no válido,
// y esto es lo que le falta».
//
// ── LO QUE NO SE ENSEÑA NUNCA ──────────────────────────────────────────────
// El `quality_score`. Ni el número, ni una barra, ni una estrella. Publicar la
// cifra es publicar el manual para quedarse justo por encima del umbral, y
// convierte escribirle algo a una persona en optimizar una métrica. El motivo
// va en palabras y propone qué contar, no puntúa.
//
// Y cuando la escucha cuenta, se dice el karma REAL —el que devolvió el
// ledger—, no los 10 nominales: con el tope diario rozado se pagan 2, y
// prometer 10 para pagar 2 destruye la confianza en la economía más rápido que
// cualquier bug funcional.
// ============================================================================

import { Chip } from '@/components/ui'
import { useTraductor } from '@/i18n/Proveedor'
import estilos from './hilo.module.css'

export type Estado = 'en_revision' | 'valido' | 'no_valido'

export interface EstadoValidacionProps {
  estado: Estado
  /** En lenguaje humano. `null` cuando no hay nada que explicar. */
  motivo?: string | null
  /** Karma realmente concedido (puede ser 0 por el tope diario). */
  karmaGanado?: number
  /** Créditos de escucha ganados: 0 o 1. */
  creditoGanado?: number
}

export function EstadoValidacion({
  estado,
  motivo = null,
  karmaGanado = 0,
  creditoGanado = 0,
}: EstadoValidacionProps) {
  const t = useTraductor()

  // Los `data-testid` por estado (B18): el e2e localizaba estos sellos por el
  // copy, que cambia con el idioma y con cada retoque de texto. El rol y los
  // textos no cambian; el testid es adicional.
  if (estado === 'en_revision') {
    return (
      <div className={estilos.acciones} role="status" data-testid="hilo-validacion-en-revision">
        <Chip tono="neutro">{t('hilo.comprobando')}</Chip>
      </div>
    )
  }

  if (estado === 'no_valido') {
    return (
      <div className={estilos.acciones} role="status" data-testid="hilo-validacion-no-valido">
        <Chip tono="aviso">{t('hilo.noContada')}</Chip>
        {motivo ? <p className={estilos.aviso}>{motivo}</p> : null}
      </div>
    )
  }

  return (
    <div
      className={estilos.acciones}
      role="status"
      data-testid="hilo-validacion-valido"
      // La escucha CONTADA (crédito ganado) frente al mero «publicado»: el dato
      // ya decide qué chip se pinta; el atributo lo hace legible para un test
      // sin depender de la frase del chip.
      data-escucha-contada={creditoGanado > 0 || undefined}
    >
      <Chip tono="logro">{creditoGanado > 0 ? t('hilo.validado') : t('hilo.publicado')}</Chip>
      {karmaGanado > 0 ? (
        <Chip tono="logro">{t('hilo.karmaGanado', { n: karmaGanado })}</Chip>
      ) : null}
      {/* Karma 0 con la escucha contada = tope diario alcanzado. Se dice, no se
          esconde: alguien que ha ayudado mucho hoy merece saber por qué su
          contador no sube, en vez de pensar que la app se ha equivocado. */}
      {creditoGanado > 0 && karmaGanado === 0 ? (
        <p className={estilos.aviso}>{t('hilo.topeDiarioEscucha')}</p>
      ) : null}
      {motivo ? <p className={estilos.aviso}>{motivo}</p> : null}
    </div>
  )
}
