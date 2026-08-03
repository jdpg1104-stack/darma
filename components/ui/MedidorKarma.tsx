import { clsx } from 'clsx'

import { modeloMedidor } from './modelos.ts'
import { Insignia } from './Insignia.tsx'
import estilos from './MedidorKarma.module.css'

export interface MedidorKarmaProps {
  /**
   * SOLO reputación.
   *
   * `karmaSpendable` y `crystals` NO caben aquí a propósito, y no es una
   * omisión que se pueda «arreglar» luego: son campos PRIVADOS (CONTRATOS.md
   * §2), solo salen en `/api/me` y solo los ve su dueño. Si el componente no
   * puede recibirlos, ningún bloque puede filtrarlos por descuido en un perfil
   * ajeno. El medidor del saldo propio lo hace B05, en su bloque, con su tipo.
   */
  karmaReputacion: number
  compacto?: boolean
  mostrarSiguienteNivel?: boolean
}

/**
 * Progreso de nivel. Server Component.
 *
 * El progreso lo calcula `progressToNextLevel()` de `lib/karma.ts`; aquí no se
 * recalcula nada. Si algún día cambian los umbrales, cambian en un sitio.
 *
 * La barra mide el TRAMO ACTUAL, no el total: con 2 400 de karma muestra
 * 400/3 000 = 13 %, no 2 400/5 000 = 48 %. La segunda se vería casi llena justo
 * cuando faltan 2 600 puntos, y una barra que miente sobre el esfuerzo restante
 * es peor que no tener barra.
 *
 * Copy: nada de «puntos», «racha» ni «nivel desbloqueado» (Trampa #5). Esto
 * puede aparecer en la pantalla de alguien que está mal; el progreso se cuenta,
 * no se celebra.
 */
export function MedidorKarma({
  karmaReputacion,
  compacto = false,
  mostrarSiguienteNivel = true,
}: MedidorKarmaProps) {
  const m = modeloMedidor(karmaReputacion)

  return (
    <div className={clsx(estilos.medidor, compacto && estilos.compacto)} data-nivel={m.nivel}>
      <div className={estilos.cabecera}>
        <Insignia nivel={m.nivel} conEtiqueta={!compacto} />
        {compacto ? <span className={estilos.etiqueta}>{m.etiqueta}</span> : null}
        <span className={estilos.karma}>
          {m.karmaVisible}
          <span className={estilos.unidad}> de karma</span>
        </span>
      </div>

      {/* `role="progressbar"` con `aria-valuetext`: un «73» suelto leído en voz
          alta no significa nada. El texto dice de qué nivel a cuál. */}
      <div
        className={estilos.carril}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={m.porcentaje}
        aria-valuetext={m.textoAccesible}
      >
        <span className={estilos.relleno} data-porcentaje={m.porcentaje} />
      </div>

      {mostrarSiguienteNivel && m.etiquetaSiguiente ? (
        <p className={estilos.pista}>
          Te faltan {m.restante} de karma para {m.etiquetaSiguiente}.
        </p>
      ) : null}
      {mostrarSiguienteNivel && !m.etiquetaSiguiente ? (
        <p className={estilos.pista}>Has llegado al último nivel. Gracias por sostener esto.</p>
      ) : null}
    </div>
  )
}
